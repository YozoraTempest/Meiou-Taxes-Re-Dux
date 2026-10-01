import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../../', import.meta.url)));
const read = path => readFileSync(join(root, 'redux-tweak', path), 'utf8');
function parse(text) {
    const tokens = text.match(/#[^\r\n]*|"(?:\\.|[^"\\])*"|[{}=]|[^\s{}=]+/g).filter(t => !t.startsWith('#'));
    let i = 0;
    function block(nested = false) {
        const pairs = [];
        while (i < tokens.length && tokens[i] !== '}') {
            const key = tokens[i++];
            assert.equal(tokens[i++], '=', `Expected assignment after ${key}`);
            assert.ok(i < tokens.length, `Missing value after ${key}`);
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
const effects = new Map(parse(read('common/scripted_effects/ReduxConstruction.txt')));
const hook = new Map(parse(read('common/on_actions/ReduxConstruction.txt'))).get('on_monthly_pulse');
const eventFile = new Map(parse(read('events/ReduxConstruction.txt')));
const event = new Map(eventFile.get('country_event'));
assert.equal(eventFile.get('namespace'), 'ReduxConstruction');
assert.equal(event.get('id'), 'ReduxConstruction.1');
assert.equal(event.get('is_triggered_only'), 'yes');
assert.equal(event.get('hidden'), 'yes');
for (const name of effects.keys()) assert.ok(name.startsWith('Redux_Construction'));

const fixtures = JSON.parse(readFileSync(join(root, 'verification/redux-tweak/mt-construction.json'), 'utf8'));
const normalize = tree => tree.map(node => node.length === 3
    ? [node[0], Array.isArray(node[2]) ? normalize(node[2]) : node[2]]
    : [node[0], normalize(node[1])]);
function substitute(tree, params) {
    const replace = text => text.replace(/\$(\w+)\$/g, (_, name) => {
        assert.ok(name in params, `Missing scripted effect parameter ${name}`);
        return params[name];
    });
    return tree.flatMap(([key, value]) => key.startsWith('[')
        ? (key.slice(1, -1) in params ? substitute(value, params) : [])
        : [[replace(key), Array.isArray(value) ? substitute(value, params) : replace(value)]]);
}
const fixed = number => Math.sign(number) * Math.floor(Math.abs(number) * 1000 + 1e-8) / 1000;
const get = (p, key) => p.vars[key] ?? 0;
const set = (p, key, value) => { p.vars[key] = fixed(value); };
const resources = ['6', '10', '22', '23', '24', '41', 'R', 'UL'];
const infrastructure = { 8: 'Pathing', 9: 'Harbourage', 10: 'Amenities', 11: 'Irrigation',
    12: 'Capitol', 13: 'Capitol', 14: 'Garrison' };

// Interpret the delivered scripts together with captured, unmodified MT effects.
// This checks script behavior; it does not emulate EU4's loader or event engine.
function test(tree, p, w) {
    return tree.every(([key, value]) => {
        if (key === 'NOT') return !test(value, p, w);
        if (key === 'OR') return value.some(pair => test([pair], p, w));
        if (key === 'AND') return test(value, p, w);
        if (key === 'has_province_flag') return p.flags.has(value);
        if (key === 'has_global_flag') return w.globals.has(value);
        if (key === 'tag') return p.tag === value;
        if (key === 'is_month') return w.month === Number(value);
        if (key === 'isValidProv') return p.valid;
        if (key === 'check_key' || key === 'is_key_equal') {
            const args = Object.fromEntries(value);
            const right = args.which ? get(p, args.which) : Number(args.value);
            return key === 'check_key' ? get(p, args.lhs) >= right : get(p, args.lhs) === right;
        }
        if (key === 'check_variable') {
            const names = value.filter(([name]) => name === 'which').map(([, name]) => name);
            const scalar = value.find(([name]) => name === 'value')?.[1];
            return get(p, names[0]) >= (scalar === undefined ? get(p, names[1]) : Number(scalar));
        }
        throw new Error(`Unsupported trigger: ${key}`);
    });
}
function execute(tree, p, w) {
    let taken = false;
    for (const [key, value] of tree) {
        if (['if', 'else_if', 'else'].includes(key)) {
            if (key === 'if') taken = false;
            const limit = value.find(([name]) => name === 'limit')?.[1];
            if (!taken && (!limit || test(limit, p, w))) {
                execute(value.filter(([name]) => name !== 'limit'), p, w);
                taken = true;
            }
            continue;
        }
        taken = false;
        if (key === 'set_province_flag') { p.flags.add(value); continue; }
        if (key === 'clr_province_flag') { p.flags.delete(value); continue; }
        if (key === 'country_event') {
            assert.equal(Object.fromEntries(value).id, event.get('id'));
            w.events++;
            execute(event.get('immediate'), p, w);
            continue;
        }
        if (key === 'every_province') {
            const limit = value.find(([name]) => name === 'limit')?.[1];
            for (const province of w.provinces) if (!limit || test(limit, province, w)) {
                execute(value.filter(([name]) => name !== 'limit'), province, w);
            }
            continue;
        }
        if (key === 'set_var_from_key') {
            const args = Object.fromEntries(value);
            set(p, args.var, get(p, args.key));
            continue;
        }
        if (['set_key', 'change_key', 'subtract_key', 'multiply_key', 'set_variable', 'change_variable'].includes(key)) {
            const args = Object.fromEntries(value);
            const lhs = args.lhs ?? args.which;
            const right = args.value === undefined ? get(p, args.which) : Number(args.value);
            let result = right;
            if (key.startsWith('change_')) result = get(p, lhs) + right;
            if (key === 'subtract_key') result = get(p, lhs) - right;
            if (key === 'multiply_key') result = get(p, lhs) * right;
            set(p, lhs, result);
            continue;
        }
        if (key === 'Infra_SetRankInfra') continue; // Display/rank refresh does not allocate slots.
        const body = effects.get(key) ?? w.mt.get(key);
        assert.ok(body, `Unknown effect: ${key}`);
        execute(substitute(body, value === 'yes' ? {} : Object.fromEntries(value)), p, w);
    }
}
function world(variant) {
    const p = { valid: true, vars: {}, flags: new Set() };
    for (const suffix of ['BuildingCost', 'BuildingTime', 'InfraBuild',
        ...Object.values(infrastructure).map(name => `${name}Build`)]) set(p, `Modi_${suffix}`, 1);
    for (const name of ['Infra_Wealth', 'Building_Fund', 'NO_Wealth', 'BG_Wealth', 'Infra_Spend']) set(p, name, 50);
    return { provinces: [p], globals: new Set(), month: 1, events: 0,
        mt: new Map(Object.entries(fixtures.variants[variant].effects).map(([name, tree]) => [name, normalize(tree)])), p };
}
function call(w, name, args = {}, p = w.p) {
    execute([[name, Object.keys(args).length ? Object.entries(args).map(([k, v]) => [k, String(v)]) : 'yes']], p, w);
}
function queue(w, slot, { type = 10, owner = 0, width = 10, pending = 4, progress = 1 } = {}) {
    set(w.p, 'Public_Tmp4', pending + 1);
    set(w.p, 'Construct_Parallel', width);
    call(w, 'Infra_StartProjectHelper', { slot, id: type, size: 'Public_Tmp4', width: 'Construct_Parallel', owner });
    for (const suffix of resources) set(w.p, `Infra_S${slot}${suffix}`, get(w.p, `Infra_S${slot}${suffix}`) * progress);
    set(w.p, `Infra_S${slot}Spend`, 0.123);
    set(w.p, 'Public_Tmp4', 0);
}
const active = p => Array.from({ length: 10 }, (_, slot) => slot).filter(slot => p.flags.has(`Infra_S${slot}`));
const group = (p, slot) => ['','Owner','Parallel'].map(suffix => get(p, `Infra_S${slot}${suffix}`)).join(':');
function totals(p) {
    const result = {};
    for (const slot of active(p)) result[group(p, slot)] = (result[group(p, slot)] ?? 0) + 1 + get(p, `Infra_S${slot}Size`);
    return result;
}
function protectedState(p) {
    return Object.fromEntries(Object.entries(p.vars).filter(([key]) =>
        /^(Infra_InConst|Infra_Wealth|Building_Fund|NO_Wealth|BG_Wealth|Infra_Spend)/.test(key)));
}
function assertDisplay(w) {
    if (!w.mt.has('Infra_ParallelAdd')) return;
    for (const name of new Set(Object.values(infrastructure))) assert.equal(
        get(w.p, `Infra_ParallelConst${name}`), active(w.p).filter(slot => infrastructure[get(w.p, `Infra_S${slot}`)] === name).length);
}
function refill(w) {
    const beforeTotals = totals(w.p);
    const beforeFunds = protectedState(w.p);
    const before = active(w.p).map(slot => ({ slot, group: group(w.p, slot),
        costs: resources.map(suffix => get(w.p, `Infra_S${slot}${suffix}`)), spend: get(w.p, `Infra_S${slot}Spend`) }));
    call(w, 'Redux_ConstructionRefill');
    assert.deepEqual(totals(w.p), beforeTotals, 'Unfinished units changed by type/payer/requested width');
    assert.deepEqual(protectedState(w.p), beforeFunds, 'Existing orders were charged or counted twice');
    for (const state of before) {
        assert.ok(w.p.flags.has(`Infra_S${state.slot}`));
        assert.equal(group(w.p, state.slot), state.group);
        assert.deepEqual(resources.map(suffix => get(w.p, `Infra_S${state.slot}${suffix}`)), state.costs, 'Current-unit progress was reset');
        assert.equal(get(w.p, `Infra_S${state.slot}Spend`), state.spend);
    }
    assert.ok(active(w.p).length <= 10);
    for (const slot of active(w.p)) assert.ok(get(w.p, `Infra_S${slot}Size`) >= 0);
    assertDisplay(w);
    const snapshot = structuredClone(w.p);
    call(w, 'Redux_ConstructionRefill');
    assert.deepEqual(w.p, snapshot, 'Refilling twice should be idempotent');
}

let scenarios = 0;
for (const variant of Object.keys(fixtures.variants)) {
    // Ten units originally placed in two queues while eight other slots were busy.
    const w = world(variant);
    for (let slot = 0; slot < 8; slot++) queue(w, slot, { type: 8, width: 2, pending: 0, progress: 0 });
    queue(w, 8, { progress: 0.5 });
    queue(w, 9, { progress: 0.5 });
    refill(w);
    assert.equal(active(w.p).length, 10);
    for (let slot = 0; slot < 8; slot++) call(w, 'Infra_CheckProject', { slot });
    assert.equal(active(w.p).length, 2);
    refill(w);
    assert.equal(active(w.p).length, 10);
    assert.ok(active(w.p).every(slot => get(w.p, `Infra_S${slot}`) === 10));
    // All new work now progresses through MT's normal annual completion path.
    for (const suffix of ['6','10','22','23','24','41']) set(w.p, `TN_ProvFill${suffix}`, 100);
    set(w.p, 'Prod_FillR', 100); set(w.p, 'Prod_FillUL', 100);
    for (let slot = 0; slot < 10; slot++) call(w, 'Infra_CheckProject', { slot });
    assert.equal(active(w.p).length, 0);
    assert.equal(get(w.p, 'Infra_AmenitiesSize'), 10);
    assert.equal(get(w.p, 'Infra_InConstAmenities'), 0);
    assertDisplay(w);
    scenarios++;

    for (const sameType of [false, true]) {
        const w = world(variant);
        queue(w, 0, { type: sameType ? 10 : 8, width: 2, pending: 3 });
        queue(w, 1, { type: sameType ? 10 : 8, width: 2, pending: 3 });
        queue(w, 2); queue(w, 3);
        refill(w);
        assert.equal(active(w.p).filter(slot => get(w.p, `Infra_S${slot}Parallel`) === 2).length, 2);
        assert.equal(active(w.p).filter(slot => get(w.p, `Infra_S${slot}Parallel`) === 10).length, 8);
        scenarios++;
    }
    for (const width of [1, 2, 5, 10, 12]) {
        const w = world(variant);
        queue(w, 0, { width, pending: 20 });
        refill(w);
        assert.equal(active(w.p).length, Math.min(width, 10));
        scenarios++;
    }
    {
        const w = world(variant);
        queue(w, 0, { owner: 4, width: 3 }); queue(w, 1, { owner: 7, width: 3 });
        refill(w);
        for (const owner of [4, 7]) assert.equal(active(w.p).filter(slot => get(w.p, `Infra_S${slot}Owner`) === owner).length, 3);
        scenarios++;
    }
    {
        const w = world(variant);
        queue(w, 0, { width: 2 }); queue(w, 1, { width: 2, pending: 0 });
        refill(w);
        assert.equal(active(w.p).length, 2, 'Active units without a backlog still consume concurrency');
        scenarios++;
    }
    for (const type of Object.keys(infrastructure).map(Number)) {
        const w = world(variant);
        queue(w, 0, { type, pending: 2, owner: 6 });
        // An unused slot may retain stale metadata; the transferred payer must win.
        set(w.p, 'Infra_S1Owner', 7); set(w.p, 'Infra_S1Spend', 99);
        refill(w);
        assert.equal(active(w.p).length, 3);
        assert.equal(get(w.p, 'Infra_S1Owner'), 6);
        assert.equal(get(w.p, 'Infra_S1Spend'), 0);
        scenarios++;
    }
    {
        const w = world(variant);
        w.p.flags.add('Infra_S0'); set(w.p, 'Infra_S0', 7);
        set(w.p, 'Infra_S0Size', 4); set(w.p, 'Infra_S0Parallel', 10);
        refill(w);
        assert.equal(active(w.p).length, 1, 'Unsupported property IDs must not get infrastructure costs');
        scenarios++;
    }
    for (const [tag, month, sim, expected] of [['AAA', 1, false, 1], ['AAA', 0, false, 0],
        ['AAA', 2, false, 0], ['TEU', 1, false, 0], ['AAA', 1, true, 0]]) {
        const w = world(variant);
        queue(w, 0);
        const invalid = structuredClone(w.p); invalid.valid = false;
        w.provinces.push(invalid); w.month = month;
        if (sim) w.globals.add('POP_Sim');
        execute(hook, { tag }, w);
        assert.equal(w.events, expected);
        assert.equal(active(w.p).length, expected ? 5 : 1);
        assert.equal(active(invalid).length, 1);
        scenarios++;
    }
    let seed = 701;
    const random = max => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    for (let sample = 0; sample < 300; sample++) {
        const w = world(variant);
        for (let slot = 0; slot < 10; slot++) if (random(3)) queue(w, slot, {
            type: 8 + random(7), owner: random(8), width: 1 + random(10), pending: random(8), progress: 0.25 + random(4) * 0.25 });
        refill(w);
        if (active(w.p).length < 10) for (const slot of active(w.p)) {
            if (get(w.p, `Infra_S${slot}Size`) < 1) continue;
            assert.ok(active(w.p).filter(other => group(w.p, other) === group(w.p, slot)).length >=
                get(w.p, `Infra_S${slot}Parallel`), 'Eligible backlog remained despite free slots');
        }
        scenarios++;
    }
}
console.log(`PASS: ${scenarios} construction scenarios against public and installed MT effects; totals, progress, payer, caps, display counters, annual completion and February routing`);
