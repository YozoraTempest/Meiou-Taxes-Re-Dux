import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../../', import.meta.url)));
const mod = join(root, 'redux-subject');
const read = path => readFileSync(join(mod, path), 'utf8');
function parse(text) {
    const tokens = text.match(/#[^\r\n]*|"(?:\\.|[^"\\])*"|[{}=]|[^\s{}=]+/g).filter(t => !t.startsWith('#'));
    let i = 0;
    function block(nested = false) {
        const pairs = [];
        while (i < tokens.length && tokens[i] !== '}') {
            const key = tokens[i++];
            assert.equal(tokens[i++], '=', `Expected assignment after ${key}`);
            const value = tokens[i++] === '{' ? block(true) : tokens[i - 1].replace(/^"|"$/g, '');
            pairs.push([key, value]);
        }
        if (nested) assert.equal(tokens[i++], '}');
        return pairs;
    }
    const result = block();
    assert.equal(i, tokens.length);
    return result;
}
const effects = new Map(parse(read('common/scripted_effects/ReduxProvinceSelection.txt')));
const triggers = new Map(parse(read('common/scripted_triggers/ReduxProvinceSelection.txt')));
const mt = JSON.parse(readFileSync(join(root, 'verification/redux-subject/mt-subject-types.json'), 'utf8'));
const mtPins = JSON.parse(readFileSync(join(root, 'verification/redux-subject/mt-pin-dispatch.json'), 'utf8'));
const pinIds = [];
function pinLeaves(tree) {
    if (Array.isArray(tree)) { pinLeaves(tree[1]); pinLeaves(tree[2]); }
    else pinIds.push(tree);
}
pinLeaves(mtPins.tree);
pinIds.sort((a, b) => a - b);
assert.equal(new Set(pinIds).size, mtPins.leaf_count);
assert.equal(mtPins.leaf_count, 4027);
function pinObject(id, tree = mtPins.tree) {
    // The fixture preserves MT's actual ID_Prov threshold tree.
    return Array.isArray(tree) ? pinObject(id, tree[id >= tree[0] ? 1 : 2]) : `pin_${tree}`;
}
for (const id of pinIds) assert.equal(pinObject(id), `pin_${id}`);
const mtTriggers = new Map(parse(mt.trigger));
assert.equal(mt.types.length, 28);
assert.deepEqual(mt.types.filter(type => !type.selectable).map(type => type.id),
    ['tributary_state', 'close_tributary_state']);
const buttons = parse(read('common/custom_gui/ReduxProvinceSelection.txt')).map(([key, value]) => {
    assert.equal(key, 'custom_button');
    return new Map(value);
});
assert.deepEqual(buttons.map(b => b.get('name')), ['redux_subject_select']);
for (const content of [read('common/scripted_effects/ReduxProvinceSelection.txt'),
    read('common/scripted_triggers/ReduxProvinceSelection.txt'), read('common/custom_gui/ReduxProvinceSelection.txt')]) {
    assert.doesNotMatch(content, /event_target:|save_event_target_as|Pow_UI|add_base_/);
}

// This fixture interprets the actual script entry points, not the EU4 engine.
function world(scope, enabled, selected) {
    const country = (id, overlord, subjectType = 'vassal') => ({ type: 'country', id, overlord, subjectType,
        ai: id !== 'A', scope: id === 'A' ? scope : 0,
        flags: new Set(id === 'A' && enabled ? ['Redux_IncludeSubjects'] : []) });
    const countries = [country('A'), country('B', 'A'), country('C', 'A'), country('T', 'A', 'tributary_state'),
        country('D', 'B'), country('X'), country('H', 'X')];
    const province = (id, owner, area, region, node, state = true, valid = true) => ({ type: 'province', id,
        owner: countries.find(c => c.id === owner), area, region, node, state, core: state, valid,
        flags: new Set(selected ? ['UI_Select'] : []), neighbors: [] });
    const provinces = [province('seed', 'A', 'north', 'r1', 'n1'), province('own', 'A', 'north', 'r1', 'n1'),
        province('b1', 'B', 'north', 'r1', 'n1'), province('b2', 'B', 'north', 'r1', 'n1', false),
        province('b3', 'B', 'south', 'r1', 'n1'), province('c1', 'C', 'south', 'r2', 'n2'),
        province('invalid', 'B', 'north', 'r1', 'n1', true, false), province('tribute', 'T', 'north', 'r1', 'n1'),
        province('indirect', 'D', 'north', 'r1', 'n1'), province('foreign', 'X', 'north', 'r1', 'n1'),
        province('other-subject', 'H', 'north', 'r1', 'n1'), province('ownfar', 'A', 'far', 'r3', 'n3', false)];
    provinces[0].neighbors = ['own', 'b1', 'invalid', 'tribute', 'indirect', 'foreign'];
    provinces[2].neighbors = ['seed', 'own', 'b3', 'c1', 'invalid', 'tribute', 'indirect', 'foreign', 'other-subject'];
    for (let i = 0; i < provinces.length; i++) {
        provinces[i].pinId = pinIds[Math.floor(i * (pinIds.length - 1) / (provinces.length - 1))];
    }
    return { countries, provinces, actor: countries[0], globals: new Set(), events: [], pinCalls: [],
        pins: new Set(selected ? provinces.map(p => pinObject(p.pinId)) : []) };
}
function substitute(tree, params) {
    const replace = value => value.replace(/\$(\w+)\$/g, (_, name) => {
        assert.ok(name in params, `Missing parameter ${name}`);
        return params[name];
    });
    return tree.map(([key, value]) => [replace(key), Array.isArray(value) ? substitute(value, params) : replace(value)]);
}
function target(key, current, w) {
    if (key === 'owner') return current.owner;
    if (key === 'FROM') return w.actor;
}
function test(tree, current, w) {
    return tree.every(([key, value]) => {
        const scoped = target(key, current, w);
        if (scoped) return test(value, scoped, w);
        if (triggers.has(key)) return test(triggers.get(key), current, w);
        if (mtTriggers.has(key)) return test(mtTriggers.get(key), current, w);
        if (key === 'AND') return test(value, current, w);
        if (key === 'OR') return value.some(pair => test([pair], current, w));
        if (key === 'NOT') return !test(value, current, w);
        if (key === 'always') return value === 'yes';
        if (key === 'ai') return current.ai === (value === 'yes');
        if (key === 'has_country_flag' || key === 'has_province_flag') return current.flags.has(value);
        if (key === 'owned_by') return current.owner === target(value, current, w);
        if (key === 'is_subject') return Boolean(current.overlord) === (value === 'yes');
        if (key === 'is_subject_of_type') return current.subjectType === value;
        if (key === 'is_subject_of') return current.overlord === target(value, current, w).id;
        if (key === 'isValidProv') return current.valid;
        if (key === 'is_state') return current.state;
        if (key === 'is_state_core') return current.core;
        if (key === 'is_key_equal') {
            const args = Object.fromEntries(value);
            assert.equal(args.lhs, 'UI_SelectScope');
            return current.scope === Number(args.value);
        }
        throw new Error(`Unsupported trigger: ${key}`);
    });
}
function execute(tree, current, w) {
    let taken = false;
    for (const [key, value] of tree) {
        if (['if', 'else_if', 'else'].includes(key)) {
            if (key === 'if') taken = false;
            const limit = value.find(([name]) => name === 'limit')?.[1];
            if (!taken && (!limit || test(limit, current, w))) {
                execute(value.filter(([name]) => name !== 'limit'), current, w);
                taken = true;
            }
            continue;
        }
        taken = false;
        if (key === 'custom_tooltip') continue;
        if (key === 'hidden_effect') { execute(value, current, w); continue; }
        if (key === 'province_event') { w.events.push({ province: current.id, id: Object.fromEntries(value).id }); continue; }
        if (key === 'POP_ChangePin') {
            const args = Object.fromEntries(value);
            assert.equal(current.type, 'province');
            assert.equal(args.inp, mtPins.input);
            assert.ok(['show', 'hide'].includes(args.action));
            const object = pinObject(current.pinId);
            if (args.action === 'show') w.pins.add(object);
            else w.pins.delete(object);
            w.pinCalls.push({ province: current.id, action: args.action, object });
            continue;
        }
        if (key === 'set_global_flag') { w.globals.add(value); continue; }
        if (key.startsWith('set_') && key.endsWith('_flag')) { current.flags.add(value); continue; }
        if (key.startsWith('clr_') && key.endsWith('_flag')) { current.flags.delete(value); continue; }
        if (effects.has(key)) {
            execute(substitute(effects.get(key), value === 'yes' ? {} : Object.fromEntries(value)), current, w);
            continue;
        }
        const scoped = target(key, current, w);
        if (scoped) { execute(value, scoped, w); continue; }
        let candidates;
        if (key === 'every_neighbor_province') candidates = w.provinces.filter(p => current.neighbors.includes(p.id));
        else if (key === 'area' || key === 'region') candidates = w.provinces.filter(p => p[key] === current[key]);
        else if (key === 'every_trade_node_member_province') candidates = w.provinces.filter(p => p.node === current.node);
        else if (key === 'every_subject_country') candidates = w.countries.filter(c => c.overlord === current.id);
        else if (key === 'every_owned_province') candidates = w.provinces.filter(p => p.owner === current);
        else throw new Error(`Unsupported effect: ${key}`);
        const limit = value.find(([name]) => name === 'limit')?.[1];
        for (const candidate of candidates) if (!limit || test(limit, candidate, w)) {
            execute(value.filter(([name]) => name !== 'limit'), candidate, w);
        }
    }
}
function click(button, province, w) {
    if (test(button.get('potential'), province, w) && test(button.get('trigger'), province, w)) {
        execute(button.get('effect'), province, w);
    }
}
function pinsMatchSelection(w, changed, selected) {
    assert.deepEqual(w.events, [], 'Custom selection must update ambient pins without dispatching a province event');
    assert.deepEqual(w.pinCalls.map(call => call.province).sort(), [...changed].sort());
    assert.ok(w.pinCalls.every(call => call.action === (selected ? 'hide' : 'show')));
    for (const province of w.provinces) {
        assert.equal(w.pins.has(pinObject(province.pinId)), province.flags.has('UI_Select'),
            `Ambient pin differs from selection: ${province.id}`);
        if (changed.includes(province.id)) {
            assert.ok(!province.flags.has('Pin_Show') && !province.flags.has('Pin_Hide'));
        }
    }
}
const own = [['seed'], ['seed', 'own'], ['seed', 'own'], ['seed', 'own'],
    ['seed', 'own'], ['seed', 'own', 'ownfar'], ['seed', 'own']];
const subjects = [[], ['b1'], ['b1', 'b2'], ['b1', 'b2', 'b3'],
    ['b1', 'b3', 'c1'], ['b1', 'b2', 'b3', 'c1'], ['b1', 'b2', 'b3']];
const fromSubject = [['b1'], ['b1', 'seed', 'own', 'b3', 'c1'], ['b1', 'seed', 'own', 'b2'],
    ['b1', 'seed', 'own', 'b2', 'b3'], ['b1', 'seed', 'own', 'b3', 'c1'],
    ['b1', 'seed', 'own', 'ownfar', 'b2', 'b3', 'c1'], ['b1', 'seed', 'own', 'b2', 'b3']];
let cases = 0;
for (const button of buttons) for (const subjectSeed of [false, true]) for (let scope = 0; scope <= 6; scope++) {
    for (const enabled of [false, true]) for (const selected of [false, true]) {
        const w = world(scope, enabled, selected);
        w.countries[1].scope = (scope + 3) % 7;
        const seed = w.provinces[subjectSeed ? 2 : 0];
        const allowed = !subjectSeed || enabled;
        assert.ok(test(button.get('potential'), seed, w));
        assert.equal(test(button.get('trigger'), seed, w), allowed);
        const before = w.provinces.map(p => p.flags.has('UI_Select'));
        click(button, seed, w);
        const changed = w.provinces.filter((p, i) => before[i] !== p.flags.has('UI_Select')).map(p => p.id);
        let ids;
        if (subjectSeed) ids = allowed ? fromSubject[scope === 4 && selected ? 5 : scope] : [];
        else ids = [...own[scope === 4 && selected ? 5 : scope], ...(enabled ? subjects[scope === 4 && selected ? 5 : scope] : [])];
        assert.deepEqual(changed.sort(), [...ids].sort(), `${button.get('name')}: seed=${seed.id}, scope=${scope}, enabled=${enabled}, selected=${selected}`);
        pinsMatchSelection(w, changed, selected);
        assert.equal(w.globals.has('UI_Select'), allowed && !selected);
        assert.equal(w.actor.scope, scope);
        cases++;
    }
}
for (const button of buttons) {
    for (const id of ['invalid', 'tribute', 'indirect', 'foreign', 'other-subject']) {
        const w = world(5, true, false);
        const p = w.provinces.find(p => p.id === id);
        assert.ok(!test(button.get('potential'), p, w));
        click(button, p, w);
        assert.deepEqual(w.events, []);
        assert.ok(w.provinces.every(p => !p.flags.has('UI_Select')));
        cases++;
    }
    for (const seedIndex of [0, 2]) {
        const w = world(5, true, false);
        w.actor.flags.add('UI_Freeze');
        execute(button.get('effect'), w.provinces[seedIndex], w);
        assert.ok(w.provinces.every(p => !p.flags.has('UI_Select')));
        assert.deepEqual(w.events, []);
        cases++;
    }
    const pending = world(0, true, false);
    pending.provinces[2].flags.add('Pin_Show');
    click(button, pending.provinces[2], pending);
    assert.ok(!pending.provinces[2].flags.has('Pin_Hide'));
    assert.ok(!pending.provinces[2].flags.has('Pin_Show'));
    pinsMatchSelection(pending, ['b1'], true);
    const isolated = world(5, true, false);
    isolated.actor = isolated.countries[1];
    isolated.actor.ai = false;
    isolated.actor.scope = 2;
    isolated.actor.flags.add('Redux_IncludeSubjects');
    click(button, isolated.provinces.find(p => p.id === 'indirect'), isolated);
    assert.deepEqual(isolated.provinces.filter(p => p.flags.has('UI_Select')).map(p => p.id), ['b1', 'b2', 'indirect']);
    cases += 2;
}
for (const type of [...mt.types, { id: 'additional_subject_type', selectable: true }]) {
    for (const subjectSeed of [false, true]) for (let scope = 0; scope <= 6; scope++) {
        for (const enabled of [false, true]) for (const selected of [false, true]) {
            const w = world(scope, enabled, selected);
            w.countries[1].subjectType = type.id;
            w.countries[1].scope = (scope + 3) % 7;
            const seed = w.provinces[subjectSeed ? 2 : 0];
            const allowed = !subjectSeed || enabled && type.selectable;
            assert.equal(test(buttons[0].get('potential'), seed, w), !subjectSeed || type.selectable);
            assert.equal(test(buttons[0].get('trigger'), seed, w), allowed);
            const before = w.provinces.map(p => p.flags.has('UI_Select'));
            click(buttons[0], seed, w);
            const index = scope === 4 && selected ? 5 : scope;
            const expected = subjectSeed ? allowed ? fromSubject[index] : [] :
                [...own[index], ...(enabled ? subjects[index].filter(id => type.selectable || !id.startsWith('b')) : [])];
            const changed = w.provinces.filter((p, i) => before[i] !== p.flags.has('UI_Select')).map(p => p.id);
            assert.deepEqual(changed.sort(), [...expected].sort(),
                `${type.id}: seed=${seed.id}, scope=${scope}, enabled=${enabled}, selected=${selected}`);
            pinsMatchSelection(w, changed, selected);
            cases++;
        }
    }
}
const decision = new Map(new Map(parse(read('decisions/ReduxSubjectSelection.txt'))[0][1]).get('redux_toggle_subject_selection'));
const w = world(5, false, true);
const before = w.provinces.map(p => [...p.flags]);
assert.ok(test(decision.get('allow'), w.actor, w));
execute(decision.get('effect'), w.actor, w);
assert.ok(w.actor.flags.has('Redux_IncludeSubjects'));
execute(decision.get('effect'), w.actor, w);
assert.ok(!w.actor.flags.has('Redux_IncludeSubjects'));
assert.deepEqual(w.provinces.map(p => [...p.flags]), before);
assert.equal(w.actor.scope, 5);
w.actor.flags.add('UI_Freeze');
assert.ok(!test(decision.get('allow'), w.actor, w));
const text = parse(read('customizable_localization/ReduxSubjectSelection.txt'))[0][1];
const title = state => text.filter(([key]) => key === 'text').map(([, value]) => new Map(value))
    .find(t => test(t.get('trigger'), state.actor, state)).get('localisation_key');
assert.equal(title(world(0, false, false)), 'redux_subject_selection_title_off');
assert.equal(title(world(0, true, false)), 'redux_subject_selection_title_on');
cases += 3;

const locale = readFileSync(join(mod, 'localisation/redux-subject_l_english.yml'));
assert.deepEqual([...locale.subarray(0, 3)], [239, 187, 191]);
for (const key of ['redux_subject_select_tooltip', 'redux_toggle_subject_selection_title', 'redux_toggle_subject_selection_desc',
    'redux_subject_selection_title_on', 'redux_subject_selection_title_off', 'redux_subject_selection_enabled',
    'redux_subject_selection_disabled']) assert.ok(locale.toString('utf8').includes(`${key}:0`));

const gui = readFileSync(join(mod, 'interface/provinceview.gui')).toString('latin1');
assert.doesNotMatch(gui, /name = "(?:redux_subject_select_dip|redux_subject_select_mil|redux_ui_select_dip|redux_ui_select_mil)"/);
function guiButton(name) {
    const pattern = new RegExp(`      guiButtonType = \\{\\n        name = "${name}"[\\s\\S]*?\\n      \\}\\n`, 'g');
    const matches = [...gui.matchAll(pattern)];
    assert.equal(matches.length, 1);
    return matches[0][0];
}
for (const [name, y] of [['prod_base_increase_button', 157], ['mp_base_increase_button', 184]]) {
    const original = guiButton(name);
    assert.ok(original.includes(`          y = ${y}`));
    assert.ok(original.includes('shortcut = "d"'));
    assert.ok(!original.includes('scripted = yes'));
}
const added = guiButton('redux_subject_select');
assert.ok(added.includes('scripted = yes'));
assert.ok(!added.includes('shortcut ='));
let provinceWindow;
function findProvinceWindow(tree) {
    for (const [key, value] of tree) if (Array.isArray(value)) {
        if (key === 'windowType' && new Map(value).get('name') === 'province_window') provinceWindow = value;
        findProvinceWindow(value);
    }
}
findProvinceWindow(parse(gui));
const direct = name => new Map(provinceWindow.find(([, value]) => Array.isArray(value) &&
    new Map(value).get('name') === name)[1]);
const position = Object.fromEntries(direct('redux_subject_select').get('position'));
assert.deepEqual(position, { x: '490', y: '65' });
assert.equal(direct('redux_subject_select').get('quadTextureSprite'), mt.selection_sprite.name);
assert.ok(Number(position.y) + mt.selection_sprite.height + 5 <=
    Number(new Map(direct('select_estate_title').get('position')).get('y')));
assert.ok(Number(position.x) + mt.selection_sprite.width <=
    Number(new Map(new Map(provinceWindow).get('size')).get('x')));
let restored = gui.replace(added, '');
const width = '      name = "province_window"\n      backGround = ""\n      position = {\n        x = 0\n        y = -374\n      }\n      size = {\n        x = 550\n';
assert.equal(restored.split(width).length, 2);
restored = restored.replace(width, width.replace('x = 550', 'x = 475'));
assert.equal(createHash('sha256').update(Buffer.from(restored, 'latin1')).digest('hex').toUpperCase(),
    '4EEA36E04375D2CAC1F7CB44E9E7367F99B1D439117098CC5661320258634788');
console.log(`PASS: REDUX SUBJECT ${cases} selection fixtures; 28 MT subject types; direct ambient pins match selection; ${pinIds.length} MT pin IDs; native/Pop Display bytes preserved`);
