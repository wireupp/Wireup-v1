"""The request-local LangGraph agent and its node implementations.

Split out of the former single backend/agent.py module during phase v01. Behaviour is
unchanged; the public entry point remains `stream_agent`.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from contextlib import aclosing
from typing import Annotated, AsyncIterator, TypedDict
from uuid import uuid4

from langchain_core.messages import (
    AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage,
    ToolMessage, message_chunk_to_message,
)
from langchain_core.tools import StructuredTool
from langgraph.config import get_stream_writer
from langgraph.errors import GraphRecursionError
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from fastapi import HTTPException
from pydantic import ValidationError

from backend.agent.limits import (
    MAX_MODEL_CALLS, MAX_SECONDS, MAX_TOOL_CALLS, RECURSION_LIMIT, SYSTEM_PROMPT,
)
from backend.agent.schemas import (
    _ASSESSMENT_TOOLS, _CONFIRM_FIRST, _DESCRIPTIONS, _FIRMWARE_TOOLS, _MUTATIONS,
    _READ_FIRST, _SCHEMAS, TOOL_NAMES,
)
from backend.agent.helpers import (
    _board_catalog, _board_question, _bounded, _build_intent, _calculator, _failed, _firmware_intent,
    _get_feasibility, _get_service, _history, _latest_user, _provider_error, _public,
    _requirements, _text, _tool_error,
)

class _State(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    retry_verification: bool


class _LimitReached(Exception):
    pass


class _IncompleteBuild(Exception):
    pass


class _IncompleteResponse(Exception):
    pass


class _InvalidRequirements(ValueError):
    pass


async def stream_agent(model, history, project_id=None, runtime_token=None, requirements=None,
                       *, approval=None, max_tool_calls=None, max_model_calls=None, timeout_seconds=None) -> AsyncIterator[dict]:
    """Yield text, actual tool activity, and one terminal metadata event.

    History accepts LangChain messages or role/content objects. Close the generator
    or cancel its consuming task on disconnect; cancellation is propagated to the
    model and active hardware operation. No checkpoint, replay, or retries are used.
    """
    started = time.perf_counter()
    model_calls = 0
    tool_calls = 0
    project_read = False
    project_revision = None
    selected_board = None
    assessment = None
    approval_id = None
    approved_plan = None
    compile_attempts = 0
    current_compile = None
    readback_revision = None
    validation_revision = None
    verification_corrections = 0
    repeated_failures: dict[str, int] = {}
    board_unselected = False
    confirmed = False
    needs_questions = False
    paused = False
    build_requested = False
    firmware_requested = False
    compile_requested = False
    emergency_stop = False
    successful_tools: dict[str, int] = {}
    attempted_tools: dict[str, int] = {}
    failed_tools: dict[str, int] = {}
    changes = {'componentsAdded': 0, 'componentsRemoved': 0, 'componentsModified': 0,
               'wiresAdded': 0, 'wiresRemoved': 0, 'firmwareWrites': 0}
    active: dict[str, str] = {}
    used_call_ids: set[str] = set()
    usage = None
    actual_model = getattr(model, 'model_name', None) or getattr(model, 'model', None)
    status = 'success'
    reason = None

    async def execute(name, args):
        nonlocal project_read, project_revision, paused, selected_board, board_unselected
        nonlocal assessment, approval_id, approved_plan, compile_attempts, current_compile, compile_requested
        nonlocal readback_revision, validation_revision
        if firmware_requested and (name not in _FIRMWARE_TOOLS or name == 'check_connections' and args.get('repair', False)):
            raise ValueError('This request is firmware-only. Preserve the current circuit; topology changes require confirmed requirements and feasibility review.')
        if name == 'ask_project_questions':
            if len({question['id'] for question in args['questions']}) != len(args['questions']):
                raise ValueError('Question IDs must be unique.')
            for question in args['questions']:
                if len({option['id'] for option in question['options']}) != len(question['options']):
                    raise ValueError('Option IDs must be unique within a question.')
            if confirmed:
                raise ValueError('Requirements are already confirmed. Execute the requested build with hardware tools.')
            questions = args['questions']
            if project_id:
                selected_board = _get_service().get_project(project_id).get('board')
                board_unselected = selected_board in (None, 'unselected', 'none')
            if project_id and board_unselected:
                board_questions = [question for question in questions if question['id'] == 'board']
                board_question = board_questions[0] if board_questions else _board_question(user_text)
                if any(option['id'] not in _board_catalog() and option['id'] not in ('none', 'ai_choose')
                       for option in board_question['options']):
                    raise ValueError('Board option IDs must be canonical catalog board keys or none.')
                questions = [board_question, *[question for question in questions if question['id'] != 'board'][:9]]
            elif project_id:
                questions = [question for question in questions if question['id'] != 'board']
                if not questions:
                    raise ValueError('The project already has a board. Ask only unresolved non-board requirements.')
            if project_id and hasattr(_get_service(), 'catalog'):
                from backend.hardware import BOARD_CONFIG, BOARD_ALIASES
                catalog = _get_service().catalog.components
                for question in questions:
                    compatible = []
                    for option in question['options']:
                        kind = option.get('component_type')
                        if not kind and option['id'] in catalog:
                            kind = option['id']
                        if kind:
                            kind = BOARD_ALIASES.get(kind.removeprefix('wokwi-'), kind.removeprefix('wokwi-'))
                            component = catalog.get(kind)
                            if not component or (kind in BOARD_CONFIG and kind not in _board_catalog()) or (kind not in BOARD_CONFIG and not component.get('pins')):
                                continue
                        compatible.append(option)
                    if not any(option['id'] == 'ai_choose' for option in compatible):
                        compatible.append({'id':'ai_choose','label':'Let AI choose','description':'Choose a compatible available device.'})
                    if len(compatible) < 2:
                        raise ValueError('This device question has no compatible alternatives. Read the supported catalog and ask again.')
                    question['options'] = compatible
            paused = True
            return {**args, 'questions': questions}
        if needs_questions and name != 'stop_simulation':
            raise ValueError('Call ask_project_questions first and wait for user-confirmed requirements. No hardware operation is allowed in this clarification turn.')
        if name != 'calculator' and not project_id:
            raise ValueError('Select or create a current hardware project before using this tool.')
        repairing_connections = name == 'check_connections' and args.get('repair', False)
        if (name in _READ_FIRST or repairing_connections) and not project_read:
            raise ValueError('Call read_project successfully before mutating or compiling the current project.')
        if (name in _CONFIRM_FIRST or repairing_connections) and not confirmed:
            raise ValueError('User-confirmed requirements are required before project mutations, compilation, or simulation start. Call ask_project_questions and wait for answers.')
        if confirmed and project_id and not approval_id and not firmware_requested and name not in _ASSESSMENT_TOOLS and name != 'stop_simulation':
            raise ValueError('Assess the complete project plan and obtain approval before any placement, mutation, compilation, or runtime operation.')
        if name == 'search_example_requirements':
            from backend.example_requirements import search_example_requirements
            return search_example_requirements(args['query'], args.get('limit', 3), board=args.get('board'))
        if name == 'get_example_reference':
            from backend.example_requirements import get_example_reference
            return get_example_reference(args['example_id'], _get_service().catalog)
        if name == 'assess_project_feasibility':
            if not confirmed or not project_read:
                raise ValueError('Confirm requirements and read_project before assessing the plan.')
            plan = args['plan']
            board_answer = requirements.get('board', selected_board)
            if board_answer != 'ai_choose' and plan['board'] != board_answer and not (plan['board'] == 'none' and board_answer in (None, 'none', 'unselected')):
                raise ValueError('The assessed board must match the confirmed board selection.')
            assessment = _public(_get_feasibility().assess(_get_service(), project_id, {**plan, 'requirements_text': user_text + '\n' + json.dumps(requirements)}))
            if assessment.get('status') == 'awaiting_approval':
                assessment = _public(_get_feasibility().authorize(_get_service(), project_id, {'assessment_id': assessment['id'], 'choice': 'hardware_only'}))
            if assessment.get('status') == 'approved':
                approval_id = assessment['id']
                approved_plan = assessment['plan']
                compile_requested = 'compile_firmware' in approved_plan['operations']
                _get_feasibility().validate_approval(_get_service(), project_id, approval_id)
            else:
                approval_id = None
                approved_plan = None
                raise ValueError('The proposed design contains incompatible devices. Select only the compatible choices from the setup answers; no changes were authorized. Details: ' + json.dumps(assessment.get('issues', [])))
            return assessment
        if (name in _CONFIRM_FIRST or repairing_connections) and (approval_id or not firmware_requested):
            if not approval_id:
                raise ValueError('Complete the feasibility review before changing the project.')
            _get_feasibility().check_operation(_get_service(), project_id, approval_id, name, args)
            if name not in approved_plan['operations']:
                raise ValueError('This operation is outside the reviewed plan. Reassess before proceeding.')
        if approval_id and name in ('add_component', 'compile_firmware', 'run_simulation', 'validate_circuit', 'check_connections'):
            from backend.hardware import BOARD_ALIASES
            def canonical(kind):
                kind = kind.removeprefix('wokwi-')
                return BOARD_ALIASES.get(kind, kind)
            allowed = {canonical(part['type']) for part in approved_plan['parts']} | {approved_plan['board']}
            actual = _get_service().get_project(project_id)
            counts: dict[str, int] = {}
            for component in actual.get('components', []):
                kind = canonical(component.get('type', ''))
                counts[kind] = counts.get(kind, 0) + 1
            if name == 'add_component' and canonical(args['type']) not in allowed:
                raise ValueError('This component is outside the reviewed plan. Reassess before placement.')
            if name != 'add_component' and any(kind not in allowed for kind in counts):
                raise ValueError('The actual project contains parts outside the reviewed plan. Assess the actual project before compiling, running, or final validation.')
            if name == 'add_component':
                kind = canonical(args['type'])
                maximum = sum(part['quantity'] for part in approved_plan['parts'] if canonical(part['type']) == kind)
                if kind == approved_plan['board']:
                    maximum = max(1, maximum)
                if counts.get(kind, 0) >= maximum:
                    raise ValueError('This placement exceeds the reviewed part quantity. Reassess before adding more parts.')
        if name in ('compile_firmware', 'run_simulation'):
            checked = await _get_service().command(project_id, 'validate_circuit', {}, runtime_token=runtime_token)
            if checked.get('errors'):
                raise ValueError('Circuit validation found a proven connection error. Fix it before compilation or simulation: ' + json.dumps(checked['errors']))
        if compile_attempts >= 3 and (name == 'compile_firmware'
                or name in ('generate_firmware', 'edit_firmware') and not current_compile):
            raise _LimitReached('Compilation correction limit reached (at most two corrections).')
        if name == 'add_component':
            from backend.hardware import BOARD_ALIASES
            component_type = args.get('type', '').removeprefix('wokwi-')
            board_key = BOARD_ALIASES.get(component_type, component_type)
            board_answer = requirements.get('board', selected_board) if confirmed else None
            authorized_board = approved_plan['board'] if board_answer == 'ai_choose' and approved_plan else board_answer
            if board_key in _board_catalog() and (not confirmed or authorized_board != board_key):
                raise ValueError('Adding or replacing a board requires its canonical key in the confirmed board answer.')
        if (name in _READ_FIRST or repairing_connections) and project_revision is not None:
            args = {**args, 'expected_revision': args.get('expected_revision', project_revision)}
        attempted_tools[name] = attempted_tools.get(name, 0) + 1
        previous_revision = project_revision
        if name == 'compile_firmware':
            compile_attempts += 1
            current_compile = None
        if name == 'calculator' and not project_id:
            result = await _calculator(args['expression'])
        else:
            try:
                result = await _get_service().command(project_id, name, args, runtime_token=runtime_token)
            except HTTPException as error:
                if name == 'compile_firmware' and error.status_code == 503 and 'busy' in str(error.detail).lower():
                    compile_attempts -= 1
                raise
        result = _public(result)
        if name in ('wire_circuit', 'check_connections') and isinstance(result, dict) and 'project' in result:
            project_revision = result['project']['revision']
            result = {**result, 'project': {key: value for key, value in result['project'].items() if key in ('id', 'revision', 'board', 'components', 'wires')}}
        if name == 'search_components' and isinstance(result, dict):
            result = {'components': [{key: value for key, value in item.items() if key in ('id', 'name', 'category', 'pins', 'defaultValues', 'properties', 'connectable', 'supported_board')} for item in result.get('components', [])[:8]]}
        if name in _MUTATIONS and isinstance(result, dict) and 'revision' in result:
            result = {key: value for key, value in result.items() if key in ('id', 'revision', 'board', 'components', 'wires')}
        if name == 'read_project' and isinstance(result, dict):
            result = {key: value for key, value in result.items() if key in ('id', 'name', 'revision', 'board', 'components', 'wires', 'firmware')}
            result['firmware'] = {key: value for key, value in result.get('firmware', {}).items() if key != 'source'}
        if name == 'compile_firmware' and isinstance(result, dict):
            result = {key: value for key, value in result.items() if key != 'artifact'} | ({'artifact': {key: value for key, value in result['artifact'].items() if key in ('id', 'format', 'board', 'source_revision', 'project_revision', 'url')}} if result.get('artifact') else {})
        if not _failed(result):
            if name == 'read_project':
                project_read = True
                selected_board = result.get('board') if isinstance(result, dict) else None
                board_unselected = selected_board in (None, 'unselected', 'none')
            elif name == 'add_component' and isinstance(result, dict) and result.get('board') in _board_catalog():
                selected_board = result['board']
                board_unselected = False
            if isinstance(result, dict) and isinstance(result.get('revision'), int) and (name == 'read_project' or name in _MUTATIONS):
                project_revision = result['revision']
            connections_changed = name == 'check_connections' and result.get('changed') is True
            if name in _MUTATIONS or connections_changed:
                if approval_id:
                    _get_feasibility().advance(_get_service(), project_id, approval_id, previous_revision, project_revision)
                readback_revision = None
                validation_revision = None
                current_compile = None
            elif name == 'read_project':
                readback_revision = project_revision
            elif name == 'validate_circuit':
                if result.get('valid') is True and not result.get('errors') and result.get('revision') == project_revision:
                    validation_revision = project_revision
            elif name == 'compile_firmware':
                current_compile = result
            if name == 'check_connections':
                checked = result.get('validation', {})
                if checked.get('valid') is True and not checked.get('errors') and checked.get('revision') == project_revision:
                    validation_revision = project_revision
                if connections_changed:
                    changes['wiresRemoved'] += sum(item['operation'].startswith('remove_') for item in result['repairs'])
            successful_tools[name] = successful_tools.get(name, 0) + 1
            change_key = {'add_component': 'componentsAdded', 'remove_component': 'componentsRemoved',
                          'modify_component': 'componentsModified', 'connect_wire': 'wiresAdded',
                          'remove_wire': 'wiresRemoved', 'generate_firmware': 'firmwareWrites',
                          'edit_firmware': 'firmwareWrites'}.get(name)
            if change_key:
                changes[change_key] += 1
        return result

    def scoped_tool(name):
        async def invoke(**kwargs):
            return await execute(name, kwargs)

        return StructuredTool.from_function(
            coroutine=invoke, name=name, description=_DESCRIPTIONS[name], args_schema=_SCHEMAS[name],
        )

    tools = [scoped_tool(name) for name in TOOL_NAMES]

    def compiled_current_revision():
        return bool(
            current_compile and not _failed(current_compile) and current_compile.get('artifact')
            and current_compile.get('project_revision') == project_revision
            and current_compile.get('source_revision') == _get_service().get_project(project_id).get('firmware', {}).get('revision')
        )

    async def model_node(state):
        nonlocal model_calls, usage, actual_model, tool_calls, verification_corrections
        if model_calls >= model_limit:
            raise _LimitReached('Maximum model calls reached.')
        model_calls += 1
        writer = get_stream_writer()
        require_tools = needs_questions or (build_requested and not (
            any(successful_tools.get(name) for name in _MUTATIONS) or compiled_current_revision()
        ))
        available = tools
        if emergency_stop:
            available = [tool for tool in tools if tool.name == 'stop_simulation']
            require_tools = not successful_tools.get('stop_simulation') and not failed_tools.get('stop_simulation')
        elif needs_questions:
            available = [tool for tool in tools if tool.name == 'ask_project_questions']
        elif firmware_requested:
            available = [tool for tool in tools if tool.name in _FIRMWARE_TOOLS]
        elif confirmed and project_id and not approval_id:
            available = [tool for tool in tools if tool.name in _ASSESSMENT_TOOLS]
            require_tools = True
        if (approved_plan and approval_id or firmware_requested) and not emergency_stop:
            excluded = {'assess_project_feasibility', 'ask_project_questions'}
            from backend.hardware import BOARD_CONFIG
            board_capability = BOARD_CONFIG.get(selected_board if firmware_requested else approved_plan['board'], {})
            if board_capability.get('simulation') == 'unavailable': excluded.update({'run_simulation','stop_simulation','read_simulation_results'})
            if board_capability.get('compile') is False: excluded.update({'compile_firmware','read_compiler_errors'})
            available = [tool for tool in available if tool.name not in excluded]
        bound_model = model.bind_tools(available, tool_choice='required' if require_tools else 'auto')
        for attempt in range(2):
            aggregate = None
            answer_parts = []
            try:
                async with aclosing(bound_model.astream(state['messages'])) as chunks:
                    async for chunk in chunks:
                        if isinstance(chunk, AIMessage) and not isinstance(chunk, AIMessageChunk):
                            chunk = AIMessageChunk(**chunk.model_dump(exclude={'type'}))
                        if not isinstance(chunk, AIMessageChunk):
                            raise TypeError('The model must stream AIMessage or AIMessageChunk messages.')
                        aggregate = chunk if aggregate is None else aggregate + chunk
                        reasoning = chunk.additional_kwargs.get('reasoning_content')
                        if isinstance(reasoning, str) and reasoning:
                            writer({'type': 'text', 'channel': 'thinking', 'text': reasoning})
                        text = _text(chunk.content)
                        if text:
                            answer_parts.append(text)
                            if needs_questions or build_requested:
                                writer({'type': 'text', 'channel': 'narration', 'text': text})
                        actual_model = chunk.response_metadata.get('model_name') or actual_model
                break
            except Exception as error:
                status_code = getattr(error, 'status_code', None)
                response = getattr(error, 'response', None)
                if status_code == 429 and aggregate is None and attempt == 0:
                    retry = getattr(response, 'headers', {}).get('retry-after') if response is not None else None
                    detail = str(getattr(error, 'body', ''))
                    match = re.search(r'(?:try again|retry) in ([\d.]+)s', detail, re.I)
                    try: delay = float(retry) if retry else float(match.group(1)) if match else 0.0
                    except ValueError: delay = 10.0
                    if 0 < delay <= 30:
                        writer({'type':'text','channel':'narration','text':f'Provider is rate-limited; retrying this model request once after {int(delay + 1)} seconds. No tool changes are replayed.\n'})
                        await asyncio.sleep(delay + 1)
                        continue
                raise
        if aggregate is None:
            raise ValueError('The model returned no response.')
        if aggregate.usage_metadata:
            latest = aggregate.usage_metadata
            usage = {key: (usage or {}).get(key, 0) + latest.get(key, 0) for key in ('input_tokens', 'output_tokens', 'total_tokens')}
        if aggregate.response_metadata.get('finish_reason') == 'length':
            raise _IncompleteResponse('The model response reached its output-token limit. No truncated tool calls were executed; retry with a larger output-token limit.')
        message = message_chunk_to_message(aggregate)
        message.additional_kwargs.pop('reasoning_content', None)
        if not message.tool_calls and not message.invalid_tool_calls:
            if needs_questions:
                raise _IncompleteBuild('No requirements questions were produced. Submit the build request again; the agent must ask structured questions before making changes.')
            if build_requested and not any(successful_tools.get(name) for name in _CONFIRM_FIRST):
                if attempted_tools and failed_tools:
                    raise _IncompleteBuild('The requested build is blocked by tool errors. No requested project change succeeded; review the tool errors and correct the project or requirements.')
                raise _IncompleteBuild('The agent returned advice without executing the requested build. No changes were made. Retry with confirmed requirements and an explicit build instruction.')
            if firmware_requested and not any(successful_tools.get(name) for name in ('edit_firmware', 'generate_firmware')):
                raise _IncompleteBuild('The requested firmware change did not succeed. Review the tool errors; no firmware update was verified.')
            if project_id and (approval_id or firmware_requested) and (build_requested or any(successful_tools.get(name) for name in _CONFIRM_FIRST)):
                if approval_id:
                    _get_feasibility().validate_approval(_get_service(), project_id, approval_id)
                for check in (('read_project',) if firmware_requested else ('read_project', 'validate_circuit')):
                    if (check == 'read_project' and readback_revision == project_revision
                            or check == 'validate_circuit' and validation_revision == project_revision):
                        continue
                    if tool_calls >= tool_limit:
                        raise _LimitReached('Maximum tool calls reached.')
                    tool_calls += 1
                    step_id = f'tool_{uuid4().hex}'
                    active[step_id] = check
                    writer({'type': 'step_start', 'id': step_id, 'label': check.replace('_', ' ').capitalize(),
                            'command': check + '({})', 'toolName': check, 'args': {}})
                    checked = await execute(check, {})
                    invalid = _failed(checked) or (check == 'validate_circuit' and (checked.get('valid') is not True or checked.get('errors')))
                    writer({'type': 'step_end', 'id': step_id, 'status': 'error' if invalid else 'success',
                            'output': json.dumps(checked, ensure_ascii=False), 'result': checked})
                    active.pop(step_id, None)
                    if invalid:
                        if verification_corrections < 2:
                            verification_corrections += 1
                            return {'messages': [message, SystemMessage(content='Final verification failed: ' + json.dumps(checked) + '. Correct only within the approved plan, then reread and validate. Do not claim success yet.')], 'retry_verification': True}
                        raise _IncompleteBuild('Final project readback or circuit validation failed after two correction attempts. The build is not verified; review the reported errors.')
            if compile_requested and not compiled_current_revision():
                raise _IncompleteBuild('The requested compilation has no successful artifact for the current project. Review diagnostics and compile the current revision.')
            if not any(answer_parts):
                raise ValueError('The model returned no answer text.')
            # Buffer until the complete turn proves that no tool calls follow.
            for part in answer_parts:
                writer({'type': 'text', 'channel': 'answer', 'text': part})
        return {'messages': [message], 'retry_verification': False}

    async def tool_node(state):
        nonlocal tool_calls
        writer = get_stream_writer()
        message = state['messages'][-1]
        results = []
        calls = [*message.tool_calls, *message.invalid_tool_calls]
        for index, call in enumerate(calls):
            if paused:
                break
            if tool_calls >= tool_limit:
                raise _LimitReached('Maximum tool calls reached.')
            tool_calls += 1
            name = call['name'] or 'unknown_tool'
            call_id = call.get('id') or f'call_{uuid4().hex}'
            step_id = f'tool_{uuid4().hex}'
            args = call.get('args', {})
            active[step_id] = name
            writer({'type': 'step_start', 'id': step_id, 'label': name.replace('_', ' ').capitalize(),
                    'command': name + '(' + json.dumps(_public(args), ensure_ascii=False) + ')',
                    'toolName': name, 'args': _public(args)})
            try:
                if call_id in used_call_ids:
                    raise ValueError('Duplicate tool call ID refused; mutations are never replayed.')
                used_call_ids.add(call_id)
                if name not in _SCHEMAS:
                    raise ValueError('Unknown tool. Use one of the bound hardware tools.')
                if not isinstance(args, dict):
                    raise ValueError('Invalid tool arguments: expected a JSON object.')
                validated = _SCHEMAS[name].model_validate(args).model_dump(exclude_none=True, by_alias=True)
                if name == 'edit_firmware' and not (
                    ('source' in validated and 'old' not in validated and 'new' not in validated)
                    or ('source' not in validated and 'old' in validated and 'new' in validated)
                ):
                    raise ValueError('Provide either source or both old and new, not both forms.')
                result = await execute(name, validated)
                output = json.dumps(result, ensure_ascii=False, allow_nan=False)
                failed = _failed(result)
            except (asyncio.CancelledError, _LimitReached):
                raise
            except Exception as error:
                detail = _tool_error(error, runtime_token)
                result = {'status': 'error', 'error': detail}
                output = json.dumps(result, ensure_ascii=False)
                failed = True
            if failed:
                failed_tools[name] = failed_tools.get(name, 0) + 1
            writer({'type': 'step_end', 'id': step_id, 'status': 'error' if failed else 'success', 'output': output, 'result': result})
            active.pop(step_id, None)
            if name == 'ask_project_questions' and not failed:
                writer({'type': 'questions', **result})
            if name == 'assess_project_feasibility' and not failed:
                writer({'type': 'feasibility', **result})
            results.append(ToolMessage(content=output, tool_call_id=call_id, name=name, status='error' if failed else 'success'))
            failure_key = name + ':' + json.dumps(args, sort_keys=True, ensure_ascii=False)
            if failed:
                repeated_failures[failure_key] = repeated_failures.get(failure_key, 0) + 1
                if repeated_failures[failure_key] >= 3:
                    raise _LimitReached('Three identical failed tool calls reached. Correct the plan or arguments instead of retrying.')
            else:
                repeated_failures.pop(failure_key, None)
        return {'messages': results}

    def route(state):
        if state.get('retry_verification'):
            return 'model'
        message = state['messages'][-1]
        return 'tools' if message.tool_calls or message.invalid_tool_calls else END

    try:
        history = list(history)
        user_text = _latest_user(history)
        prefix = 'Project requirements confirmed:'
        if requirements is None and user_text.startswith(prefix):
            payload = user_text[len(prefix):].split('\n', 1)[0].strip()
            if len(payload) > 24000:
                raise ValueError('Confirmed requirements are too large.')
            requirements = json.loads(payload)
        if requirements is not None:
            requirements = _requirements(requirements)
            if 'board' in requirements and requirements['board'] not in ('none', 'ai_choose') and requirements['board'] not in _board_catalog():
                raise _InvalidRequirements('The board answer must be a canonical catalog board key or none. No changes were made.')
            confirmed = True
        if approval is not None:
            if not project_id or not confirmed or not isinstance(approval, dict):
                raise _InvalidRequirements('Approval requires a current project and confirmed requirements.')
            assessment_id = approval.get('assessment_id', approval.get('id'))
            if not isinstance(assessment_id, str) or not assessment_id or not isinstance(approval.get('choice'), str):
                raise _InvalidRequirements('Approval requires an assessment ID and choice.')
            try:
                assessment = _public(_get_feasibility().authorize(_get_service(), project_id, {'assessment_id': assessment_id, 'choice': approval['choice']}))
                if assessment.get('status') == 'approved':
                    approval_id = assessment['id']
                    assessment = _public(_get_feasibility().validate_approval(_get_service(), project_id, approval_id))
                    approved_plan = assessment['plan']
                elif assessment.get('status') == 'revise':
                    confirmed = False
                    requirements = None
                    paused = False
                else:
                    paused = True
            except Exception as error:
                raise _InvalidRequirements(_tool_error(error, runtime_token)) from error
            yield {'type': 'feasibility', **assessment}
        revising = bool(assessment and assessment.get('status') == 'revise')
        emergency_stop = bool(project_id and re.fullmatch(
            r'\s*(?:(?:please|emergency)\s+)?(?:stop|halt)\s+(?:the\s+)?(?:simulation|simulator)(?:\s+(?:now|please))?[.!]?\s*', user_text, re.I
        ))
        if project_id and confirmed and not revising and _firmware_intent(user_text):
            selected_board = _get_service().get_project(project_id).get('board')
            firmware_requested = (selected_board not in (None, 'unselected', 'none')
                                  and requirements.get('board', selected_board) in (selected_board, 'ai_choose'))
        build_requested = bool(project_id and not emergency_stop and (_build_intent(user_text) or firmware_requested or approval_id or revising))
        compile_text = re.sub(r'\b(?:do not|don\'t|never|without)\b[^.;\n]*', '', user_text, flags=re.I) if firmware_requested else user_text
        compile_requested = bool(build_requested and ('compile_firmware' in approved_plan['operations'] if approved_plan and not firmware_requested else re.search(r'\bcompile\b', compile_text, re.I)))
        needs_questions = build_requested and not confirmed
        tool_limit = _bounded(max_tool_calls, MAX_TOOL_CALLS, 100)
        model_limit = _bounded(max_model_calls, MAX_MODEL_CALLS, 80)
        deadline = _bounded(timeout_seconds, MAX_SECONDS, 300)
        messages = _history(history)
        if emergency_stop:
            messages.append(SystemMessage(content='Stop the current simulation with stop_simulation now. This safety stop needs no requirements questions or feasibility review. Report only the actual browser acknowledgement or blocking error.'))
        if revising:
            messages.append(SystemMessage(content='The user chose Change the design. Ask new project-specific MCQs to resolve these actual limitations: ' + json.dumps(assessment.get('issues', [])) + '. Preserve the original goal from conversation history and the selected board. Offer supported alternatives or Let AI choose. Do not repeat the same feasibility review, place parts, or write firmware before revised answers.'))
        if build_requested and confirmed and not firmware_requested and hasattr(_get_service(), 'catalog'):
            from backend.example_requirements import search_example_requirements, get_example_reference
            reference_query = next((message.content for message in history if isinstance(message, HumanMessage) and _build_intent(message.content) and not message.content.startswith('Project requirements confirmed:')), user_text)[:200]
            matches = search_example_requirements(reference_query, 2, board=selected_board if selected_board not in (None,'unselected','none') else None)
            if matches['examples']:
                reference = get_example_reference(matches['examples'][0]['id'], _get_service().catalog)
                messages.append(SystemMessage(content='Actual Velxio starting reference (not evidence of current compilation or simulation): ' + json.dumps(reference, ensure_ascii=False) + '\nAdapt its verified pin mappings, current-limiting resistors, power/ground, and actual firmware to the user answers. Use the existing project tools to create parts/wires/source. Do not copy unsupported peripherals or blindly replace the requested board. Read another reference with get_example_reference when needed.'))
        if needs_questions and hasattr(_get_service(), 'catalog'):
            from backend.hardware import BOARD_CONFIG
            supported = [{'id': kind, 'name': item.get('name', kind), 'simulation': BOARD_CONFIG.get(kind, {}).get('simulation')} for kind, item in _get_service().catalog.components.items() if kind in _board_catalog() or (item.get('category') != 'boards' and item.get('pins'))]
            messages.append(SystemMessage(content='Device choices must come from this actual compatible catalog: ' + json.dumps(supported) + '. For every device option include component_type with the exact catalog ID. Do not offer a display/sensor with missing pins. Simulation-unavailable boards may still be built. If requested hardware is absent, clarify a supported alternative here, not in another confirmation later.'))
        if needs_questions:
            project = _get_service().get_project(project_id)
            selected_board = project.get('board')
            board_unselected = selected_board in (None, 'unselected', 'none')
            messages.append(SystemMessage(content=(
                'The project has no selected board. Ask board first using canonical board option IDs. Available boards: '
                + json.dumps([{'id': key, 'label': item['name']} for key, item in _board_catalog().items()])
                + '. Offer none for an analog circuit. Limit the board choices to six relevant options.'
            ) if board_unselected else 'The project already uses board ' + str(selected_board) + '. Omit the board question.'))
        if confirmed:
            messages.append(SystemMessage(content='The user confirmed these project requirements: ' + json.dumps(requirements, ensure_ascii=False)
                                          + '\nAn ai_choose answer delegates that decision to you: choose a supported option, explain it, and include it in the assessed plan. Do not repeat that question. Execute the latest requested project operation with tools. Do not ask requirements questions again.'))
        if approved_plan:
            messages.append(SystemMessage(content='Server-authorized feasibility plan: ' + json.dumps(approved_plan, ensure_ascii=False)
                                          + '\nExecute only these parts and operations. Read the current revision first; report limitations honestly.'))
        elif confirmed and project_id and not emergency_stop and not firmware_requested:
            messages.append(SystemMessage(content='Feasibility approval is required. Read the current project and assess the complete actual intended plan before any placement, firmware change, compilation or runtime tool.'))
        if needs_questions:
            messages.append(SystemMessage(content='This is an initial project build request without confirmed requirements. '
                                          'Call ask_project_questions with exactly 10 useful MCQs now; non-board questions are optional. No hardware changes may run.'))
        if firmware_requested:
            messages.append(SystemMessage(content='This is a targeted firmware update on an existing confirmed project, not a new build. '
                                          'Read_project and read_firmware first, preserve all components, board pins and wires, then edit_firmware or generate_firmware. '
                                          'Do not restart requirements questions, example-based building, feasibility assessment, placement or wiring. '
                                          'Any supplied approval still restricts operations and revisions. Compile only if requested or needed to verify this edit; '
                                          'compilation validates the circuit and must produce a current artifact. Do not start simulation. '
                                          'Report the exact firmware change, unchanged circuit, and what was compiled or not run; omit new physical assembly guidance.'))
        # Disable provider transport retries without mutating a shared parent model.
        if hasattr(model, 'max_retries') and hasattr(model, 'model_copy'):
            updates = {'max_retries': 0}
            for attribute in ('client', 'async_client'):
                resource = getattr(model, attribute, None)
                transport = getattr(resource, '_client', None)
                if transport is not None and hasattr(transport, 'with_options'):
                    updates[attribute] = transport.with_options(max_retries=0).chat.completions
            model = model.model_copy(update=updates)
        graph = StateGraph(_State)
        graph.add_node('model', model_node)
        graph.add_node('tools', tool_node)
        graph.add_edge(START, 'model')
        graph.add_conditional_edges('model', route, {'tools': 'tools', 'model': 'model', END: END})
        graph.add_conditional_edges('tools', lambda state: END if paused else 'model', {'model': 'model', END: END})
        compiled = graph.compile()
        if not paused:
            async with asyncio.timeout(deadline):
                async with aclosing(compiled.astream(
                    {'messages': messages}, config={'recursion_limit': RECURSION_LIMIT}, stream_mode='custom',
                )) as events:
                    async for item in events:
                        yield item
    except asyncio.CancelledError:
        raise
    except (_LimitReached, TimeoutError, GraphRecursionError) as error:
        status = 'error'
        reason = 'timeout' if isinstance(error, TimeoutError) else 'limit'
        if isinstance(error, GraphRecursionError):
            detail = 'Agent recursion limit reached.'
        else:
            detail = 'Agent time limit reached.' if reason == 'timeout' else str(error)
        for step_id in active:
            yield {'type': 'step_end', 'id': step_id, 'status': 'error', 'output': detail,
                   'result': {'status': 'error', 'error': detail}}
        yield {'type': 'text', 'channel': 'narration', 'text': detail}
    except _InvalidRequirements as error:
        status = 'error'
        reason = 'invalid_requirements'
        yield {'type': 'text', 'channel': 'narration', 'text': str(error)}
    except _IncompleteResponse as error:
        status = 'error'
        reason = 'response_truncated'
        yield {'type': 'text', 'channel': 'narration', 'text': str(error)}
    except _IncompleteBuild as error:
        status = 'error'
        reason = 'build_not_executed'
        yield {'type': 'text', 'channel': 'narration', 'text': str(error)}
    except Exception as error:
        status = 'error'
        reason = 'model_error'
        detail = _provider_error(error)
        for step_id in active:
            yield {'type': 'step_end', 'id': step_id, 'status': 'error', 'output': detail,
                   'result': {'status': 'error', 'error': detail}}
        yield {'type': 'text', 'channel': 'narration', 'text': detail}
    if paused and status == 'success':
        if needs_questions:
            status = 'awaiting_answers'
            reason = 'requirements_required'
        elif assessment:
            decision = assessment.get('status')
            status = 'cancelled' if decision == 'cancel' else 'awaiting_revision' if decision == 'revise' else 'awaiting_approval'
            reason = 'feasibility_' + str(decision)
        else:
            status = 'awaiting_answers'
            reason = 'requirements_required'
    yield {'type': 'done', 'status': status, 'reason': reason, 'changes': changes, 'successfulTools': successful_tools, 'model': actual_model,
           'elapsedMs': round((time.perf_counter() - started) * 1000), 'usage': usage,
           'modelCalls': model_calls, 'toolCalls': tool_calls}
