"""Shared primitives: identifiers, time, redaction, the bounded calculator and
SPICE catalog helpers.

Split out of the former single backend/hardware.py module during phase v01.
"""

import ast
import copy
import math
import operator
import re
from datetime import datetime, timezone

from fastapi import HTTPException


from backend.hardware.boards import (
    PIN_LAYOUTS,
)


IDENTIFIER = re.compile(r'^[A-Za-z0-9_-]{1,80}$')


def fail(status, message):
    raise HTTPException(status, message)


def now():
    return datetime.now(timezone.utc).isoformat()


def identifier(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        fail(400, 'Invalid identifier.')
    return value


def public(project):
    return copy.deepcopy({key: value for key, value in project.items() if not key.startswith('_')})


def numeric(value):
    if type(value) not in (int, float) or not math.isfinite(value) or abs(value) > 1000000:
        fail(400, 'Coordinates must be finite numbers within +/-1000000.')
    return value


def source_text(value):
    if not isinstance(value, str) or not value.strip() or len(value.encode('utf-8')) > 100000:
        fail(400, 'Firmware must contain 1 to 100000 bytes of source.')
    if '\x00' in value:
        fail(400, 'Firmware cannot contain NUL bytes.')
    # Headers may name installed libraries, but never host files outside the sketch.
    for match in re.finditer(r'^\s*#\s*include\s*([<"])([^>"\n]+)[>"]', value, re.MULTILINE):
        header = match.group(2)
        if '..' in header or '\\' in header or header.startswith('/') or ':' in header:
            fail(400, 'Unsafe firmware include path.')
    return value


def calculator(expression):
    if not isinstance(expression, str) or not expression.strip() or len(expression) > 256:
        fail(400, 'Calculator expression must contain 1 to 256 characters.')
    binary = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
              ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv,
              ast.Mod: operator.mod, ast.Pow: operator.pow}
    try:
        tree = ast.parse(expression, mode='eval')
        if sum(1 for _ in ast.walk(tree)) > 64:
            raise ValueError()
        def evaluate(node, depth=0):
            if depth > 16:
                raise ValueError()
            if isinstance(node, ast.Constant) and type(node.value) in (int, float):
                result = node.value
            elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
                result = evaluate(node.operand, depth + 1) * (-1 if isinstance(node.op, ast.USub) else 1)
            elif isinstance(node, ast.BinOp) and type(node.op) in binary:
                left, right = evaluate(node.left, depth + 1), evaluate(node.right, depth + 1)
                if isinstance(node.op, ast.Pow) and abs(right) > 100:
                    raise ValueError()
                result = binary[type(node.op)](left, right)
            else:
                raise ValueError()
            if type(result) not in (int, float) or not math.isfinite(result) or abs(result) > 1e100:
                raise ValueError()
            return result
        return {'expression': expression, 'result': evaluate(tree.body)}
    except (ValueError, SyntaxError, TypeError, ArithmeticError, RecursionError):
        fail(400, 'Only bounded finite numeric arithmetic is supported.')


SPICE_SOURCE_SCHEMAS = {
    'source-dc-voltage': ('DC Voltage Source', [('voltage', 5, -1000000, 1000000, 'V')]),
    'source-dc-current': ('DC Current Source', [('current', 0.001, -1000000, 1000000, 'A')]),
    'source-sine-voltage': ('Sine Voltage Source', [
        ('offset', 0, -1000000, 1000000, 'V'), ('amplitude', 5, 0, 1000000, 'V'),
        ('frequency', 1000, 0.000001, 1000000, 'Hz'), ('delay', 0, 0, 1000000, 's'),
        ('damping', 0, 0, 1000000, '1/s'), ('phase', 0, -360, 360, 'degrees')]),
    'source-pulse-voltage': ('Pulse Voltage Source', [
        ('low', 0, -1000000, 1000000, 'V'), ('high', 5, -1000000, 1000000, 'V'),
        ('delay', 0, 0, 1000000, 's'), ('rise', 0.000001, 0.000000000001, 1000000, 's'),
        ('fall', 0.000001, 0.000000000001, 1000000, 's'), ('width', 0.0005, 0.000000000001, 1000000, 's'),
        ('period', 0.001, 0.000000000001, 1000000, 's')]),
    'source-pwl-voltage': ('Piecewise Linear Voltage Source', []),
    'source-ac-voltage': ('AC Voltage Source', [
        ('voltage', 0, -1000000, 1000000, 'V'), ('magnitude', 1, 0, 1000000, 'V'),
        ('phase', 0, -360, 360, 'degrees')]),
    'ground': ('SPICE Ground', []),
}


SPICE_PASSIVE_DEFAULTS = {'resistor': '1000', 'capacitor': '1u', 'inductor': '1m'}


SPICE_VALUE_PATTERN = r'(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:[TtGgKkMmUuNnPpFf]|[Mm][Ee][Gg])?'


SPICE_VALUE_TOKEN = re.compile(SPICE_VALUE_PATTERN + r'\Z')


def spice_catalog_entries():
    entries = []
    for kind, (name, fields) in SPICE_SOURCE_SCHEMAS.items():
        properties = [{'name': key, 'type': 'number', 'defaultValue': default,
                       'min': minimum, 'max': maximum, 'unit': unit, 'control': 'number'}
                      for key, default, minimum, maximum, unit in fields]
        if kind == 'source-pwl-voltage':
            properties.append({'name': 'points', 'type': 'number-pairs',
                               'defaultValue': [[0, 0], [0.001, 5], [0.002, 0]],
                               'minItems': 2, 'maxItems': 256, 'timeMin': 0, 'timeMax': 1000000,
                               'valueMin': -1000000, 'valueMax': 1000000})
        entries.append({'id': kind, 'name': name, 'category': 'analog', 'tagName': '',
                        'tags': ['spice', 'schematic', 'source' if kind != 'ground' else 'ground'],
                        'properties': properties, 'defaultValues': {field['name']: copy.deepcopy(field['defaultValue']) for field in properties},
                        'pinCount': len(PIN_LAYOUTS[kind]), 'schematic_only': True,
                        'spice_model': kind, 'schema_version': 1})
    return entries


def validate_spice_properties(entry, supplied, existing=None):
    descriptors = {field['name']: field for field in entry['properties']}
    values = copy.deepcopy(entry.get('defaultValues', {}))
    values.update(existing or {})
    values.update(supplied)
    for key, value in supplied.items():
        descriptor = descriptors.get(key)
        if descriptor is None:
            fail(400, f'Unknown property {key} for {entry["id"]}.')
        if descriptor['type'] == 'number':
            if type(value) not in (int, float) or (type(value) is float and not math.isfinite(value)):
                fail(400, f'Property {key} must be a finite JSON number.')
            if not descriptor['min'] <= value <= descriptor['max']:
                fail(400, f'Property {key} is outside its allowed range.')
        elif descriptor['type'] == 'number-pairs':
            if not isinstance(value, list) or not 2 <= len(value) <= 256:
                fail(400, 'PWL points must contain 2 to 256 numeric [time, voltage] pairs.')
            previous = -1
            for point in value:
                if not isinstance(point, list) or len(point) != 2 or any(type(number) not in (int, float) or (type(number) is float and not math.isfinite(number)) for number in point):
                    fail(400, 'PWL points must contain finite numeric [time, voltage] pairs.')
                timestamp, voltage = point
                if not 0 <= timestamp <= 1000000 or not -1000000 <= voltage <= 1000000 or timestamp <= previous:
                    fail(400, 'PWL times must increase strictly within bounds; voltages must be within bounds.')
                previous = timestamp
        elif descriptor.get('format') == 'spice-value':
            if not isinstance(value, str) or len(value) > 48 or not SPICE_VALUE_TOKEN.fullmatch(value):
                fail(400, 'Passive value must be a strict positive SPICE engineering-number string.')
            suffix_match = re.search(r'(?i)(meg|[tgkmunpf])\Z', value)
            suffix = suffix_match.group().lower() if suffix_match else ''
            number = float(value[:suffix_match.start()] if suffix_match else value)
            scale = {'t': 1e12, 'g': 1e9, 'meg': 1e6, 'k': 1e3, 'm': 1e-3,
                     'u': 1e-6, 'n': 1e-9, 'p': 1e-12, 'f': 1e-15}.get(suffix, 1)
            magnitude = number * scale
            if not math.isfinite(magnitude) or not descriptor['min'] <= magnitude <= descriptor['max']:
                fail(400, 'Passive value is outside its allowed positive range.')
    if entry['id'] == 'source-pulse-voltage' and values['rise'] + values['width'] + values['fall'] > values['period']:
        fail(400, 'Pulse rise + width + fall must not exceed period.')
    return copy.deepcopy(supplied)
