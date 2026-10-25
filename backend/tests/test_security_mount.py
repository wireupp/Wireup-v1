from fastapi.testclient import TestClient
from backend.app import create_app


def test_live_api_stack_rejects_oversized_chat_body():
    response = TestClient(create_app(api_key='test')).post('/api/chat', content='x' * 600001, headers={'Content-Type': 'application/json'})
    assert response.status_code == 413
    assert response.headers['x-content-type-options'] == 'nosniff'


def test_production_mode_without_token_fails_closed(monkeypatch):
    monkeypatch.setenv('WIREUP_DEPLOYMENT', 'production')
    monkeypatch.delenv('WIREUP_ACCESS_TOKEN', raising=False)
    import pytest
    with pytest.raises(ValueError):
        with TestClient(create_app(api_key='test')):
            pass


def test_production_preview_sign_in_sets_session_cookie(monkeypatch, tmp_path):
    monkeypatch.setenv('WIREUP_DEPLOYMENT', 'production')
    monkeypatch.setenv('WIREUP_ACCESS_TOKEN', 'wireup-test-token')
    monkeypatch.setenv('WIREUP_ALLOWED_ORIGINS', 'https://preview.example')
    monkeypatch.setenv('WIREUP_DATA_DIR', str(tmp_path))
    with TestClient(create_app(api_key='test'), base_url='https://preview.example') as client:
        assert client.get('/api/auth/session').json() == {'required': True, 'authenticated': False}
        assert client.get('/api/hardware/projects', headers={'Origin': 'https://preview.example'}).status_code == 401
        login = client.post('/api/auth/login', json={'password': 'wireup-test-token'}, headers={'Origin': 'https://preview.example'})
        assert login.status_code == 200
        assert client.get('/api/auth/session').json() == {'required': True, 'authenticated': True}
        assert client.get('/api/hardware/projects', headers={'Origin': 'https://preview.example'}).status_code == 200
        assert client.get('/api/hardware/projects', headers={'Origin': 'https://untrusted.example'}).status_code == 403
        assert client.post('/api/auth/logout', headers={'Origin': 'https://preview.example'}).status_code == 200
        assert client.get('/api/hardware/projects', headers={'Origin': 'https://preview.example'}).status_code == 401
