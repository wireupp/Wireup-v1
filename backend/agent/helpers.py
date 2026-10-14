"""Pure helpers for the agent graph: intent detection, error shaping, redaction,
message normalisation, and lazy service access.

Split out of the former single backend/agent.py module during phase v01. No tool execution
and no graph state lives here.
"""

import json
import re

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from pydantic import ValidationError

from backend.agent.limits import SYSTEM_PROMPT

def _board_catalog():
    from backend.hardware import BOARD_CONFIG
    return {kind: config for kind, config in BOARD_CONFIG.items() if kind.startswith(('arduino-', 'esp32'))}


def _board_question(user_text):
    catalog = _board_catalog()
    preferred = ['arduino-uno', 'arduino-nano', 'arduino-mega', 'esp32-c3', 'esp32-s3']
    mentioned = sorted([key for key, item in catalog.items()
                        if re.search(r'(?<![\w-])' + re.escape(key) + r'(?![\w-])', user_text.lower())
                        or item['name'].lower() in user_text.lower()], key=len, reverse=True)
    choices = list(dict.fromkeys([*mentioned, *preferred, *catalog]))[:5]
    return {'id': 'board', 'question': 'Which board should this project use?',
            'options': [{'id': key, 'label': catalog[key]['name']} for key in choices]
                       + [{'id': 'none', 'label': 'No board (analog circuit)'}]}


def _requirements(value):
    if not isinstance(value, dict) or not 1 <= len(value) <= 20:
        raise ValueError('Confirmed requirements must be a nonempty object with at most 20 answers.')
    for key, answer in value.items():
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', key):
            raise ValueError('Invalid requirements question ID.')
        if not isinstance(answer, str) or not answer.strip() or len(answer) > 1000:
            raise ValueError('Requirements answers must be nonempty strings of at most 1000 characters.')
    return dict(value)


def _latest_user(history):
    for message in reversed(history):
        if isinstance(message, HumanMessage):
            return _text(message.content)
        role = message.get('role') if isinstance(message, dict) else getattr(message, 'role', None)
        if role == 'user':
            return _text(message.get('content') if isinstance(message, dict) else message.content)
    return ''


def _build_intent(text):
    # Negated secondary actions must not cancel an affirmative build request.
    text = re.sub(r'\b(?:do not|don\'t|never)\s+(?:build|create|wire|compile|modify|edit|run|replace)\b', '', text, flags=re.I)
    if re.search(r'^\s*(?:how (?:do|can|would)|explain|what (?:is|are)|tell me about)\b', text, re.I):
        return False
    return bool(re.search(r'\b(?:build|create|make|assemble|wire|connect|compile|generate|implement|add|edit|modify|replace|remove|run|start|blink|sweep)\b', text, re.I))


def _firmware_intent(text):
    if re.search(r'^\s*(?:how (?:do|can|would)|explain|what (?:is|are)|tell me about)\b', text, re.I):
        return False
    text = re.sub(r'\b(?:do not|don\'t|never|without)\b[^.;\n]*', '', text, flags=re.I)
    if not re.search(r'\b(?:firmware|code|sketch|software)\b', text, re.I):
        return False
    if re.search(r'\b(?:build|assemble|wire|rewire|connect|disconnect)\b|'
                 r'\b(?:add|remove|replace|change|modify|update|move|switch|use|create|make|generate)\s+(?:(?:the|a|an|existing|selected|current|new)\s+)*'
                 r'(?:board|circuit|wires?|wiring|pins?|components?)\b|'
                 r'\b(?:add|remove|replace)\s+(?:[\w-]+\s+){0,3}'
                 r'(?:boards?|circuits?|components?|sensors?|leds?|resistors?|motors?|servos?|displays?|buttons?)\b', text, re.I):
        return False
    return bool(re.search(r'\b(?:edit|change|update|fix|generate|write|create|replace|modify|implement|add|remove)\b', text, re.I))


def _bounded(value, default, ceiling):
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 < value <= ceiling:
        raise ValueError('Invalid agent execution bound.')
    return value


def _public(value):
    if isinstance(value, dict):
        return {key: _public(item) for key, item in value.items() if key != 'runtime_token'}
    if isinstance(value, list):
        return [_public(item) for item in value]
    return value


def _text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return ''.join(block.get('text', '') for block in content if isinstance(block, dict) and block.get('type') == 'text')
    return ''


def _failed(result) -> bool:
    return isinstance(result, dict) and (
        result.get('success') is False or result.get('ok') is False
        or result.get('status') in ('error', 'failed', 'failure') or bool(result.get('error'))
    )


def _tool_error(error: Exception, runtime_token=None) -> str:
    def redact(value, depth=0):
        if depth > 6:
            return '[truncated]'
        if isinstance(value, dict):
            return {key: redact(item, depth + 1) for key, item in list(value.items())[:40]
                    if not re.search(r'token|secret|password|authorization|api[_-]?key|cookie|credential', str(key), re.I)}
        if isinstance(value, list):
            return [redact(item, depth + 1) for item in value[:40]]
        if isinstance(value, str):
            return (value.replace(runtime_token, '[redacted]') if runtime_token else value)[:4000]
        return value

    if isinstance(error, ValidationError):
        detail = 'Invalid tool arguments: ' + '; '.join(
            f'{".".join(map(str, item["loc"]))}: {item["msg"]}'
            for item in error.errors(include_input=False, include_url=False)
        )
    elif isinstance(error, (ValueError, FileNotFoundError)):
        detail = str(error)
    else:
        detail = getattr(error, 'detail', None)
    if isinstance(detail, (dict, list)):
        detail = json.dumps(redact(detail), ensure_ascii=False, default=str)
    if not isinstance(detail, str):
        detail = 'The hardware tool failed. Check project, compiler, and browser availability.'
    return (detail.replace(runtime_token, '[redacted]') if runtime_token else detail)[:4000]


def _provider_error(error: Exception) -> str:
    status = getattr(error, 'status_code', None)
    name = type(error).__name__.lower()
    aws = getattr(error, 'response', {}).get('Error', {}) if isinstance(getattr(error, 'response', None), dict) else {}
    code = aws.get('Code', '')
    if code in ('AccessDeniedException', 'UnrecognizedClientException', 'InvalidSignatureException', 'ExpiredTokenException'):
        if 'api key' in aws.get('Message', '').lower() and ('valid' in aws.get('Message', '').lower() or 'authentication failed' in aws.get('Message', '').lower()):
            return 'Amazon Bedrock rejected BEDROCK_API_KEY as invalid. Generate a fresh Bedrock API key and update .env.'
        return 'Amazon Bedrock authorization failed. Check the selected authentication mode, credentials, IAM permissions, and regional model access.'
    if code == 'ValidationException':
        if 'operation not allowed' in aws.get('Message', '').lower():
            return 'Amazon Bedrock rejected inference with Operation not allowed. Check account/model access and regional inference permissions.'
        return 'Amazon Bedrock rejected the inference parameters. Check model support and output-token limits.'
    if code in ('ThrottlingException', 'ServiceQuotaExceededException'):
        return 'Amazon Bedrock quota or throttling limit reached. Check regional quotas and retry.'
    if status == 401 or 'authentication' in name:
        return 'Groq authentication failed. Check the configured API key.'
    if status == 429 or 'ratelimit' in name:
        body = getattr(error, 'body', None)
        detail = str(body or '')
        interval = re.search(r'try again in ([0-9.]+)s', detail, re.I)
        limit = re.search(r'Limit ([0-9]+)', detail)
        if 'tokens per minute' in detail.lower():
            return 'Groq token-per-minute limit reached' + (f' ({limit.group(1)} tokens/minute)' if limit else '') + (f'. Retry in {float(interval.group(1)):.0f} seconds.' if interval else '. Retry after the quota resets.')
        return 'Groq rate limit reached. Please try again later.'
    if status == 403 or 'permission' in name:
        return 'Groq authorization failed. Check API key permissions and model access.'
    if status == 404:
        return 'The selected model is unavailable. Check its model identifier and account access.'
    if status in (400, 422):
        body = getattr(error, 'body', None)
        detail = str(body or '').lower()
        if 'tool' in detail or 'function' in detail:
            return 'The selected model rejected the hardware tool-calling request. Choose a model that supports structured tools or check its tool schema compatibility.'
        if 'context' in detail or 'token' in detail:
            return 'The selected model rejected the conversation length. Start a new chat or choose a model with a larger context window.'
        return 'The model provider rejected this request. Check the selected model and its supported request parameters.'
    if 'timeout' in name or isinstance(error, TimeoutError):
        return 'The model provider did not respond within 20 seconds. Retry or select another model.'
    if 'connection' in name:
        return 'Could not connect to the model provider. Check the network connection and retry.'
    return 'The model could not complete this response. Check model access and connection.'


def _history(history) -> list[BaseMessage]:
    messages = [SystemMessage(content=SYSTEM_PROMPT)]
    for message in history:
        if isinstance(message, BaseMessage):
            messages.append(message)
        else:
            role = message.get('role') if isinstance(message, dict) else message.role
            content = message.get('content') if isinstance(message, dict) else message.content
            if role not in ('user', 'assistant', 'system'):
                raise ValueError('Unsupported conversation role.')
            cls = {'user': HumanMessage, 'assistant': AIMessage, 'system': SystemMessage}[role]
            messages.append(cls(content=content))
    return messages


def _get_service():
    from backend.hardware import service
    return service


def _get_feasibility():
    from backend import feasibility
    return feasibility


async def _calculator(expression):
    from backend.hardware import calculator
    return calculator(expression)
