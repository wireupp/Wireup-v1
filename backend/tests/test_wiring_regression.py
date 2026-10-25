from backend.hardware import HardwareService, RuntimeBridge


def test_default_parts_do_not_overlap_and_board_aliases_are_canonical(tmp_path):
    service = HardwareService(tmp_path / 'projects', runtime=RuntimeBridge(timeout=0.2))
    project = service.create_project('Wiring regression', 'arduino-nano')
    # Invoke the same mutation implementation used by API and agent tools.
    project = service._mutate(project['id'], 'add_component', {'type': 'led', 'id': 'led'})
    project = service._mutate(project['id'], 'add_component', {'type': 'resistor', 'id': 'resistor'})
    placements = {(part['x'], part['y']) for part in project['components']}
    assert len(placements) == 3
    assert service._endpoint(project, {'component': 'board', 'pin': 'D7'})['pin'] == '7'
    assert service._endpoint(project, {'component': 'board', 'pin': 'GND'})['pin'] == 'GND.1'


def test_automatic_placement_groups_components_and_preserves_manual_positions(tmp_path):
    service = HardwareService(tmp_path / 'projects', runtime=RuntimeBridge(timeout=0.2))
    project = service.create_project('Readable layout', 'esp32-c3')
    for kind, component_id in [('servo', 'motor-1'), ('analog-joystick', 'stick-1'),
                               ('servo', 'motor-2'), ('resistor', 'resistor-1'),
                               ('analog-joystick', 'stick-2'), ('servo', 'motor-3')]:
        project = service._mutate(project['id'], 'add_component', {'type': kind, 'id': component_id})
    parts = {part['id']: part for part in project['components']}
    assert [parts[f'motor-{index}']['x'] for index in range(1, 4)] == [990] * 3
    assert [parts[f'motor-{index}']['y'] for index in range(1, 4)] == [90, 310, 530]
    assert parts['stick-1']['x'] == parts['stick-2']['x'] == 430
    assert parts['stick-1']['y'] < parts['stick-2']['y']
    assert parts['resistor-1']['x'] == 710
    project = service._mutate(project['id'], 'add_component',
                              {'type': 'led', 'id': 'manual', 'x': 450, 'y': 175})
    manual = next(part for part in project['components'] if part['id'] == 'manual')
    assert (manual['x'], manual['y']) == (450, 175)
