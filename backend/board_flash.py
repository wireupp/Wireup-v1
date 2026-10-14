import asyncio
import base64
import binascii
import json
import os
import re
import tempfile
import threading
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt
from starlette.requests import HTTPConnection

def fail(status, message):
    raise HTTPException(status, message)

PORT = re.compile(r'(?:COM[1-9][0-9]*|/dev/(?:tty|cu\.)[A-Za-z0-9._-]+)\Z')
FLASH_TIMEOUT = 120
OUTPUT_LIMIT = 256000
_ACTIVE_PROJECTS = set()
_ACTIVE_PORTS = set()
_ACTIVE_LOCK = threading.Lock()
ESP_SEGMENTS = (
    ('bootloader', 'sketch.ino.bootloader.bin'),
    ('partitions', 'sketch.ino.partitions.bin'),
    ('boot_app0', 'boot_app0.bin'),
    ('application', 'sketch.ino.bin'),
)


class FlashRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    port: str = Field(min_length=1, max_length=200)
    expected_revision: StrictInt = Field(ge=1)
    source_revision: StrictInt = Field(ge=1)
    confirm: StrictBool


def executable(service):
    value = getattr(service.compiler, 'executable', None)
    if not value or not Path(value).is_file():
        fail(503, 'Arduino CLI is unavailable. Install it or configure ARDUINO_CLI_PATH.')
    return str(value)


async def run_cli(service, args, timeout):
    from backend.hardware import ArduinoCompiler
    try:
        process = await asyncio.create_subprocess_exec(
            executable(service), *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            **({'start_new_session': True} if os.name != 'nt' else {}),
        )
    except OSError:
        fail(503, 'Arduino CLI could not be started.')

    async def drain(stream):
        data = bytearray()
        while chunk := await stream.read(8192):
            if len(data) + len(chunk) > OUTPUT_LIMIT:
                raise ValueError('Arduino CLI output exceeded the safe limit.')
            data.extend(chunk)
        return data.decode('utf-8', errors='replace')

    tasks = [asyncio.create_task(drain(process.stdout)), asyncio.create_task(drain(process.stderr)),
             asyncio.create_task(process.wait())]
    try:
        return await asyncio.wait_for(asyncio.gather(*tasks), timeout)
    except (TimeoutError, ValueError) as error:
        fail(504 if isinstance(error, TimeoutError) else 502,
             'Arduino CLI timed out.' if isinstance(error, TimeoutError) else str(error))
    finally:
        try:
            if process.returncode is None:
                await asyncio.shield(ArduinoCompiler(executable=executable(service))._terminate(process))
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)


async def devices(service):
    stdout, stderr, code = await run_cli(service, ['board', 'list', '--format', 'json'], 75)
    if code != 0:
        fail(502, 'Arduino board detection failed: ' + (stderr or stdout)[:2000])
    try:
        data = json.loads(stdout)
        entries = data.get('detected_ports', data.get('ports', [])) if isinstance(data, dict) else data
        if not isinstance(entries, list):
            raise ValueError
        result = []
        seen = set()
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            port = entry.get('port', {})
            if not isinstance(port, dict):
                continue
            address = port.get('address')
            if (port.get('protocol') != 'serial' or not isinstance(address, str)
                    or not PORT.fullmatch(address) or address in seen):
                continue
            boards = entry.get('matching_boards') or []
            if not isinstance(boards, list):
                raise ValueError
            boards = [{'name': board.get('name', ''), 'fqbn': board['fqbn']}
                      for board in boards if isinstance(board, dict) and isinstance(board.get('fqbn'), str)]
            seen.add(address)
            result.append({'port': address, 'label': str(port.get('label') or address)[:200],
                           'protocol': 'serial', 'boards': boards, 'matching_boards': boards,
                           'unknown': not bool(boards)})
        return {'devices': result}
    except (ValueError, TypeError):
        fail(502, 'Arduino CLI returned invalid board detection JSON.')


def current_artifact(service, project_id, payload):
    from backend.hardware import BOARD_CONFIG
    project = service.get_project(project_id)
    if project['revision'] != payload.expected_revision or project['firmware']['revision'] != payload.source_revision:
        fail(409, 'Project or firmware revision changed. Save and recompile before flashing.')
    board = BOARD_CONFIG.get(project['board'])
    if not board or not board.get('compile') or not board.get('fqbn'):
        fail(400, 'Select an Arduino compiler board before flashing.')
    if not (board['fqbn'].startswith('arduino:avr:') or board.get('chip')):
        fail(400, 'Physical flashing currently supports AVR and ESP32 boards only.')
    compiler = project.get('compiler') or {}
    artifact = compiler.get('artifact') or {}
    if (compiler.get('status') not in ('simulation_ready', 'compilation_complete')
            or compiler.get('stale') or compiler.get('errors') or not artifact):
        fail(409, 'Compile the current firmware successfully before flashing.')
    for record in (compiler, artifact):
        if (record.get('board') != project['board'] or record.get('fqbn') != board['fqbn']
                or record.get('source_revision') != payload.source_revision
                or record.get('project_revision') != payload.expected_revision):
            fail(409, 'Compiled artifact is stale or does not match the project board.')
    if compiler.get('source') != project['firmware']['source'] or artifact.get('source') != project['firmware']['source']:
        fail(409, 'Compiled source does not match the current firmware.')
    if artifact.get('format') != board['format']:
        fail(409, 'Compiled artifact format does not match the project board.')
    return project, board, artifact


def upload_input(directory, board, artifact):
    if board['format'] == 'hex':
        text = artifact.get('hex')
        if not isinstance(text, str) or not text.startswith(':') or ':00000001FF' not in text or len(text) > 2000000:
            fail(409, 'No valid compiled Intel HEX artifact is available.')
        path = directory / 'sketch.ino.hex'
        try:
            path.write_bytes(text.encode('ascii'))
        except UnicodeError:
            fail(409, 'Compiled Intel HEX artifact is not ASCII.')
        return ['--input-file', str(path)]
    try:
        if (artifact.get('encoding') != 'base64' or artifact.get('image_kind') != 'merged-flash'
                or artifact.get('chip') != board['chip'] or artifact.get('load_address') != 0
                or not isinstance(artifact.get('bin'), str)
                or len(artifact['bin']) > (board['flash_size_bytes'] + 2) // 3 * 4):
            raise ValueError
        binary = base64.b64decode(artifact['bin'], validate=True)
        if len(binary) != board['flash_size_bytes']:
            raise ValueError
        segments = artifact['flash_segments']
        offsets = [board['bootloader_offset'], 0x8000, 0xe000, 0x10000]
        if not isinstance(segments, list) or len(segments) != len(ESP_SEGMENTS):
            raise ValueError
        for index, ((name, filename), offset) in enumerate(zip(ESP_SEGMENTS, offsets)):
            segment = segments[index]
            size = segment['size_bytes']
            end = offsets[index + 1] if index + 1 < len(offsets) else len(binary)
            if (segment.get('name') != name or segment.get('filename') != filename
                    or segment.get('offset') != offset or type(size) is not int or not 0 < size <= end - offset):
                raise ValueError
            (directory / filename).write_bytes(binary[offset:offset + size])
    except (ValueError, TypeError, KeyError, binascii.Error):
        fail(409, 'No complete compiled ESP32 flash segments are available.')
    # Use the compiled boot_app0 segment, not the installed core's potentially changed binary.
    recipe = ('tools.esptool_py.upload.pattern="{path}/{cmd}" --chip {build.mcu} '
              '--port "{serial.port}" --baud {upload.speed} {upload.flags} --before default-reset '
              '--after hard-reset write-flash -z --flash-mode keep --flash-freq keep --flash-size keep '
              '{build.bootloader_addr} "{build.path}/{build.project_name}.bootloader.bin" '
              '0x8000 "{build.path}/{build.project_name}.partitions.bin" '
              '0xe000 "{build.path}/boot_app0.bin" 0x10000 "{build.path}/{build.project_name}.bin"')
    return ['--input-dir', str(directory), '--upload-property', recipe]


async def flash(service, project_id, payload):
    if payload.confirm is not True:
        fail(400, 'Explicit confirmation is required to replace physical board firmware.')
    if not PORT.fullmatch(payload.port):
        fail(400, 'Select a detected serial port, not a path or command option.')
    with _ACTIVE_LOCK:
        if project_id in _ACTIVE_PROJECTS or payload.port in _ACTIVE_PORTS:
            fail(409, 'This project or serial port is already being flashed.')
        _ACTIVE_PROJECTS.add(project_id)
        _ACTIVE_PORTS.add(payload.port)
    try:
        current_artifact(service, project_id, payload)
        if project_id in service.runtime.sessions:
            state = await service.runtime.command(project_id, 'read_simulation_results', {})
            if state.get('result', {}).get('running') is not False:
                fail(409, 'Stop simulation before flashing a physical board.')
        detected = await devices(service)
        selected = next((item for item in detected['devices'] if item['port'] == payload.port), None)
        if selected is None:
            fail(409, 'The selected serial port is no longer detected.')
        project, board, artifact = current_artifact(service, project_id, payload)
        target = ':'.join(board['fqbn'].split(':')[:3])
        if selected['boards'] and not any(item['fqbn'] in (target, board['fqbn']) for item in selected['boards']):
            fail(409, 'Detected physical board does not match the project target.')
        with tempfile.TemporaryDirectory(prefix='wireup-flash-') as directory:
            inputs = upload_input(Path(directory), board, artifact)
            stdout, stderr, code = await run_cli(
                service, ['upload', '-p', payload.port, '--fqbn', board['fqbn'], '--protocol', 'serial', *inputs], FLASH_TIMEOUT)
        return {'success': code == 0, 'stdout': stdout, 'stderr': stderr, 'port': payload.port,
                'board': project['board'], 'fqbn': board['fqbn'], 'project_id': project_id,
                'expected_revision': payload.expected_revision, 'source_revision': payload.source_revision,
                'artifact_id': artifact['id'], 'returncode': code,
                'error': None if code == 0 else 'Arduino CLI uploader failed. Physical firmware may be incomplete.'}
    finally:
        with _ACTIVE_LOCK:
            _ACTIVE_PROJECTS.discard(project_id)
            _ACTIVE_PORTS.discard(payload.port)


async def until_disconnect(request, operation):
    task = asyncio.create_task(operation)

    async def disconnected():
        while True:
            message = await request.receive()
            if message['type'] == 'http.disconnect':
                return

    watcher = asyncio.create_task(disconnected())
    try:
        done, _ = await asyncio.wait([task, watcher], return_when=asyncio.FIRST_COMPLETED)
        if task in done:
            return await task
        fail(499, 'Client disconnected; hardware operation was cancelled.')
    finally:
        task.cancel()
        watcher.cancel()
        await asyncio.gather(task, watcher, return_exceptions=True)


def create_router(service, *, prefix='/api/hardware'):
    from backend.hardware.api import local_connection

    async def local_only(connection: HTTPConnection, response: Response):
        if not local_connection(connection):
            fail(403, 'Physical hardware API is local-only.')
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Referrer-Policy'] = 'no-referrer'

    api = APIRouter(prefix=prefix, tags=['hardware'], dependencies=[Depends(local_only)])

    @api.get('/devices')
    async def list_devices(request: Request):
        return await until_disconnect(request, devices(service))

    @api.post('/projects/{project_id}/flash')
    async def flash_project(project_id: str, payload: FlashRequest, request: Request):
        return await until_disconnect(request, flash(service, project_id, payload))

    return api
