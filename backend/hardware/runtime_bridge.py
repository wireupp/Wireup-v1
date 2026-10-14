"""Browser runtime session bridge.

Split out of the former single backend/hardware.py module during phase v01. Owns the
per-project WebSocket sessions and the acknowledged command round trip.
"""

import asyncio
import json
import uuid

from fastapi import HTTPException, WebSocketDisconnect


from backend.hardware.util import (
    fail,
)


class RuntimeBridge:
    def __init__(self, timeout=10):
        self.timeout = timeout
        self.sessions = {}
        self.pending = {}

    async def attach(self, project_id, websocket):
        if project_id in self.sessions:
            await websocket.close(code=4409)
            return False
        self.sessions[project_id] = websocket
        self.pending[project_id] = {}
        return True

    def detach(self, project_id, websocket):
        if self.sessions.get(project_id) is not websocket:
            return
        self.sessions.pop(project_id, None)
        for future in self.pending.pop(project_id, {}).values():
            if not future.done():
                future.set_exception(HTTPException(503, 'Browser runtime disconnected.'))

    def acknowledge(self, project_id, message):
        if not isinstance(message, dict) or message.get('type') != 'ack':
            return
        correlation = message.get('id')
        if not isinstance(correlation, str):
            return
        future = self.pending.get(project_id, {}).get(correlation)
        if future and not future.done():
            if message.get('ok') is True and isinstance(message.get('result'), dict):
                future.set_result(message['result'])
            else:
                error = str(message.get('error', 'Browser runtime rejected the command.'))[:2000]
                future.set_exception(HTTPException(502, error))

    async def command(self, project_id, name, args):
        if len(self.pending.get(project_id, {})) >= 32:
            fail(429, 'Too many pending browser runtime commands.')
        websocket = self.sessions.get(project_id)
        if not websocket:
            fail(503, 'No browser runtime is connected to this project.')
        correlation = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self.pending[project_id][correlation] = future
        try:
            await asyncio.wait_for(websocket.send_json({'type': 'command', 'id': correlation, 'name': name,
                                                        'args': args, 'project_id': project_id}), self.timeout)
            result = await asyncio.wait_for(future, self.timeout)
            return {'status': 'acknowledged', 'command': name, 'id': correlation, 'result': result}
        except TimeoutError:
            fail(504, 'Browser runtime acknowledgement timed out.')
        except (WebSocketDisconnect, RuntimeError, OSError):
            fail(503, 'Browser runtime disconnected.')
        finally:
            self.pending.get(project_id, {}).pop(correlation, None)
            if not future.done():
                future.cancel()
