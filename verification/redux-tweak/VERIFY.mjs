import assert from 'node:assert/strict';
import { get, set, resources, infrastructure, hook, fixtures, execute, world, call, queue, active, group, totals } from './runtime.mjs';

function protectedState(p) {
    return Object.fromEntries(Object.entries(p.vars).filter(([key]) =>
        /^(Infra_InConst|Infra_Wealth|Building_ProjectWealth|NO_Wealth|BG_Wealth|Infra_Spend)/.test(key)));
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
