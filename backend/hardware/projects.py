"""Project persistence, mutations and the single command dispatcher.

`HardwareService.command` is the platform's single mutation path until phase v04 replaces
it with packages/toolbus. Split out of the former single backend/hardware.py module
during phase v01; behaviour is unchanged.
"""

import asyncio
import copy
import hmac
import json
import os
import re
import secrets
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException


from backend.hardware.boards import (
    BOARD_ALIASES,
    BOARD_CONFIG,
    DEFAULT_BOARD_SOURCES,
    DEFAULT_SOURCE,
    PIN_ALIASES,
    ROOT,
    TOOLS,
)
from backend.hardware.util import (
    calculator,
    fail,
    identifier,
    now,
    numeric,
    public,
    source_text,
    validate_spice_properties,
)
from backend.hardware.catalog import (
    ComponentCatalog,
)
from backend.hardware.compiler import (
    ArduinoCompiler,
)
from backend.hardware.runtime_bridge import (
    RuntimeBridge,
)


class HardwareService:
    def __init__(self, data_dir=None, compiler=None, runtime=None, catalog=None, native=None):
        self.data_dir = Path(data_dir) if data_dir else ROOT / 'backend/data/hardware'
        self.compiler = compiler or ArduinoCompiler()
        self.runtime = runtime or RuntimeBridge()
        from backend.native_esp32 import NativeESP32
        self.native = native or NativeESP32()
        self.catalog = catalog or ComponentCatalog()
        self.lock = threading.RLock()
        self.compile_gate = asyncio.Semaphore(1)

    def _path(self, project_id):
        return self.data_dir / f'{identifier(project_id)}.json'

    def _load(self, project_id):
        path = self._path(project_id)
        if not path.is_file():
            fail(404, 'Project not found.')
        return json.loads(path.read_text(encoding='utf-8'))

    def _save(self, project):
        self.data_dir.mkdir(parents=True, exist_ok=True)
        destination = self._path(project['id'])
        temporary = destination.with_suffix(f'.{uuid.uuid4().hex}.tmp')
        try:
            temporary.write_text(json.dumps(project, ensure_ascii=False, allow_nan=False), encoding='utf-8')
            for attempt in range(4):
                try:
                    os.replace(temporary, destination)
                    break
                except PermissionError:
                    if os.name != 'nt' or attempt == 3:
                        raise
                    time.sleep(0.02 * (attempt + 1))
        finally:
            temporary.unlink(missing_ok=True)

    def create_project(self, name='Untitled circuit', board='unselected'):
        if not isinstance(board, str):
            fail(400, 'Unsupported board. Select a board from the hardware catalog.')
        board = BOARD_ALIASES.get(board.removeprefix('wokwi-'), board.removeprefix('wokwi-'))
        if board != 'unselected' and board not in BOARD_CONFIG:
            fail(400, 'Unsupported board. Select a board from the hardware catalog.')
        if not isinstance(name, str) or not name.strip() or len(name) > 120:
            fail(400, 'Project name must contain 1 to 120 characters.')
        project = {'id': uuid.uuid4().hex, 'schema_version': 1, 'revision': 1, 'name': name.strip(),
                   'board': board, 'components': [] if board == 'unselected' else [{'id': 'board', 'type': board, 'x': 120, 'y': 100,
                                                   'rotation': 0, 'properties': {}}], 'wires': [],
                   'firmware': {'filename': 'main.py' if board.startswith('raspberry-pi-') else 'sketch.ino', 'source': '' if board == 'unselected' or board.startswith('raspberry-pi-') else DEFAULT_BOARD_SOURCES.get(board, DEFAULT_SOURCE), 'revision': 1},
                   'history': [], '_undo': [], 'compiler': None, '_artifacts': {},
                   'runtime_token': secrets.token_urlsafe(32), 'created_at': now(), 'updated_at': now()}
        with self.lock:
            self._save(project)
        return public(project)

    def get_project(self, project_id):
        with self.lock:
            return public(self._load(project_id))

    def list_projects(self):
        with self.lock:
            projects = []
            if self.data_dir.is_dir():
                for path in sorted(self.data_dir.glob('*.json')):
                    project = self._load(path.stem)
                    projects.append({key: project[key] for key in ('id', 'name', 'board', 'revision', 'created_at', 'updated_at')})
            return {'projects': projects}

    def delete_project(self, project_id):
        with self.lock:
            project = self._load(project_id)
            if self.native.active(project_id):
                fail(409, 'Stop the native ESP32 runtime before deleting this project.')
            if project_id in self.runtime.sessions:
                fail(409, 'This project is open in a hardware workspace. Close its workspace before deleting it.')
            self._path(project_id).unlink()
            return {'deleted': project['id']}

    def authorize_runtime(self, project, token):
        if not isinstance(token, str) or not hmac.compare_digest(project['runtime_token'], token):
            fail(403, 'A matching project runtime token is required.')

    def _check_revision(self, project, args):
        revision = args.get('expected_revision')
        if revision is not None and (type(revision) is not int or revision != project['revision']):
            fail(409, f'Project revision conflict; current revision is {project["revision"]}.')

    def _properties(self, kind, supplied, existing=None):
        if not isinstance(supplied, dict) or len(json.dumps(supplied, allow_nan=False)) > 16000:
            fail(400, 'Component properties must be a bounded JSON object.')
        entry = self.catalog.components[kind]
        if entry.get('spice_model'):
            return validate_spice_properties(entry, supplied, existing)
        descriptors = {item['name']: item for item in entry.get('properties', [])}
        for key, value in supplied.items():
            descriptor = descriptors.get(key)
            if descriptor is None:
                fail(400, f'Unknown property {key} for {kind}.')
            typ = descriptor.get('type')
            if typ == 'number':
                numeric(value)
                if value < descriptor.get('min', -1000000) or value > descriptor.get('max', 1000000):
                    fail(400, f'Property {key} is outside its allowed range.')
            elif typ == 'boolean' and type(value) is not bool:
                fail(400, f'Property {key} must be boolean.')
            elif typ in ('string', 'color', 'select') and not isinstance(value, str):
                fail(400, f'Property {key} must be a string.')
            if descriptor.get('options') and value not in descriptor['options']:
                fail(400, f'Invalid option for {key}.')
        return copy.deepcopy(supplied)

    def _component(self, project, component_id):
        identifier(component_id)
        for item in project['components']:
            if item['id'] == component_id:
                return item
        fail(404, 'Component not found.')

    def _endpoint(self, project, endpoint):
        if not isinstance(endpoint, dict) or set(endpoint) != {'component', 'pin'}:
            fail(400, 'Wire endpoint must contain component and pin.')
        component = self._component(project, endpoint['component'])
        pin = endpoint['pin']
        if not isinstance(pin, str):
            fail(400, 'Pin names must be strings.')
        pin = PIN_ALIASES.get(component['type'], {}).get(pin, pin)
        available = self.catalog.components[component['type']]['pins']
        if component['type'] in BOARD_CONFIG and pin not in available:
            candidates = []
            digital = re.fullmatch(r'D(\d+)', pin)
            if digital:
                candidates.append(digital.group(1))
            elif pin.isdecimal():
                candidates.append('D' + pin)
            if pin == 'GND':
                candidates.append('GND.1')
            if pin == '3V3':
                candidates.append('3.3V')
            elif pin == '3.3V':
                candidates.append('3V3')
            pin = next((candidate for candidate in candidates if candidate in available), pin)
        if pin not in available:
            fail(400, 'Unknown component pin or unavailable pin layout.')
        return {'component': endpoint['component'], 'pin': pin}

    def _mutate(self, project_id, name, args):
        with self.lock:
            project = self._load(project_id)
            self._check_revision(project, args)
            snapshot = {key: copy.deepcopy(project[key]) for key in ('name', 'board', 'components', 'wires', 'firmware')}
            if name == 'add_component':
                kind = args.get('type')
                if isinstance(kind, str):
                    kind = BOARD_ALIASES.get(kind.removeprefix('wokwi-'), kind.removeprefix('wokwi-'))
                if not isinstance(kind, str) or kind not in self.catalog.components:
                    fail(400, 'Unknown component type.')
                if self.catalog.components[kind].get('category') == 'boards' or kind in BOARD_CONFIG:
                    if kind not in BOARD_CONFIG:
                        fail(400, 'This board is not available for placement. Select a board from the hardware catalog.')
                    board = next((part for part in project['components'] if part['id'] == 'board'), None)
                    if board is None:
                        board = {'id': 'board', 'type': kind, 'x': numeric(args.get('x', 120)), 'y': numeric(args.get('y', 100)), 'rotation': numeric(args.get('rotation', 0)), 'properties': {}}
                        project['components'].append(board)
                    if kind == project['board']:
                        fail(409, 'This microcontroller is already placed in the project.')
                    if any(wire['from']['component'] == 'board' or wire['to']['component'] == 'board' for wire in project['wires']):
                        fail(409, 'Remove wires attached to the current board before replacing the microcontroller.')
                    if not project['firmware']['source'] or project['firmware']['source'] == DEFAULT_BOARD_SOURCES.get(project['board'], DEFAULT_SOURCE):
                        project['firmware']['source'] = '' if kind.startswith('raspberry-pi-') else DEFAULT_BOARD_SOURCES.get(kind, DEFAULT_SOURCE)
                        project['firmware']['filename'] = 'main.py' if kind.startswith('raspberry-pi-') else 'sketch.ino'
                    placement = {key: numeric(args[key]) for key in ('x', 'y', 'rotation') if key in args}
                    board.update(type=kind, properties={}, **placement)
                    project['board'] = kind
                    project['firmware']['revision'] += 1
                    project['_undo'] = (project['_undo'] + [snapshot])[-50:]
                    project['revision'] += 1
                    if project['compiler']:
                        project['compiler']['stale'] = True
                    project['updated_at'] = now()
                    project['history'] = (project['history'] + [{'revision': project['revision'], 'operation': 'replace_board', 'timestamp': project['updated_at']}])[-200:]
                    self._save(project)
                    return public(project)
                if len(project['components']) >= 200:
                    fail(400, 'Project component limit reached.')
                component_id = identifier(args.get('id', uuid.uuid4().hex))
                if any(item['id'] == component_id for item in project['components']):
                    fail(409, 'Component identifier already exists.')
                properties = copy.deepcopy(self.catalog.components[kind].get('defaultValues', {}))
                properties.update(self._properties(kind, args.get('properties', {})))
                placement_index = max(0, len(project['components']) - 1)
                project['components'].append({'id': component_id, 'type': kind, 'x': numeric(args.get('x', 380 + (placement_index % 3) * 180)),
                                               'y': numeric(args.get('y', 100 + (placement_index // 3) * 140)), 'rotation': numeric(args.get('rotation', 0)),
                                               'properties': properties})
            elif name in ('remove_component', 'modify_component'):
                component = self._component(project, args.get('id'))
                if name == 'remove_component':
                    if component['id'] == 'board':
                        fail(400, 'The project board cannot be removed.')
                    project['components'].remove(component)
                    project['wires'] = [wire for wire in project['wires'] if all(wire[end]['component'] != component['id'] for end in ('from', 'to'))]
                else:
                    for key in ('x', 'y', 'rotation'):
                        if key in args:
                            component[key] = numeric(args[key])
                    if 'properties' in args:
                        component['properties'].update(self._properties(component['type'], args['properties'], component['properties']))
            elif name == 'connect_wire':
                if len(project['wires']) >= 500:
                    fail(400, 'Project wire limit reached.')
                start, end = self._endpoint(project, args.get('from')), self._endpoint(project, args.get('to'))
                if start == end:
                    fail(400, 'A wire must connect two distinct pins.')
                if any((wire['from'] == start and wire['to'] == end) or (wire['from'] == end and wire['to'] == start) for wire in project['wires']):
                    fail(409, 'This wire connection already exists.')
                wire_id = identifier(args.get('id', uuid.uuid4().hex))
                if any(wire['id'] == wire_id for wire in project['wires']):
                    fail(409, 'Wire identifier already exists.')
                color = args.get('color', '#22c55e')
                if not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}|[a-zA-Z]{1,20}', color):
                    fail(400, 'Invalid wire color.')
                project['wires'].append({'id': wire_id, 'from': start, 'to': end, 'color': color})
            elif name == 'remove_wire':
                wire_id = identifier(args.get('id'))
                wire = next((item for item in project['wires'] if item['id'] == wire_id), None)
                if wire is None:
                    fail(404, 'Wire not found.')
                project['wires'].remove(wire)
            elif name in ('generate_firmware', 'edit_firmware'):
                source = args.get('source')
                if source is None and name == 'edit_firmware':
                    old, new = args.get('old'), args.get('new')
                    current = project['firmware']['source']
                    if not isinstance(old, str) or not old or not isinstance(new, str) or current.count(old) != 1:
                        fail(400, 'Firmware edit must match exactly one nonempty source segment.')
                    source = current.replace(old, new, 1)
                project['firmware']['source'] = source_text(source)
                project['firmware']['revision'] += 1
            elif name == 'undo':
                if not project['_undo']:
                    fail(409, 'There is no mutation to undo.')
                restored = project['_undo'].pop()
                source_revision = project['firmware']['revision']
                changed_source = (restored['firmware']['source'] != project['firmware']['source'] or restored['firmware']['filename'] != project['firmware']['filename'] or restored['board'] != project['board'])
                project.update(restored)
                project['firmware']['revision'] = source_revision + int(changed_source)
            else:
                fail(400, 'Unknown mutation.')
            if name != 'undo':
                project['_undo'] = (project['_undo'] + [snapshot])[-50:]
            project['revision'] += 1
            if project['compiler']:
                project['compiler']['stale'] = True
            project['updated_at'] = now()
            project['history'] = (project['history'] + [{'revision': project['revision'], 'operation': name,
                                                       'timestamp': project['updated_at']}])[-200:]
            self._save(project)
            return public(project)

    def get_artifact(self, project_id, artifact_id):
        identifier(artifact_id)
        with self.lock:
            artifact = self._load(project_id)['_artifacts'].get(artifact_id)
            if artifact is None:
                fail(404, 'Artifact not found.')
            return copy.deepcopy(artifact)

    async def command(self, project_id, name, args=None, runtime_token=None):
        args = {} if args is None else args
        if not isinstance(args, dict):
            fail(400, 'Command args must be an object.')
        try:
            encoded = json.dumps(args, allow_nan=False)
        except (ValueError, TypeError):
            fail(400, 'Command args must contain finite JSON values.')
        if len(encoded) > 200000:
            fail(400, 'Command arguments are too large.')
        if name not in TOOLS and name not in ('undo', 'wire_circuit', 'validate_circuit', 'route_breadboard'):
            fail(400, 'Unknown hardware command.')
        if name == 'route_breadboard':
            from backend.breadboard_routing import route_breadboard
            return await route_breadboard(self, project_id, args)
        project = self.get_project(project_id)
        if name == 'wire_circuit':
            from backend.circuit_wiring import wire_circuit
            return await wire_circuit(self, project_id, args)
        if name == 'check_connections':
            from backend.circuit_wiring import check_connections
            return await check_connections(self, project_id, args)
        if name == 'validate_circuit':
            from backend.circuit_wiring import validate_circuit
            return await validate_circuit(self, project_id)
        if name == 'read_project':
            return project
        if name == 'search_components':
            return self.catalog.search(args.get('query', ''), args.get('limit', 50))
        if name == 'read_firmware':
            return project['firmware']
        if name == 'calculator':
            return calculator(args.get('expression'))
        if name == 'read_compiler_errors':
            return project['compiler'] or {'status': 'not_compiled', 'errors': []}
        if name == 'compile_firmware':
            self._check_revision(project, args)
            compilation_error = None
            try:
                try:
                    await asyncio.wait_for(self.compile_gate.acquire(), 10)
                except TimeoutError:
                    fail(503, 'Compiler is busy. Retry shortly.')
                try:
                    result = await self.compiler.compile(project)
                finally:
                    self.compile_gate.release()
            except HTTPException as error:
                if error.status_code == 503 and 'busy' in str(error.detail).lower():
                    raise
                compilation_error = error
                result = {'status': 'error', 'stdout': '', 'stderr': str(error.detail),
                          'errors': [str(error.detail)], 'source': project['firmware']['source'],
                          'source_revision': project['firmware']['revision'],
                          'project_revision': project['revision'], 'board': project['board'],
                          'artifact': None, 'compiled_at': now()}
            with self.lock:
                latest = self._load(project_id)
                result['stale'] = latest['revision'] != project['revision'] or latest['firmware']['revision'] != project['firmware']['revision']
                if result.get('artifact'):
                    artifact = result['artifact']
                    artifact['source'] = project['firmware']['source']
                    artifact['url'] = f'/api/hardware/project/{project_id}/artifacts/{artifact["id"]}'
                    latest['_artifacts'][artifact['id']] = copy.deepcopy(artifact)
                    # Retain a bounded set of original-revision artifacts.
                    latest['_artifacts'] = dict(list(latest['_artifacts'].items())[-10:])
                latest['compiler'] = result
                self._save(latest)
            if compilation_error:
                raise compilation_error
            return copy.deepcopy(result)
        if name in ('run_simulation', 'stop_simulation', 'read_simulation_results'):
            self.authorize_runtime(project, runtime_token)
            board = BOARD_CONFIG.get(project['board'])
            if args.get('runtime') == 'qemu-native':
                from backend.native_esp32 import RunRequest, StopRequest
                revision_args = {'runtime_token': runtime_token, 'expected_revision': args.get('expected_revision', project['revision']),
                                 'source_revision': args.get('source_revision', project['firmware']['revision'])}
                if type(revision_args['expected_revision']) is not int:
                    fail(409, 'Project revision conflict. Reload the current project.')
                self._check_revision(project, revision_args)
                if type(revision_args['source_revision']) is not int or revision_args['source_revision'] != project['firmware']['revision']:
                    fail(409, 'Firmware revision conflict. Reload the current project.')
                for key in ('artifact_id', 'run_id'):
                    if args.get(key) is not None:
                        identifier(args[key])
                if name == 'run_simulation':
                    result = await self.native.run(self, project_id, RunRequest(**revision_args, artifact_id=args.get('artifact_id')))
                elif name == 'stop_simulation':
                    result = await self.native.stop(self, project_id, StopRequest(**revision_args, run_id=args.get('run_id')))
                else:
                    result = await self.native.results(self, project_id, runtime_token,
                                                       revision_args['expected_revision'], revision_args['source_revision'],
                                                       run_id=args.get('run_id'))
                return {'status': 'acknowledged', 'command': name, 'result': result}
            remote = project['board'] in ('esp32-devkit-v1', 'esp32-devkit-c-v4', 'esp32-s3', 'esp32-c3') and bool(os.getenv('REMOTE_SIMULATION_URL'))
            native_adapter = project['board'] in ('esp32-devkit-v1', 'esp32-devkit-c-v4') and project_id in getattr(self.runtime, 'sessions', {})
            if not board or (board['simulation'] != 'browser' and not remote and not native_adapter):
                fail(503, board['unavailable_reason'] if board else 'This board has no configured runtime.')
            runtime_args = {}
            if name == 'run_simulation':
                if project['board'] == 'pi-pico-w' and re.search(r'\b(?:WiFi|Bluetooth|cyw43|LED_BUILTIN)\b', project['firmware']['source'], re.I):
                    fail(503, 'Pico W browser simulation supports external GPIO and UART0 only. This firmware uses the unimplemented CYW43 radio or onboard LED; use external GPIO firmware or real hardware.')
                compiled = project['compiler']
                artifact_id = args.get('artifact_id')
                if artifact_id:
                    artifact = self.get_artifact(project_id, artifact_id)
                elif compiled and compiled.get('artifact'):
                    artifact = compiled['artifact']
                else:
                    fail(409, 'Compile firmware successfully before running the browser simulator.')
                if artifact['source_revision'] != project['firmware']['revision']:
                    fail(409, 'Compiled artifact is stale. Recompile the current project.')
                if artifact['board'] != project['board'] or artifact['format'] != BOARD_CONFIG[project['board']]['format']:
                    fail(409, 'Compiled artifact does not match the project board.')
                runtime_project = copy.deepcopy(project)
                runtime_project.pop('runtime_token', None)
                runtime_args = {'project': runtime_project, 'artifact': artifact}
            if remote:
                from backend.remote_projects import remote_projects
                return await remote_projects.command(project, name, runtime_args.get('artifact'))
            return await self.runtime.command(project_id, name, runtime_args)
        return self._mutate(project_id, name, args)
