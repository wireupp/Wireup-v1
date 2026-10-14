"""HTTP routes and the loopback guard.

Split out of the former single backend/hardware.py module during phase v01. `router` and
`service` are re-exported from backend.hardware with unchanged import paths.
"""

import base64
import ipaddress
import json
import os
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect
from starlette.requests import HTTPConnection
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field


from backend.hardware.util import (
    fail,
)
from backend.hardware.projects import (
    HardwareService,
)


class CreateProject(BaseModel):
    name: str = Field(default='Untitled circuit', min_length=1, max_length=120)
    board: str = 'unselected'


class HardwareCommand(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    args: dict = Field(default_factory=dict)
    runtime_token: str | None = Field(default=None, max_length=200)


def local_connection(connection):
    security = connection.scope.get('wireup.security', {})
    if security.get('production'):
        return bool(security.get('authentication_required') and security.get('authenticated') and (not security.get('origin_present') or security.get('trusted_origin')))
    def loopback(host):
        if host in ('localhost', 'testclient', 'testserver'):
            return True
        try:
            return ipaddress.ip_address(host).is_loopback
        except ValueError:
            return False
    if connection.client is None or not loopback(connection.client.host):
        return False
    try:
        host = urlsplit('http://' + connection.headers.get('host', '')).hostname
        origin = connection.headers.get('origin')
        if not host or not loopback(host):
            return False
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme not in ('http', 'https') or not loopback(parsed.hostname):
                return False
    except ValueError:
        return False
    return True


def create_router(hardware_service):
    async def local_only(connection: HTTPConnection, response: Response):
        if not local_connection(connection):
            if connection.scope['type'] == 'websocket':
                await connection.close(code=4403)
            fail(403, 'Hardware API is local-only; loopback client, Host, and Origin are required.')
        response.headers['Cache-Control'] = 'no-store'
        response.headers['Referrer-Policy'] = 'no-referrer'
    api = APIRouter(prefix='/api/hardware', tags=['hardware'], dependencies=[Depends(local_only)])

    @api.post('/projects')
    async def create_project(payload: CreateProject):
        return hardware_service.create_project(payload.name, payload.board)

    @api.get('/projects')
    async def list_projects():
        return hardware_service.list_projects()

    @api.get('/projects/{project_id}')
    async def get_project(project_id: str):
        return hardware_service.get_project(project_id)

    @api.delete('/projects/{project_id}')
    async def delete_project(project_id: str):
        return hardware_service.delete_project(project_id)

    @api.get('/catalog')
    async def catalog(q: str = '', limit: int = 50):
        return hardware_service.catalog.search(q, limit)

    @api.post('/project/{project_id}/command')
    async def command(project_id: str, payload: HardwareCommand):
        return await hardware_service.command(project_id, payload.name, payload.args, payload.runtime_token)

    @api.get('/project/{project_id}/artifacts/{artifact_id}')
    async def artifact(project_id: str, artifact_id: str):
        result = hardware_service.get_artifact(project_id, artifact_id)
        headers = {'Content-Disposition': f'attachment; filename="sketch.ino.{result["format"]}"',
                   'X-Source-Revision': str(result['source_revision']),
                   'X-Project-Revision': str(result['project_revision']),
                   'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}
        if result['format'] == 'bin':
            return Response(base64.b64decode(result['bin'], validate=True), media_type='application/octet-stream', headers=headers)
        return PlainTextResponse(result['hex'], headers=headers)

    @api.websocket('/project/{project_id}/runtime')
    async def runtime(websocket: WebSocket, project_id: str):
        try:
            project = hardware_service.get_project(project_id)
            hardware_service.authorize_runtime(project, websocket.query_params.get('token'))
        except HTTPException as error:
            await websocket.close(code=4403 if error.status_code == 403 else 4404)
            return
        await websocket.accept()
        if not await hardware_service.runtime.attach(project_id, websocket):
            return
        try:
            await websocket.send_json({'type': 'runtime_connected', 'project_id': project_id})
            while True:
                raw = await websocket.receive_text()
                if len(raw) > 256000:
                    await websocket.close(code=4400)
                    break
                try:
                    message = json.loads(raw)
                except ValueError:
                    await websocket.close(code=4400)
                    break
                hardware_service.runtime.acknowledge(project_id, message)
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass
        finally:
            hardware_service.runtime.detach(project_id, websocket)

    from backend.build_guide import create_router as create_build_guide_router
    api.include_router(create_build_guide_router(hardware_service))
    from backend.board_flash import create_router as create_flash_router
    api.include_router(create_flash_router(hardware_service, prefix=''))
    from backend.native_esp32 import create_router as create_native_router
    api.include_router(create_native_router(hardware_service))
    return api


service = HardwareService()


router = create_router(service)
