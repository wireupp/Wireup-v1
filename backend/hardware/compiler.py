"""Arduino compilation bridge.

Split out of the former single backend/hardware.py module during phase v01.
"""

import asyncio
import base64
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path


from backend.hardware.boards import (
    BOARD_CONFIG,
)
from backend.hardware.util import (
    fail,
    now,
    source_text,
)


class ArduinoCompiler:
    def __init__(self, executable=None, timeout=None, output_limit=256000):
        self.executable = executable or os.getenv('ARDUINO_CLI_PATH') or shutil.which('arduino-cli')
        if not self.executable:
            candidate = Path('C:/Program Files/Arduino CLI/arduino-cli.exe')
            self.executable = str(candidate) if candidate.is_file() else None
        self.timeout = timeout
        self.output_limit = output_limit

    async def _terminate(self, process):
        if process.returncode is not None:
            return
        if os.name == 'nt':
            killer = await asyncio.create_subprocess_exec(
                str(Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/taskkill.exe'),
                '/PID', str(process.pid), '/T', '/F',
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            )
            try:
                await asyncio.wait_for(killer.wait(), 5)
            except TimeoutError:
                killer.kill()
                await killer.wait()
        else:
            import signal
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        if process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
        await asyncio.wait_for(process.wait(), 5)

    def _esp32_artifact(self, output, build, board, binary):
        if len(binary) != board['flash_size_bytes']:
            fail(502, 'Compiler did not produce a complete ESP32 merged flash image.')
        segments = []
        for name, offset, filename in [
            ('bootloader', board['bootloader_offset'], 'sketch.ino.bootloader.bin'),
            ('partitions', 0x8000, 'sketch.ino.partitions.bin'),
            ('boot_app0', 0xe000, 'boot_app0.bin'),
            ('application', 0x10000, 'sketch.ino.bin'),
        ]:
            path = output / filename
            if not path.is_file():
                path = build / filename
            if not path.is_file() or not 0 < path.stat().st_size <= len(binary) - offset:
                fail(502, f'Compiler produced no valid ESP32 {name} segment.')
            data = path.read_bytes()
            if binary[offset:offset + len(data)] != data:
                fail(502, f'ESP32 merged flash image does not match its {name} segment.')
            if name in ('bootloader', 'application'):
                chip_id = {'esp32': 0, 'esp32s3': 9, 'esp32c3': 5}[board['chip']]
                if len(data) < 24 or data[0] != 0xe9 or int.from_bytes(data[12:14], 'little') != chip_id:
                    fail(502, f'Compiler produced an invalid {board["chip"]} {name} image.')
            if name == 'partitions' and not data.startswith(b'\xaa\x50'):
                fail(502, 'Compiler produced an invalid ESP32 partition table.')
            segments.append({'name': name, 'filename': filename, 'offset': offset, 'size_bytes': len(data)})
        if any(first['offset'] + first['size_bytes'] > second['offset'] for first, second in zip(segments, segments[1:])):
            fail(502, 'Compiler produced overlapping ESP32 flash segments.')
        return {'bin': base64.b64encode(binary).decode('ascii'), 'encoding': 'base64',
                'load_address': 0, 'size_bytes': len(binary), 'image_kind': 'merged-flash',
                'chip': board['chip'], 'flash_size_bytes': len(binary), 'flash_segments': segments}

    async def compile(self, project):
        board = BOARD_CONFIG.get(project['board'])
        if board is None:
            fail(400, 'Unsupported compiler board.')
        if not board['compile']:
            fail(400, board['unavailable_reason'])
        if not self.executable or not Path(self.executable).is_file():
            fail(503, 'Arduino CLI is unavailable. Install it or configure ARDUINO_CLI_PATH.')
        source = source_text(project['firmware']['source'])
        compile_source = '#define Serial Serial1\n' + source if board['runtime'] == 'rp2040js' else source
        with tempfile.TemporaryDirectory(prefix='wireup-compile-') as directory:
            sketch = Path(directory) / 'sketch'
            sketch.mkdir()
            (sketch / 'sketch.ino').write_text(compile_source, encoding='utf-8')
            output = Path(directory) / 'output'
            try:
                process = await asyncio.create_subprocess_exec(
                    str(self.executable), 'compile', '--fqbn', board['fqbn'],
                    '--output-dir', str(output), '--build-path', str(Path(directory) / 'build'), str(sketch),
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                    **({'start_new_session': True} if os.name != 'nt' else {}),
                )
            except OSError:
                fail(503, 'Arduino CLI could not be started.')
            async def drain(stream):
                data = bytearray()
                while chunk := await stream.read(8192):
                    if len(data) + len(chunk) > self.output_limit:
                        raise ValueError('Compiler output exceeded the safe limit.')
                    data.extend(chunk)
                return data.decode('utf-8', errors='replace')
            tasks = [asyncio.create_task(drain(process.stdout)), asyncio.create_task(drain(process.stderr)),
                     asyncio.create_task(process.wait())]
            try:
                deadline = self.timeout if self.timeout is not None else board.get('compile_timeout_seconds', 90)
                stdout, stderr, code = await asyncio.wait_for(asyncio.gather(*tasks), deadline)
            except (TimeoutError, ValueError, asyncio.CancelledError) as error:
                await asyncio.shield(self._terminate(process))
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
                if isinstance(error, asyncio.CancelledError):
                    raise
                if isinstance(error, TimeoutError):
                    fail(504, 'Arduino compilation timed out.')
                fail(502, str(error))
            artifact_format = board['format']
            artifact_path = output / ('sketch.ino.merged.bin' if board.get('chip') else f'sketch.ino.{artifact_format}')
            successful = code == 0 and artifact_path.is_file()
            result = {'status': ('simulation_ready' if board['simulation'] == 'browser' else 'compilation_complete') if successful else 'error',
                      'simulation': board['simulation'], 'runtime': board['runtime'],
                      'unavailable_reason': board.get('unavailable_reason'),
                      'stdout': stdout, 'stderr': stderr, 'errors': [] if code == 0 else stderr.splitlines(),
                      'source_revision': project['firmware']['revision'], 'project_revision': project['revision'],
                      'source': source, 'compile_source': compile_source, 'fqbn': board['fqbn'],
                      'board': project['board'], 'artifact': None, 'compiled_at': now()}
            if successful:
                if artifact_path.stat().st_size > board.get('flash_size_bytes', 2000000):
                    fail(502, 'Compiled artifact exceeded the safe limit.')
                artifact = {'id': uuid.uuid4().hex, 'format': artifact_format, 'board': project['board'],
                            'fqbn': board['fqbn'], 'source_revision': project['firmware']['revision'],
                            'project_revision': project['revision']}
                if artifact_format == 'hex':
                    hex_text = artifact_path.read_text(encoding='ascii')
                    if not hex_text.startswith(':') or ':00000001FF' not in hex_text:
                        fail(502, 'Compiler did not produce a valid Intel HEX artifact.')
                    artifact['hex'] = hex_text
                elif board.get('chip'):
                    artifact.update(self._esp32_artifact(output, Path(directory) / 'build', board, artifact_path.read_bytes()))
                else:
                    binary = artifact_path.read_bytes()
                    if len(binary) < 264:
                        fail(502, 'Compiler produced an incomplete RP2040 flash image.')
                    stack = int.from_bytes(binary[256:260], 'little')
                    entry = int.from_bytes(binary[260:264], 'little')
                    if not (0x20000000 <= stack <= 0x20042000 and entry & 1 and 0x10000100 <= entry < 0x10200000):
                        fail(502, 'Compiler produced an invalid RP2040 flash vector table.')
                    artifact.update({'bin': base64.b64encode(binary).decode('ascii'), 'encoding': 'base64',
                                     'load_address': 0x10000000, 'size_bytes': len(binary)})
                result['artifact'] = artifact
            elif code == 0:
                result['errors'] = [f'Arduino CLI produced no {artifact_path.name} artifact.']
            return result
