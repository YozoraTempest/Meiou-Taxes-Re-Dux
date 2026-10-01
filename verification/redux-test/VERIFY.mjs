import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { active, call, execute, fixtures, get, hook, parse, queue, set, test, world } from '../redux-tweak/runtime.mjs';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../../', import.meta.url)));
const read = path => readFileSync(join(root, 'redux-test', path), 'utf8');
const effects = new Map(parse(read('common/scripted_effects/ReduxTestConstruction.txt')));
const triggers = new Map(parse(read('common/scripted_triggers/ReduxTestConstruction.txt')));
const eventTree = parse(read('events/ReduxTestConstruction.txt'));
assert.equal(eventTree.find(([name]) => name === 'namespace')[1], 'ReduxTest');
const events = new Map(eventTree.filter(([name]) => name.endsWith('_event')).map(([, body]) =>
    [body.find(([name]) => name === 'id')[1], body]));
assert.equal(events.size, 18);
for (const [id, body] of events) {
    assert.ok(id.startsWith('ReduxTest.'));
    assert.equal(new Map(body).get('is_triggered_only'), 'yes');
}
const decisions = new Map(new Map(parse(read('decisions/ReduxTestConstruction.txt'))).get('country_decisions'));
assert.equal(decisions.size, 13);
for (const body of decisions.values()) {
    assert.equal(new Map(new Map(body).get('potential')).get('ai'), 'no');
    assert.deepEqual(new Map(body).get('ai_will_do'), [['factor', '0']]);
    assert.ok(new Map(body).get('effect').some(([scope]) => scope.includes('province') || scope === 'country_event'));
}
for (const name of effects.keys()) assert.ok(name.startsWith('ReduxTest_'));
for (const name of triggers.keys()) assert.ok(name.startsWith('ReduxTest_'));
const localisation = read('localisation/redux-test_l_english.yml');
assert.ok(localisation.startsWith('\uFEFFl_english:'), 'EU4 localisation requires a UTF-8 BOM');
const keys = [...localisation.matchAll(/^ ([A-Za-z0-9_.]+):0 /gm)].map(match => match[1]);
assert.equal(new Set(keys).size, keys.length);
const scanLocalisations = tree => {
    for (const [key, value] of tree) {
        if (Array.isArray(value)) scanLocalisations(value);
        else if (['title', 'desc', 'name', 'tooltip', 'localisation_key'].includes(key) && value.startsWith('redux_test_'))
            assert.ok(keys.includes(value), `Missing localisation: ${value}`);
    }
};
scanLocalisations(eventTree);
scanLocalisations(parse(read('decisions/ReduxTestConstruction.txt')));
const definedTexts = parse(read('customizable_localization/ReduxTestConstruction.txt'));
for (const [kind, body] of definedTexts) {
    assert.equal(kind, 'defined_text');
    for (const [, text] of body.filter(([key]) => key === 'text')) {
        assert.deepEqual(text.map(([key]) => key).sort(), ['localisation_key', 'trigger']);
    }
}
scanLocalisations(definedTexts);
for (const name of decisions.keys()) assert.ok(keys.includes(`${name}_title`) && keys.includes(`${name}_desc`));

function setup(variant) {
    const w = world(variant);
    w.country = { tag: 'TEU', ai: false, vars: { Construct_Parallel: 9 }, flags: new Set() };
    w.aaa = { tag: 'AAA', ai: true, vars: {}, flags: new Set() };
    w.p.owner = w.country;
    w.p.flags.add('UI_Select');
    w.extraEffects = effects;
    w.extraTriggers = triggers;
    w.extraEvents = events;
    w.reports = [];
    set(w.p, 'Construct_Amount', 3);
    set(w.p, 'Construct_Parallel', 5);
    return w;
}
function decision(w, key) {
    const body = new Map(decisions.get(`redux_test_${key}`));
    assert.ok(test(body.get('potential'), w.country, w), `Decision unavailable: ${key}`);
    assert.ok(test(body.get('allow'), w.country, w), `Decision disallowed: ${key}`);
    execute(body.get('effect'), w.country, w);
    return w.reports.at(-1).id;
}
function confirm(w, id, option = 0, province = w.p) {
    const body = events.get(id);
    const choices = body.filter(([name]) => name === 'option').map(([, value]) => value);
    execute(choices[option].filter(([name]) => name !== 'name'), province, w);
}
function start(w, key) {
    confirm(w, decision(w, key));
    assert.ok(w.p.flags.has('ReduxTestProvince'));
    assert.equal(get(w.p, 'Construct_Amount'), 3);
    assert.equal(get(w.p, 'Construct_Parallel'), 5);
}
function action(w, key, scope = w.p) { confirm(w, decision(w, key), 0, scope); }
function audit(w) {
    action(w, 'refill');
    assert.equal(w.reports.at(-1).id, 'ReduxTest.10');
    for (const name of ['Slots', 'Totals', 'Progress', 'Funds']) assert.ok(!w.p.flags.has(`ReduxTest${name}Failed`), name);
}
function verifyCounters(w) {
    if (!w.mt.has('Infra_ParallelAdd')) return;
    for (const name of ['Pathing', 'Harbourage', 'Amenities', 'Irrigation', 'Capitol', 'Garrison']) {
        const ids = { Pathing: [8], Harbourage: [9], Amenities: [10], Irrigation: [11], Capitol: [12, 13], Garrison: [14] }[name];
        assert.equal(get(w.p, `Infra_ParallelConst${name}`), active(w.p).filter(slot => ids.includes(get(w.p, `Infra_S${slot}`))).length);
    }
}

let scenarios = 0;
for (const variant of Object.keys(fixtures.variants)) {
    {
        const w = setup(variant);
        start(w, 'blocked');
        assert.equal(get(w.p, 'ReduxTestManual'), 2);
        assert.equal(get(w.p, 'ReduxTestManualUnits'), 10);
        assert.equal(get(w.p, 'ReduxTestOther'), 8);
        audit(w);
        action(w, 'release');
        assert.equal(active(w.p).length, 10);
        assert.equal(get(w.p, 'Infra_PathingSize'), 0);
        assert.equal(get(w.p, 'Infra_InConstPathing'), 0);
        assert.equal(get(w.p, 'Infra_InConstAmenities'), 10);
        audit(w);
        assert.equal(get(w.p, 'ReduxTestManual'), 10);
        assert.equal(get(w.p, 'ReduxTestUnits'), 10);
        verifyCounters(w);
        const beforeSupply = ['TN_ProvFill6', 'TN_ProvFill10', 'TN_ProvFill22', 'TN_ProvFill23',
            'TN_ProvFill24', 'TN_ProvFill41', 'Prod_FillR', 'Prod_FillUL'].map(key => [key, get(w.p, key)]);
        action(w, 'advance');
        assert.equal(get(w.p, 'ReduxTestCompleted'), 10);
        assert.equal(get(w.p, 'ReduxTestConsumed'), 10);
        assert.equal(active(w.p).length, 0);
        assert.equal(get(w.p, 'Infra_AmenitiesSize'), 10);
        for (const [key, value] of beforeSupply) assert.equal(get(w.p, key), value);
        action(w, 'cleanup');
        assert.ok(!w.p.flags.has('ReduxTestProvince'));
        assert.equal(get(w.p, 'Infra_AmenitiesSize'), 10, 'Cleanup must preserve real completed units');
        verifyCounters(w);
        scenarios++;
    }
    for (const key of ['same_type', 'different_type']) {
        const w = setup(variant);
        start(w, key);
        assert.equal(get(w.p, 'ReduxTestManual'), 8);
        assert.equal(get(w.p, 'ReduxTestOther'), 2);
        audit(w);
        assert.equal(active(w.p).filter(slot => get(w.p, `Infra_S${slot}Owner`) === 4).length, 2);
        action(w, 'cleanup');
        assert.equal(active(w.p).length, 0);
        assert.equal(get(w.p, 'Infra_AmenitiesSize'), 0);
        assert.equal(get(w.p, 'Infra_PathingSize'), 0);
        assert.equal(get(w.p, 'Infra_InConstAmenities'), 0);
        assert.equal(get(w.p, 'Infra_InConstPathing'), 0);
        verifyCounters(w);
        scenarios++;
    }
    {
        const w = setup(variant);
        start(w, 'width_two');
        audit(w);
        assert.equal(get(w.p, 'ReduxTestManual'), 2);
        action(w, 'advance');
        assert.equal(get(w.p, 'ReduxTestCompleted'), 2);
        assert.equal(get(w.p, 'ReduxTestUnits'), 8);
        audit(w);
        assert.equal(get(w.p, 'ReduxTestManual'), 2);
        action(w, 'cleanup');
        assert.equal(get(w.p, 'Infra_AmenitiesSize'), 2);
        assert.equal(get(w.p, 'Infra_InConstAmenities'), 0);
        verifyCounters(w);
        scenarios++;
    }
    {
        const w = setup(variant);
        start(w, 'manual');
        assert.equal(active(w.p).length, 2);
        assert.equal(get(w.p, 'ReduxTestManual'), 0);
        const confirmRefill = events.get('ReduxTest.7').find(([name]) => name === 'option')[1];
        execute(confirmRefill.filter(([name]) => name !== 'name'), w.p, w);
        assert.equal(w.reports.at(-1).id, 'ReduxTest.99', 'No player order must not produce a false PASS');
        set(w.p, 'Construct_Amount', 10);
        set(w.p, 'Construct_Parallel', 10);
        set(w.p, 'Construct_Cost', 0);
        w.p.flags.add('comes_from_manual');
        call(w, 'Construct_BuildInfraHelper', { id: 14 });
        assert.ok(!w.p.flags.has('comes_from_manual'));
        audit(w);
        assert.equal(get(w.p, 'ReduxTestType'), 14);
        assert.equal(get(w.p, 'ReduxTestManual'), 8);
        action(w, 'cleanup');
        assert.equal(get(w.p, 'Infra_InConstGarrison'), 0);
        verifyCounters(w);
        scenarios++;
    }
    {
        const w = setup(variant);
        start(w, 'blocked');
        action(w, 'release');
        decision(w, 'native_event');
        confirm(w, 'ReduxTest.30', 0, w.country);
        assert.equal(w.events, 1);
        assert.equal(get(w.p, 'ReduxTestManual'), 10);
        action(w, 'cleanup');
        scenarios++;
    }
    {
        const w = setup(variant);
        start(w, 'blocked');
        action(w, 'release');
        w.month = 0;
        execute(hook, w.aaa, w);
        assert.equal(active(w.p).length, 10);
        w.month = 1;
        execute(hook, w.aaa, w);
        assert.equal(active(w.p).length, 10);
        decision(w, 'status');
        assert.equal(get(w.p, 'ReduxTestManual'), 10);
        action(w, 'cleanup');
        scenarios++;
    }
    for (const key of ['full_player', 'class_yield']) {
        const w = setup(variant);
        start(w, key);
        assert.equal(get(w.p, 'ReduxTestActive'), 10);
        assert.equal(get(w.p, 'ReduxTestManual'), key === 'full_player' ? 10 : 2);
        assert.equal(get(w.p, 'ReduxTestClassActive'), key === 'full_player' ? 0 : 8);
        assert.equal(get(w.p, 'ReduxTestClassWaiting'), key === 'full_player' ? 4 : 8);
        action(w, 'advance');
        assert.equal(get(w.p, 'ReduxTestCompleted'), 10);
        assert.equal(get(w.p, 'ReduxTestClassActive'), 2);
        assert.equal(get(w.p, 'ReduxTestManual'), 8);
        assert.equal(get(w.p, 'ReduxTestUnits'), key === 'full_player' ? 14 : 16);
        verifyCounters(w);
        action(w, 'cleanup');
        assert.equal(get(w.p, 'ReduxTestUnits'), 0);
        assert.equal(active(w.p).length, 0);
        verifyCounters(w);
        scenarios++;
    }
    for (const corrupted of ['slots', 'totals', 'progress', 'funds', 'payer', 'type']) {
        const w = setup(variant);
        start(w, 'blocked');
        action(w, 'release');
        call(w, 'ReduxTest_Capture');
        call(w, 'Redux_ConstructionRefill');
        if (corrupted === 'slots') set(w.p, 'Infra_S0Parallel', 2);
        if (corrupted === 'totals') set(w.p, 'Infra_InConstAmenities', 11);
        if (corrupted === 'progress') set(w.p, 'Infra_S8R', 999);
        if (corrupted === 'funds') set(w.p, 'NO_Wealth', 49);
        if (corrupted === 'payer') set(w.p, 'Infra_S0Owner', 4);
        if (corrupted === 'type') set(w.p, 'Infra_S0', 8);
        call(w, 'ReduxTest_Audit');
        assert.equal(w.reports.at(-1).id, 'ReduxTest.11', corrupted);
        assert.ok(w.p.flags.has({ slots: 'ReduxTestSlotsFailed', totals: 'ReduxTestTotalsFailed',
            progress: 'ReduxTestProgressFailed', funds: 'ReduxTestFundsFailed', payer: 'ReduxTestSlotsFailed', type: 'ReduxTestSlotsFailed' }[corrupted]));
        scenarios++;
    }
    for (const reason of ['no_selection', 'two_selected', 'occupied', 'simulation', 'freeze', 'existing_test', 'ai']) {
        const w = setup(variant);
        if (reason === 'no_selection') w.p.flags.delete('UI_Select');
        if (reason === 'two_selected') w.provinces.push({ ...w.p, vars: {}, flags: new Set(['UI_Select']) });
        if (reason === 'occupied') queue(w, 0);
        if (reason === 'simulation') w.globals.add('POP_Sim');
        if (reason === 'freeze') w.country.flags.add('UI_Freeze');
        if (reason === 'existing_test') w.p.flags.add('ReduxTestProvince');
        if (reason === 'ai') w.country.ai = true;
        assert.ok(!test(triggers.get('ReduxTest_CanStartProvince'), w.p, w), reason);
        scenarios++;
    }
    {
        const w = setup(variant);
        decision(w, 'blocked');
        confirm(w, 'ReduxTest.1', 1);
        assert.equal(active(w.p).length, 0, 'Cancel must not start projects');
        w.p.flags.add('Infra_S0');
        confirm(w, 'ReduxTest.1');
        assert.equal(w.reports.at(-1).id, 'ReduxTest.99', 'Recheck conditions after the event opens');
        assert.equal(active(w.p).length, 1);
        scenarios++;
    }
    {
        const w = setup(variant);
        start(w, 'manual');
        w.p.flags.add('Infra_S9');
        set(w.p, 'Infra_S9', 7);
        set(w.p, 'Infra_S9Size', 9);
        assert.ok(!test(new Map(decisions.get('redux_test_advance')).get('allow'), w.country, w),
            'Infrastructure completion tests must not process unsupported property slots');
        action(w, 'cleanup');
        assert.ok(w.p.flags.has('ReduxTestProvince'), 'Unsupported project requires the marker to remain');
        assert.ok(w.p.flags.has('Infra_S9'));
        assert.equal(get(w.p, 'Infra_S9Size'), 9);
        assert.equal(w.reports.at(-1).id, 'ReduxTest.99');
        scenarios++;
    }
}
console.log(`PASS: REDUX TEST ${scenarios} decision/event scenarios against both MT variants; fixtures, refill assertions, native event, monthly route, completion speed and cleanup`);
