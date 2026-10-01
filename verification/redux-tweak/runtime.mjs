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
        if (key === 'always') return value === 'yes';
        if (key === 'ai') return p.ai === (value === 'yes');
        if (key === 'owner') return test(value, p.owner, w);
        if (key === 'has_country_flag') return p.flags.has(value);
        if (key === 'exists') return value === 'AAA' && !!w.aaa;
        if (key === 'any_owned_province') return w.provinces.some(province => province.owner === p && test(value, province, w));
        if (key === 'num_of_owned_provinces_with') return w.provinces.filter(province => province.owner === p &&
            test(value.filter(([name]) => name !== 'value'), province, w)).length >= Number(Object.fromEntries(value).value);
        if (key === 'custom_trigger_tooltip') return test(value.filter(([name]) => name !== 'tooltip'), p, w);
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
        if (key === 'check_variable' || key === 'is_variable_equal') {
            const names = value.filter(([name]) => name === 'which').map(([, name]) => name);
            const scalar = value.find(([name]) => name === 'value')?.[1];
            const right = scalar === undefined ? get(p, names[1]) : Number(scalar);
            return key === 'check_variable' ? get(p, names[0]) >= right : get(p, names[0]) === right;
        }
        if (w.extraTriggers?.has(key)) return test(substitute(w.extraTriggers.get(key), value === 'yes' ? {} : Object.fromEntries(value)), p, w);
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
        if (key === 'hidden_effect') { execute(value, p, w); continue; }
        if (key === 'owner') { execute(value, p.owner, w); continue; }
        if (key === 'AAA') { execute(value, w.aaa, w); continue; }
        if (key === 'log') { (w.logs ??= []).push(value); continue; }
        if (key === 'while') {
            const limit = value.find(([name]) => name === 'limit')[1];
            let iterations = 0;
            while (test(limit, p, w)) {
                assert.ok(++iterations < 100, 'Unexpected script loop');
                execute(value.filter(([name]) => name !== 'limit'), p, w);
            }
            continue;
        }
        if (key === 'set_province_flag') { p.flags.add(value); continue; }
        if (key === 'clr_province_flag') { p.flags.delete(value); continue; }
        if (key === 'province_event' || key === 'country_event') {
            const id = Object.fromEntries(value).id;
            if (id !== event.get('id')) {
                const report = w.extraEvents?.get(id);
                assert.ok(report, `Unknown test event: ${id}`);
                (w.reports ??= []).push({ id, province: p });
                const immediate = report.find(([name]) => name === 'immediate')?.[1];
                if (immediate) execute(immediate, p, w);
                continue;
            }
            w.events++;
            execute(event.get('immediate'), p, w);
            continue;
        }
        if (['every_province', 'every_owned_province', 'random_owned_province'].includes(key)) {
            const limit = value.find(([name]) => name === 'limit')?.[1];
            for (const province of w.provinces) if ((key === 'every_province' || province.owner === p) &&
                (!limit || test(limit, province, w))) {
                execute(value.filter(([name]) => name !== 'limit'), province, w);
                if (key === 'random_owned_province') break;
            }
            continue;
        }
        if (key === 'set_var_from_key') {
            const args = Object.fromEntries(value);
            set(p, args.var, get(p, args.key));
            continue;
        }
        if (key === 'change_var_by_key' || key === 'set_key_from_var') {
            const args = Object.fromEntries(value);
            if (key === 'change_var_by_key') set(p, args.var, get(p, args.var) + get(p, args.key));
            else set(p, args.key, get(p, args.var));
            continue;
        }
        if (['set_key', 'change_key', 'subtract_key', 'multiply_key', 'divide_key',
            'set_variable', 'change_variable', 'subtract_variable'].includes(key)) {
            const args = Object.fromEntries(value);
            const names = value.filter(([name]) => name === 'which').map(([, name]) => name);
            const variable = key.endsWith('_variable');
            const lhs = variable ? names[0] : args.lhs;
            const right = args.value === undefined ? get(p, variable ? names[1] : args.which) : Number(args.value);
            let result = right;
            if (key.startsWith('change_')) result = get(p, lhs) + right;
            if (key === 'subtract_key' || key === 'subtract_variable') result = get(p, lhs) - right;
            if (key === 'multiply_key') result = get(p, lhs) * right;
            if (key === 'divide_key') result = get(p, lhs) / right;
            set(p, lhs, result);
            continue;
        }
        if (key === 'Infra_SetRankInfra' || key === 'Infra_RefreshModifier') continue; // Rank/modifier refresh does not allocate slots.
        const body = w.extraEffects?.get(key) ?? effects.get(key) ?? w.mt.get(key);
        assert.ok(body, `Unknown effect: ${key}`);
        execute(substitute(body, value === 'yes' ? {} : Object.fromEntries(value)), p, w);
    }
}
function world(variant) {
    const p = { valid: true, vars: {}, flags: new Set() };
    for (const suffix of ['BuildingCost', 'BuildingTime', 'InfraBuild',
        ...Object.values(infrastructure).map(name => `${name}Build`)]) set(p, `Modi_${suffix}`, 1);
    for (const name of ['Infra_Wealth', 'Building_ProjectWealth', 'NO_Wealth', 'BG_Wealth', 'Infra_Spend']) set(p, name, 50);
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

export { parse, substitute, fixed, get, set, resources, infrastructure, effects, hook, event, fixtures, test, execute, world, call, queue, active, group, totals };
