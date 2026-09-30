import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const mode = process.argv[2] ?? 'Modified';
const root = resolve(process.argv[3] ?? '.');
const mod = join(root, 'redux-tweak');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
assert.equal(hash(join(mod, 'interface/provinceview.gui')), '697DF7DFD78B3B2266060730DCD0D3DDCCC17FCF22F45B89482E6CCDF81D2058');
assert.equal(hash(join(mod, 'common/custom_gui/ReduxSubjectSelection.txt')), '18598E2EF0C351D4C8A0A720B4A7263F7E24E901DFF3946DEC2F1451D3361B00');
const decisionPath = join(mod, 'decisions/ReduxSubjectSelection.txt');
if (mode === 'Baseline' || mode === 'Rollback') {
    assert.equal(existsSync(decisionPath), false);
    assert.equal(readFileSync(join(mod, 'descriptor.mod'), 'utf8').includes('version="0.1.0"'), true);
    console.log(`PASS: ${mode.toUpperCase()} toggle absent; province buttons unchanged; version=0.1.0`);
    process.exit(0);
}

// This fixture executes the new selection effects, not the EU4 engine.
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
const effects = new Map(parse(readFileSync(join(mod, 'common/scripted_effects/ReduxSubjectSelection.txt'), 'utf8')));
const triggers = new Map(parse(readFileSync(join(mod, 'common/scripted_triggers/ReduxSubjectSelection.txt'), 'utf8')));
const decisions = new Map(parse(readFileSync(decisionPath, 'utf8'))[0][1]);
assert.equal(decisions.size, 1);
const decision = new Map(decisions.get('redux_toggle_subject_selection'));
const textDefinitions = parse(readFileSync(join(mod, 'customizable_localization/ReduxSubjectSelection.txt'), 'utf8'));
assert.equal(textDefinitions.length, 1);
const locale = readFileSync(join(mod, 'localisation/redux-tweak_l_english.yml'));
assert.deepEqual([...locale.subarray(0, 3)], [239, 187, 191]);
const localeText = locale.toString('utf8');
for (const key of ['redux_toggle_subject_selection_title', 'redux_toggle_subject_selection_desc',
    'redux_subject_selection_title_on', 'redux_subject_selection_title_off',
    'redux_subject_selection_enabled', 'redux_subject_selection_disabled']) assert.ok(localeText.includes(`${key}:0`));

function world(scope, enabled, selected) {
    const country = (id, overlord, tributary = false) => ({ type: 'country', id, overlord, tributary,
        ai: id !== 'A', flags: new Set(id === 'A' && enabled ? ['Redux_IncludeSubjects'] : []), scope: id === 'A' ? scope : 0 });
    const countries = [country('A'), country('B', 'A'), country('C', 'A'), country('T', 'A', true),
        country('D', 'B'), country('X'), country('H', 'X')];
    const p = (id, owner, area, region, node, state = true, valid = true) => ({ type: 'province', id,
        owner: countries.find(c => c.id === owner), area, region, node, state, core: state, valid,
        flags: new Set(selected ? ['UI_Select'] : []), neighbors: [] });
    const provinces = [p('seed', 'A', 'north', 'r1', 'n1'), p('own', 'A', 'north', 'r1', 'n1'),
        p('b1', 'B', 'north', 'r1', 'n1'), p('b2', 'B', 'north', 'r1', 'n1', false),
        p('b3', 'B', 'south', 'r1', 'n1'), p('c1', 'C', 'south', 'r2', 'n2'),
        p('invalid', 'B', 'north', 'r1', 'n1', true, false), p('tribute', 'T', 'north', 'r1', 'n1'),
        p('indirect', 'D', 'north', 'r1', 'n1'), p('foreign', 'X', 'north', 'r1', 'n1'),
        p('other-subject', 'H', 'north', 'r1', 'n1')];
    provinces[0].neighbors = ['b1', 'invalid', 'tribute', 'indirect', 'foreign'];
    return { countries, provinces, seed: provinces[0], actor: countries[0], targets: new Map(), globals: new Set() };
}
function substitute(tree, params) {
    return tree.map(([key, value]) => {
        const replace = s => s.replace(/\$(\w+)\$/g, (_, name) => {
            assert.ok(name in params, `Missing effect parameter ${name}`);
            return params[name];
        });
        return [replace(key), Array.isArray(value) ? substitute(value, params) : replace(value)];
    });
}
function scopeTarget(key, current, w) {
    if (key === 'owner') return current.owner;
    if (key.startsWith('event_target:')) return w.targets.get(key.slice(13));
    return undefined;
}
function test(tree, current, w) {
    return tree.every(([key, value]) => {
        const target = scopeTarget(key, current, w);
        if (target) return test(value, target, w);
        if (triggers.has(key)) return test(triggers.get(key), current, w);
        if (key === 'AND') return test(value, current, w);
        if (key === 'OR') return value.some(pair => test([pair], current, w));
        if (key === 'NOT') return !test(value, current, w);
        if (key === 'ai') return current.ai === (value === 'yes');
        if (key === 'has_country_flag' || key === 'has_province_flag') return current.flags.has(value);
        if (key === 'is_subject_other_than_tributary_trigger') return Boolean(current.overlord) && !current.tributary;
        if (key === 'is_subject_of') return current.overlord === scopeTarget(value, current, w).id;
        if (key === 'isValidProv') return current.valid;
        if (key === 'is_state') return current.state;
        if (key === 'is_state_core') return current.core;
        if (key === 'is_key_equal') {
            const args = Object.fromEntries(value);
            assert.equal(args.lhs, 'UI_SelectScope');
            return current.scope === Number(args.value);
        }
        throw new Error(`Unsupported fixture trigger: ${key}`);
    });
}
function execute(tree, current, w) {
    let taken = false;
    for (const [key, value] of tree) {
        if (['if', 'else_if', 'else'].includes(key)) {
            if (key === 'if') taken = false;
            const condition = value.find(([name]) => name === 'limit')?.[1];
            if (!taken && (!condition || test(condition, current, w))) {
                execute(value.filter(([name]) => name !== 'limit'), current, w);
                taken = true;
            }
            continue;
        }
        taken = false;
        if (key === 'custom_tooltip') continue;
        if (key === 'set_global_flag') { w.globals.add(value); continue; }
        if (key.startsWith('set_') && key.endsWith('_flag')) { current.flags.add(value); continue; }
        if (key.startsWith('clr_') && key.endsWith('_flag')) { current.flags.delete(value); continue; }
        if (key === 'save_event_target_as') { w.targets.set(value, current); continue; }
        if (effects.has(key)) {
            execute(substitute(effects.get(key), value === 'yes' ? {} : Object.fromEntries(value)), current, w);
            continue;
        }
        const target = scopeTarget(key, current, w);
        if (target) { execute(value, target, w); continue; }
        let candidates;
        if (key === 'every_neighbor_province') candidates = w.provinces.filter(p => current.neighbors.includes(p.id));
        else if (key === 'area' || key === 'region') candidates = w.provinces.filter(p => p[key] === current[key]);
        else if (key === 'every_trade_node_member_province') candidates = w.provinces.filter(p => p.node === current.node);
        else if (key === 'every_subject_country') candidates = w.countries.filter(c => c.overlord);
        else if (key === 'every_owned_province') candidates = w.provinces.filter(p => p.owner === current);
        else throw new Error(`Unsupported fixture effect: ${key}`);
        const limit = value.find(([name]) => name === 'limit')?.[1];
        for (const candidate of candidates) {
            if (!limit || test(limit, candidate, w)) execute(value.filter(([name]) => name !== 'limit'), candidate, w);
        }
    }
}

const expected = [[], ['b1'], ['b1', 'b2'], ['b1', 'b2', 'b3'], ['b1', 'b3', 'c1'],
    ['b1', 'b2', 'b3', 'c1'], ['b1', 'b2', 'b3']];
let cases = 0;
for (let scope = 0; scope <= 6; scope++) for (const enabled of [false, true]) for (const selected of [false, true]) {
    const w = world(scope, enabled, selected);
    const before = w.provinces.map(p => p.flags.has('UI_Select'));
    execute(effects.get('Redux_ExpandSubjectToggle'), w.seed, w);
    const changed = w.provinces.filter((p, i) => before[i] !== p.flags.has('UI_Select')).map(p => p.id);
    assert.deepEqual(changed.sort(), enabled ? [...expected[scope]].sort() : [], `scope=${scope}, enabled=${enabled}, selected=${selected}`);
    assert.equal(w.seed.flags.has('UI_Select'), selected);
    cases++;
}
const w = world(5, false, false);
const title = () => textDefinitions[0][1].filter(([key]) => key === 'text')
    .map(([, value]) => new Map(value)).find(text => test(text.get('trigger'), w.actor, w)).get('localisation_key');
assert.equal(title(), 'redux_subject_selection_title_off');
assert.ok(test(decision.get('potential'), w.actor, w));
execute(decision.get('effect'), w.actor, w);
assert.ok(w.actor.flags.has('Redux_IncludeSubjects'));
assert.equal(title(), 'redux_subject_selection_title_on');
assert.equal(w.actor.scope, 5);
assert.ok(w.provinces.every(p => !p.flags.has('UI_Select')));
w.provinces[2].flags.add('UI_Select');
execute(decision.get('effect'), w.actor, w);
assert.ok(!w.actor.flags.has('Redux_IncludeSubjects'));
assert.ok(w.provinces[2].flags.has('UI_Select'));
assert.equal(title(), 'redux_subject_selection_title_off');
w.actor.flags.add('UI_Freeze');
assert.ok(!test(decision.get('allow'), w.actor, w));
const frozen = world(5, true, false);
frozen.actor.flags.add('UI_Freeze');
execute(effects.get('Redux_ExpandSubjectToggle'), frozen.seed, frozen);
assert.ok(frozen.provinces.every(p => !p.flags.has('UI_Select')));
const subjectSeed = world(5, true, false);
execute(effects.get('Redux_ExpandSubjectToggle'), subjectSeed.provinces[2], subjectSeed);
assert.ok(subjectSeed.provinces.every(p => !p.flags.has('UI_Select')));
cases += 5;
const nonCore = world(4, true, false);
nonCore.provinces[4].core = false;
execute(effects.get('Redux_ExpandSubjectToggle'), nonCore.seed, nonCore);
assert.deepEqual(nonCore.provinces.filter(p => p.flags.has('UI_Select')).map(p => p.id), ['b1', 'c1']);
const pendingPin = world(5, true, true);
pendingPin.seed.flags.delete('UI_Select');
pendingPin.seed.flags.add('Pin_Show');
execute(effects.get('Redux_ExpandSubjectToggle'), pendingPin.seed, pendingPin);
assert.ok(pendingPin.provinces.filter(p => ['b1', 'b2', 'b3', 'c1'].includes(p.id)).every(p => !p.flags.has('UI_Select')));
const anotherPlayer = world(5, true, false);
anotherPlayer.countries[1].ai = false;
anotherPlayer.countries[1].scope = 5;
anotherPlayer.countries[1].flags.add('Redux_IncludeSubjects');
execute(effects.get('Redux_ExpandSubjectToggle'), anotherPlayer.provinces[2], anotherPlayer);
assert.deepEqual(anotherPlayer.provinces.filter(p => p.flags.has('UI_Select')).map(p => p.id), ['indirect']);
cases += 3;

for (const [relative, hook, upstreamHash] of [
    ['common/on_actions/00_on_actions.txt', /^\t\tRedux_ExpandSubjectToggle = yes\r?\n/gm,
        'CF512DD7F6FF8C52583374D811ACA1764DF62DF56C6A11611E027D69520A026A'],
    ['common/scripted_effects/SYS-Prov.txt', /^\tRedux_ExpandSubjectSelection = \{ action = (select|deselect) \}\r?\n/gm,
        '85B7EE4A862041F99B524C04FC13D87FFB50B4CCA8F6BA71E873CF7BF254C8CC']
]) {
    const content = readFileSync(join(mod, relative), 'latin1');
    assert.equal([...content.matchAll(hook)].length, 2);
    const original = Buffer.from(content.replace(hook, ''), 'latin1');
    assert.equal(createHash('sha256').update(original).digest('hex').toUpperCase(), upstreamHash);
}
const actions = readFileSync(join(mod, 'common/on_actions/00_on_actions.txt'), 'latin1');
for (const name of ['on_dip_development', 'on_mil_development']) {
    const start = actions.indexOf(`${name} = {`);
    const hook = actions.indexOf('Redux_ExpandSubjectToggle = yes', start);
    assert.ok(hook > start && hook < actions.indexOf('has_province_flag = Pin_Show', start));
}
console.log(`PASS: MODIFIED ${cases} selection fixtures; six batch scopes; toggle and exclusions verified; buttons unchanged`);
