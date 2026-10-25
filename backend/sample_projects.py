import asyncio
import copy
import hashlib
import json
import re
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response
from starlette.requests import HTTPConnection

from backend.sample_guidance import setup_guidance
from backend.hardware import (
    BOARD_ALIASES, BOARD_CONFIG, HardwareService, local_connection, service,
    source_text,
)

MODULE_ROOT = Path(__file__).resolve().parent
ROOT = MODULE_ROOT.parent if (MODULE_ROOT.parent / 'backend').is_dir() else MODULE_ROOT
BACKEND_ROOT = ROOT / 'backend' if (ROOT / 'backend').is_dir() else ROOT
EXAMPLES_PATH = BACKEND_ROOT / 'templates/velxio-examples.json'
STARTER_IDS = ('serial-hello', 'button-led', 'nano-button-led', 'mega-blink',
               'pico-blink', 'pico-button-led')
UPSTREAM_PATH = 'vendor/velxio/frontend/src/data/examples.ts'


def normalize_type(value, catalog):
    value = value.removeprefix('wokwi-')
    value = BOARD_ALIASES.get(value, value)
    if value not in catalog.components:
        value = next((key for key, entry in catalog.components.items()
                      if entry.get('tagName') == value), value)
    return value


def example_boards(example, catalog):
    explicit = [normalize_type(board['boardKind'], catalog)
                for board in example.get('boards', [])]
    declared = example.get('boardType')
    if declared:
        explicit.append(normalize_type(declared, catalog))
    placed = [normalize_type(part['type'], catalog) for part in example.get('components', [])
              if normalize_type(part['type'], catalog) in BOARD_CONFIG
              or catalog.components.get(normalize_type(part['type'], catalog), {}).get('category') == 'boards']
    return list(dict.fromkeys(explicit or placed or ['arduino-uno']))


def example_source(example):
    files = example.get('files')
    if files:
        if len(files) != 1:
            raise ValueError('Multiple source files are not supported by the single-sketch service.')
        if not files[0]['name'].endswith('.ino'):
            raise ValueError('Only Arduino .ino source files are supported.')
        return files[0]['content']
    boards = example.get('boards', [])
    if len(boards) == 1 and 'code' in boards[0]:
        return boards[0]['code']
    return example.get('code', '')


def resolve_pin(kind, pin, catalog):
    entry = catalog.components[kind]
    pin = entry.get('pin_aliases', {}).get(pin, pin)
    if pin == 'GND' and 'GND.1' in entry['pins']:
        pin = 'GND.1'
    if kind in ('arduino-nano', 'arduino-mega') and pin.startswith('D') and pin[1:].isdigit():
        pin = pin[1:]
    if pin not in entry['pins']:
        raise ValueError(f'Unknown pin {kind}:{pin}.')
    return pin


def normalize_template(example, catalog, library_free=True):
    boards = example_boards(example, catalog)
    if len(boards) != 1 or len(example.get('boards', [])) > 1 or boards[0] not in BOARD_CONFIG:
        raise ValueError('A single canonical supported board is required.')
    if example.get('languageMode', 'arduino') != 'arduino':
        raise ValueError('Only Arduino firmware is supported.')
    board = boards[0]
    if not BOARD_CONFIG[board]['compile']:
        raise ValueError('The selected board does not support Arduino firmware compilation.')
    if not catalog.components.get(board, {}).get('pins'):
        raise ValueError(f'Missing verified pins for {board}.')
    source = source_text(example_source(example))
    if library_free and (example.get('libraries') or re.search(r'^\s*#\s*include', source, re.MULTILINE)):
        raise ValueError('Starters must not require additional libraries.')
    adaptations = []
    components = copy.deepcopy(example.get('components', []))
    wires = copy.deepcopy(example.get('wires', []))
    if example['id'] == 'pico-blink':
        components, wires = [], []
        adaptations.append('Omitted upstream external LED, 220 ohm resistor and wires: GP25 is onboard-only, not an exposed Pico header pin. Firmware still blinks LED_BUILTIN (GPIO25); source is unchanged.')
    board_aliases = {'board', *BOARD_CONFIG, *BOARD_ALIASES}
    parts = []
    for part in components:
        kind = normalize_type(part['type'], catalog)
        entry = catalog.components.get(kind)
        if not entry:
            raise ValueError(f'Unknown component type {kind}.')
        if not entry.get('pins'):
            raise ValueError(f'Missing verified pins for {kind}.')
        if kind in BOARD_CONFIG or entry.get('category') == 'boards':
            if kind != board:
                raise ValueError('Placed board conflicts with selected board.')
            board_aliases.add(part['id'])
            continue
        properties = part.get('properties', {})
        for descriptor in entry.get('properties', []):
            name = descriptor['name']
            value = properties.get(name)
            if descriptor.get('type') == 'number' and isinstance(value, str):
                try:
                    properties[name] = float(value)
                except ValueError:
                    raise ValueError(f'Invalid numeric property {part["id"]}.{name}.') from None
                adaptations.append(f'Normalized {part["id"]}.{name} from numeric text; value is unchanged.')
        if kind == 'led' and 'pin' in properties:
            properties.pop('pin')
            adaptations.append(f'Removed {part["id"]}.pin display metadata; explicit wires determine connectivity.')
        parts.append({'id': part['id'], 'type': kind, 'x': part.get('x', 300),
                      'y': part.get('y', 100), 'rotation': part.get('rotation', 0),
                      'properties': properties})
    part_types = {part['id']: part['type'] for part in parts}
    if len(part_types) != len(parts) or any(part['id'] in board_aliases for part in parts):
        raise ValueError('Duplicate or reserved component identifier.')
    part_types['board'] = board
    normalized_wires = []
    for wire in wires:
        endpoints = []
        for side in ('start', 'end'):
            endpoint = wire[side]
            component = endpoint['componentId']
            component = 'board' if component in board_aliases else component
            if component not in part_types:
                raise ValueError(f'Unknown wire component {component}.')
            endpoints.append({'component': component,
                              'pin': resolve_pin(part_types[component], endpoint['pinName'], catalog)})
        normalized_wires.append({'id': wire['id'], 'from': endpoints[0], 'to': endpoints[1],
                                 'color': wire.get('color', '#22c55e')})
    return {'id': example['id'], 'title': example['title'], 'description': example['description'],
            'category': example['category'], 'difficulty': example['difficulty'], 'board': board,
            'parts': parts, 'wires': normalized_wires, 'source': source,
            'libraries': copy.deepcopy(example.get('libraries', [])), 'adaptations': adaptations}


def example_capabilities(example, catalog):
    boards = example_boards(example, catalog)
    blockers = []
    normalized = None
    error = None
    try:
        normalized = normalize_template(example, catalog, library_free=False)
    except (ValueError, KeyError, TypeError, HTTPException) as exc:
        error = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
        blockers.append({'category': 'canonical_validation_gap', 'detail': error})
    language = example.get('languageMode', 'arduino')
    if language != 'arduino':
        blockers.append({'category': 'unsupported_language', 'detail': language})
    if any(board not in BOARD_CONFIG for board in boards):
        blockers.append({'category': 'unsupported_board', 'detail': boards})
    if len(example.get('files', [])) > 1:
        blockers.append({'category': 'multi_file', 'detail': 'The service accepts one Arduino sketch.'})
    sources = ([file.get('content', '') for file in example.get('files', [])]
               or [board.get('code', '') for board in example.get('boards', []) if 'code' in board]
               or [example.get('code', '')])
    combined = '\n'.join(sources)
    headers = sorted(set(re.findall(r'^\s*#\s*include\s*[<\"]([^>\"\n]+)', combined, re.MULTILINE)))
    scopes = []
    if normalized:
        board = normalized['board']
        config = BOARD_CONFIG[board]
        if config['simulation'] != 'browser':
            blockers.append({'category': 'runtime_unavailable', 'detail': board})
        # These runtime paths implement digital continuity, not analog passive physics.
        continuity = {'led', 'resistor', 'pushbutton', 'pushbutton-6mm'}
        for part in normalized['parts']:
            entry = catalog.components[part['type']]
            supported = (config['simulation'] == 'browser' and
                         (part['type'] in continuity or board in entry.get('simulation_boards', [])))
            scopes.append({'id': part['id'], 'type': part['type'], 'supported': supported,
                           'scope': entry.get('simulation_scope', 'Digital continuity only.' if part['type'] in continuity else 'No model for the selected board.')})
            if not supported:
                blockers.append({'category': 'component_runtime_unavailable',
                                 'detail': f'{part["id"]}:{part["type"]} on {board}'})
        combined = normalized['source']
        if re.search(r'\b(?:WiFi|WIFI|Bluetooth|BLEDevice|Blynk|HTTPClient|requests|network|socket|MQTT|mqtt)\b', combined):
            blockers.append({'category': 'network_or_radio_requirement',
                             'detail': 'Network/radio behavior is not supported by this browser scope.'})
        headers = sorted(set(re.findall(r'^\s*#\s*include\s*[<\"]([^>\"\n]+)', combined, re.MULTILINE)))
    dependencies = {'declared_libraries': copy.deepcopy(example.get('libraries', [])),
                    'include_headers': headers}
    ready = normalized is not None and not blockers
    external = [header for header in headers if header not in ('Arduino.h', 'Wire.h', 'SPI.h', 'EEPROM.h')]
    if external or dependencies['declared_libraries']:
        blockers.append({'category': 'dependency_unverified', 'detail': dependencies})
    return {'boards': boards, 'board': boards[0] if len(boards) == 1 else None,
            'language': language, 'available': normalized is not None, 'seedable': normalized is not None,
            'canonical_supported': normalized is not None, 'fully_supported': ready and not blockers,
            'simulation_ready': ready, 'simulation_scope': 'ready' if ready else 'partial' if normalized else 'blocked',
            'part_scopes': scopes, 'blockers': blockers, 'dependencies': dependencies,
            'normalized_template': normalized, 'normalization_error': error,
            'compile_verified': False, 'simulation_verified': False}


async def create_copy(hardware_service, template):
    project = hardware_service.create_project(template['title'], template['board'])
    project_id = project['id']
    try:
        for name, mutations in (('add_component', template['parts']), ('connect_wire', template['wires']),
                                ('generate_firmware', [{'source': template['source']}])):
            for mutation in mutations:
                project = await hardware_service.command(
                    project_id, name, {**copy.deepcopy(mutation), 'expected_revision': project['revision']})
        return project
    except BaseException:
        hardware_service.delete_project(project_id)
        raise


class SampleCatalog:
    def __init__(self, hardware_service, examples_path=EXAMPLES_PATH):
        self.hardware_service = hardware_service
        path = Path(examples_path)
        raw = path.read_bytes()
        examples = json.loads(raw)
        by_id = {example['id']: example for example in examples}
        if len(by_id) != len(examples):
            raise ValueError('Duplicate upstream example identifiers.')
        self.templates = {key: normalize_template(by_id[key], hardware_service.catalog) for key in STARTER_IDS}
        self.examples = examples
        self.capabilities = {key: example_capabilities(example, hardware_service.catalog)
                             for key, example in by_id.items()}
        self.source_hash = hashlib.sha256(raw).hexdigest()
        self.validated = False
        self.validation_lock = asyncio.Lock()

    async def validate(self):
        async with self.validation_lock:
            if self.validated:
                return
            # Disposable projects exercise canonical persistence and command validation without publishing copies.
            with tempfile.TemporaryDirectory(prefix='wireup-samples-') as directory:
                validator = HardwareService(directory, catalog=self.hardware_service.catalog)
                for template in self.templates.values():
                    project = await create_copy(validator, template)
                    validator.delete_project(project['id'])
                for example_id, capabilities in self.capabilities.items():
                    if example_id in self.templates or not capabilities['available']:
                        continue
                    try:
                        project = await create_copy(validator, capabilities['normalized_template'])
                        validator.delete_project(project['id'])
                    except (ValueError, KeyError, TypeError, HTTPException) as exc:
                        detail = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
                        capabilities.update(available=False, seedable=False, canonical_supported=False,
                                            fully_supported=False, simulation_ready=False,
                                            simulation_scope='blocked', normalized_template=None)
                        capabilities['blockers'].append({'category': 'canonical_validation_gap', 'detail': detail})
            self.validated = True

    def summaries(self):
        if not self.validated:
            raise RuntimeError('Validate all starter templates before publishing the catalog.')
        summaries = []
        for template in self.templates.values():
            board = BOARD_CONFIG[template['board']]
            pins = sorted({endpoint['pin'] for wire in template['wires']
                           for endpoint in (wire['from'], wire['to']) if endpoint['component'] == 'board'})
            if template['id'] in ('mega-blink', 'pico-blink'):
                pins.append('13 (onboard LED)' if template['board'] == 'arduino-mega' else 'GPIO25 (onboard LED only)')
            instructions = ['Open an editable copy; the starter already chooses its documented board.',
                            'Compile firmware locally, then connect the browser hardware workspace and run.']
            if 'button' in template['id']:
                instructions.append('Press and release the button; the external LED should follow. INPUT_PULLUP makes a press active LOW; keep the explicit 220 ohm series resistor.')
            elif template['id'] == 'serial-hello':
                instructions.append('Inspect the serial monitor: greeting on startup, uptime every two seconds (9600 baud).')
            else:
                instructions.append('Observe the onboard LED toggle every 500 ms; inspect LED ON/OFF serial messages.')
            thumb = f'examples-thumbs/{template["id"]}.webp'
            summaries.append({key: template[key] for key in ('id', 'title', 'description', 'category', 'difficulty', 'board')} | {
                'thumbnail': f'/starter-thumbnails/{template["id"]}.webp' if (ROOT / 'vendor/velxio/frontend/public' / thumb).is_file() else None,
                'thumbnail_is_upstream': True,
                'verification': 'canonical_service_validated',
                'verification_status': {'canonical_validation': 'passed', 'real_compile': 'not_verified',
                                        'browser_run': 'not_verified', 'simulation_verified': False},
                'available': True, 'compile_supported': board['compile'],
                'simulation': board['simulation'], 'runtime': board['runtime'],
                'requirements': {
                    'parts': [{'id': 'board', 'type': template['board']}, *copy.deepcopy(template['parts'])],
                    'wiring': copy.deepcopy(template['wires']), 'pins': pins,
                    'firmware': {'filename': 'sketch.ino', 'language': 'arduino', 'fqbn': board['fqbn'],
                                 'libraries': [], 'source_sha256': hashlib.sha256(template['source'].encode()).hexdigest()},
                    'libraries': [], 'instructions': instructions,
                    'verification': 'Canonical validation only; real compilation and browser execution are not yet verified.'},
                'provenance': {'source': UPSTREAM_PATH, 'export': 'backend/templates/velxio-examples.json',
                               'export_sha256': self.source_hash, 'example_id': template['id'],
                               'preview': thumb, 'source_modified': False,
                               'adaptations': copy.deepcopy(template['adaptations'])}})
        return summaries


def create_router(hwservice=None, examples_path=EXAMPLES_PATH):
    hwservice = service if hwservice is None else hwservice
    catalog = SampleCatalog(hwservice, examples_path)

    @asynccontextmanager
    async def lifespan(api):
        await catalog.validate()
        yield

    async def local_only(connection: HTTPConnection, response: Response):
        if not local_connection(connection):
            raise HTTPException(403, 'Hardware samples API is local-only; loopback client, Host, and Origin are required.')
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Referrer-Policy'] = 'no-referrer'

    api = APIRouter(prefix='/api/hardware/samples', tags=['hardware-samples'],
                    dependencies=[Depends(local_only)], lifespan=lifespan)

    @api.get('')
    async def list_samples():
        await catalog.validate()
        return {'samples': catalog.summaries()}

    @api.get('/all')
    async def all_examples():
        await catalog.validate()
        return {'total': len(catalog.examples), 'examples': [{
            'id': example['id'], 'title': example['title'], 'category': example['category'],
            **{key: value for key, value in catalog.capabilities[example['id']].items()
               if key not in ('normalized_template', 'normalization_error')},
            'starter': example['id'] in STARTER_IDS,
            'thumbnail': f'/example-thumbnails/{example["id"]}.webp' if (ROOT / 'public/example-thumbnails' / f'{example["id"]}.webp').is_file() else None,
        } for example in catalog.examples]}

    @api.post('/{sample_id}/open')
    async def open_sample(sample_id: str):
        await catalog.validate()
        template = catalog.templates.get(sample_id)
        capabilities = catalog.capabilities.get(sample_id)
        if capabilities is None:
            raise HTTPException(404, 'Unknown example project.')
        if template is None:
            template = capabilities['normalized_template']
        if template is None:
            raise HTTPException(409, {'message': 'This example cannot be mapped safely to a canonical project.',
                                      'blockers': capabilities['blockers']})
        project = await create_copy(hwservice, template)
        guidance = setup_guidance(template)
        if template.get('libraries'):
            guidance += '\n\n**Required libraries:** ' + ', '.join(template['libraries']) + '. Install these before compiling the unchanged source; dependencies are not automatically installed or verified.'
        guidance += '\n\n**Simulation scope:** ' + ('All listed parts have models for the selected board; compile and run the actual firmware to verify behavior.' if capabilities['simulation_ready'] else 'Partial support only; opening this source does not make unsupported behavior simulatable. ' + json.dumps(capabilities['blockers']))
        return {**project, 'setup_guidance': guidance}

    return api


router = create_router()
