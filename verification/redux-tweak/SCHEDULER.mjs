import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateRuntime, generateDispatch, generateTriggers, orderCapacity } from '../../ci/construction.mjs';
import { active, call, get, set, resources, infrastructure, fixtures, test, constructionTriggers, queue, totals, world } from './runtime.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => readFileSync(join(root, 'redux-tweak', path));
const generated = generateRuntime();
for (const result of generated) assert.deepEqual(read(result.path), result.bytes, `MT runtime differs: ${result.path}`);
assert.equal(read('common/scripted_effects/ReduxConstructionDispatch.txt').toString(), generateDispatch());
assert.equal(read('common/scripted_triggers/ReduxConstruction.txt').toString(), generateTriggers());
const nativeOrders = generated.flatMap(result => result.edits.filter(edit => edit.reason === 'Infrastructure order'));
assert.equal(nativeOrders.length, 35);
assert.equal(nativeOrders.filter(edit => edit.replacement.includes('origin = 2')).length, 6);
const aiGuards = generated.find(result => result.path === 'events/SYS-AI.txt').edits;
assert.equal(aiGuards.filter(edit => edit.reason === 'AI budget admission').length, 6);
assert.equal(aiGuards.filter(edit => edit.reason === 'AI candidate admission').length, 1);
assert.equal(generated.find(result => result.path === 'events/E-BurghersEvents.txt').edits.filter(edit =>
    edit.reason === 'Estate option admission').length, 1);
assert.equal(generated.find(result => result.path === 'events/SYS-CensusNew.txt').edits.filter(edit =>
    edit.reason === 'Annual unit completion').length, 10);

const records = p => Array.from({ length: orderCapacity }, (_, i) => i + 1).filter(i => p.flags.has(`Redux_ConstructionQ${i}`));
const count = (p, origin) => active(p).filter(slot => get(p, `Redux_ConstructionS${slot}Origin`) === origin).length;
const pending = (p, origin) => records(p).filter(order => get(p, `Redux_ConstructionQ${order}Origin`) === origin)
    .reduce((sum, order) => sum + get(p, `Redux_ConstructionQ${order}Pending`), 0);
const units = p => Object.values(totals(p)).reduce((a, b) => a + b, 0);
function submit(w, { type = 10, amount = 20, width = 10, owner = 0, origin = 1 } = {}) {
    set(w.p, 'Construct_Amount', amount); set(w.p, 'Construct_Parallel', width);
    call(w, 'Redux_ConstructionSubmit', { id: type, height: 'Construct_Amount', width: 'Construct_Parallel', owner, origin });
}
function tick(w) {
    for (const key of ['TN_ProvFill6', 'TN_ProvFill10', 'TN_ProvFill22', 'TN_ProvFill23', 'TN_ProvFill24',
        'TN_ProvFill41', 'Prod_FillR', 'Prod_FillUL']) set(w.p, key, 100);
    call(w, 'Redux_ConstructionAnnualBegin');
    for (let slot = 0; slot < 10; slot++) call(w, 'Redux_ConstructionAnnualCheck', { slot });
    call(w, 'Redux_ConstructionAnnualEnd');
    check(w);
}
function check(w) {
    assert.ok(active(w.p).length <= 10);
    for (const slot of active(w.p)) if (w.p.flags.has(`Redux_ConstructionS${slot}`)) {
        assert.equal(get(w.p, `Infra_S${slot}Size`), 0, 'A work slot contains only its current unit');
        const order = get(w.p, `Redux_ConstructionS${slot}Order`);
        assert.ok(w.p.flags.has(`Redux_ConstructionQ${order}`));
        assert.equal(get(w.p, `Infra_S${slot}`), get(w.p, `Redux_ConstructionQ${order}Type`));
        assert.equal(get(w.p, `Infra_S${slot}Owner`), get(w.p, `Redux_ConstructionQ${order}Owner`));
        assert.equal(get(w.p, `Redux_ConstructionS${slot}Origin`), get(w.p, `Redux_ConstructionQ${order}Origin`));
    }
    for (const order of records(w.p)) {
        assert.ok(get(w.p, `Redux_ConstructionQ${order}Pending`) >= 0);
        const actual = active(w.p).filter(slot => get(w.p, `Redux_ConstructionS${slot}Order`) === order).length;
        assert.equal(get(w.p, `Redux_ConstructionQ${order}Active`), actual);
        // Imported current units may already exceed the merged legacy cap.
        if (get(w.p, `Redux_ConstructionQ${order}Origin`) !== 0)
            assert.ok(actual <= get(w.p, `Redux_ConstructionQ${order}Width`));
        if (get(w.p, `Redux_ConstructionQ${order}Origin`) === 2) assert.ok(actual <= 2);
    }
    for (const name of new Set(Object.values(infrastructure))) {
        const unfinished = Object.entries(totals(w.p)).filter(([key]) => infrastructure[+key.split(':')[0]] === name)
            .reduce((sum, [, value]) => sum + value, 0);
        assert.equal(get(w.p, `Infra_InConst${name}`), unfinished, name);
        assert.equal(get(w.p, `Infra_ParallelConst${name}`), active(w.p).filter(slot => infrastructure[get(w.p, `Infra_S${slot}`)] === name).length);
    }
}
const progress = p => Object.fromEntries(Object.entries(p.vars).filter(([key]) => /^Infra_S\d(?:\D|$)/.test(key)));
let scenarios = 0;
for (const variant of Object.keys(fixtures.variants)) {
    // Every infrastructure type and player cap preserves units, payers and costs.
    for (const type of Object.keys(infrastructure).map(Number)) for (let width = 1; width <= 10; width++) {
        const w = world(variant);
        submit(w, { type, width, owner: 6, amount: 23 });
        assert.equal(active(w.p).length, width); assert.equal(units(w.p), 23); check(w);
        let completed = 0;
        while (units(w.p)) {
            const before = units(w.p), current = active(w.p).length;
            tick(w); assert.equal(before - units(w.p), current, 'New units cannot finish in the same census');
            completed += current;
        }
        assert.equal(completed, 23); assert.equal(records(w.p).length, 0);
        scenarios++;
    }
    {
        const w = world(variant);
        submit(w); const before = progress(w.p);
        submit(w, { type: 14, amount: 2, width: 2, origin: 2 });
        submit(w, { type: 8, amount: 2, width: 2, origin: 2 });
        assert.deepEqual(progress(w.p), before, 'Waiting class orders cannot preempt ten player units');
        assert.equal(count(w.p, 1), 10); assert.equal(count(w.p, 2), 0); assert.equal(pending(w.p, 2), 4); check(w);
        tick(w); assert.equal(count(w.p, 2), 2); assert.equal(count(w.p, 1), 8); assert.equal(pending(w.p, 2), 2);
        assert.equal(units(w.p), 14);
        tick(w); assert.equal(count(w.p, 2), 2); assert.equal(count(w.p, 1), 2);
        tick(w); assert.equal(active(w.p).length, 0); scenarios++;
    }
    {
        const w = world(variant);
        for (let i = 0; i < 4; i++) submit(w, { type: 8, amount: 4, width: 2, origin: 2 });
        assert.equal(count(w.p, 2), 8); const before = progress(w.p);
        submit(w, { amount: 10 }); assert.equal(count(w.p, 2), 8); assert.equal(count(w.p, 1), 2);
        for (const [key, value] of Object.entries(before)) assert.equal(get(w.p, key), value);
        tick(w); assert.equal(count(w.p, 2), 2); assert.equal(count(w.p, 1), 8);
        tick(w); assert.equal(count(w.p, 1), 0); assert.equal(count(w.p, 2), 6, 'Class orders recover per-order caps once all player work finishes');
        check(w); scenarios++;
    }
    {
        const w = world(variant);
        submit(w, { width: 2, amount: 5 }); submit(w, { width: 2, amount: 5 });
        assert.equal(count(w.p, 1), 4, 'Two identical new orders retain separate concurrency caps');
        tick(w); assert.equal(count(w.p, 1), 4); check(w); scenarios++;
    }
    {
        const w = world(variant);
        queue(w, 0, { pending: 7, progress: 0.5 }); queue(w, 1, { pending: 7, progress: 0.25 });
        const before = progress(w.p), total = totals(w.p);
        call(w, 'Redux_ConstructionRefill'); assert.deepEqual(totals(w.p), total);
        for (const [key, value] of Object.entries(before)) if (!key.endsWith('Size')) assert.equal(get(w.p, key), value);
        assert.equal(count(w.p, 0), 10); assert.equal(records(w.p).length, 1); check(w);
        submit(w, { type: 14, amount: 6, width: 2, origin: 2 });
        assert.equal(count(w.p, 2), 0); tick(w); assert.equal(count(w.p, 2), 2);
        check(w); scenarios++;
    }
    {
        const w = world(variant);
        submit(w, { width: 1, amount: 2 });
        tick(w); assert.equal(get(w.p, 'Infra_AmenitiesSize'), 1); assert.equal(active(w.p).length, 1);
        tick(w); assert.equal(get(w.p, 'Infra_AmenitiesSize'), 2); assert.equal(active(w.p).length, 0);
        submit(w, { type: 14, width: 2, amount: 3 });
        assert.equal(records(w.p)[0], 1, 'Released record storage can be reused'); scenarios++;
    }
    {
        const w = world(variant);
        submit(w);
        for (let i = 1; i < orderCapacity; i++) submit(w, { type: 14, amount: 2, width: 2, origin: 2 });
        assert.equal(records(w.p).length, 32); const before = totals(w.p);
        set(w.p, 'Construct_Type', 3);
        assert.ok(!test(constructionTriggers.get('Infra_CanConstruct'), w.p, w), 'Full order storage disables manual construction before payment');
        submit(w); assert.ok(w.p.flags.has('Redux_ConstructionRejected')); assert.deepEqual(totals(w.p), before);
        check(w); scenarios++;
    }
    {
        const w = world(variant);
        submit(w, { amount: 10 }); set(w.p, 'Construct_Type', 3);
        assert.ok(test(constructionTriggers.get('Infra_CanConstruct'), w.p, w));
        set(w.p, 'Construct_Type', 1); assert.ok(!test(constructionTriggers.get('Infra_CanConstruct'), w.p, w));
        const order = get(w.p, 'Redux_ConstructionS0Order');
        for (const suffix of resources) set(w.p, `Infra_S0${suffix}`, 0);
        call(w, 'Infra_CheckProject', { slot: 0 });
        assert.equal(active(w.p).length, 9); assert.equal(get(w.p, `Redux_ConstructionQ${order}Active`), 9);
        set(w.p, 'Construct_Type', 1); assert.ok(test(constructionTriggers.get('Infra_CanConstruct'), w.p, w));
        scenarios++;
    }
    {
        const w = world(variant);
        submit(w, { amount: 10 });
        for (let i = 1; i < orderCapacity; i++) submit(w, { type: 14, amount: 2, width: 2, origin: 2 });
        while (units(w.p)) tick(w);
        assert.equal(records(w.p).length, 0, 'All 32 records can be dispatched and reclaimed');
        scenarios++;
    }
    {
        const w = world(variant);
        for (let slot = 0; slot < 8; slot++) queue(w, slot, { type: 8, width: 2, pending: 3, progress: 0.5 });
        for (let slot = 8; slot < 10; slot++) queue(w, slot, { type: 9, width: 10, pending: 4, progress: 0.25 });
        const before = progress(w.p), total = totals(w.p);
        call(w, 'Redux_ConstructionRefill'); assert.deepEqual(totals(w.p), total);
        assert.equal(active(w.p).filter(slot => get(w.p, `Infra_S${slot}`) === 8).length, 8);
        for (const [key, value] of Object.entries(before)) if (!key.endsWith('Size')) assert.equal(get(w.p, key), value);
        check(w); tick(w);
        assert.equal(active(w.p).filter(slot => get(w.p, `Infra_S${slot}`) === 8).length, 2);
        assert.equal(units(w.p), 32); scenarios++;
    }
    {
        const w = world(variant);
        submit(w, { amount: 20 }); submit(w, { type: 9, amount: 10 });
        tick(w); assert.ok(active(w.p).every(slot => get(w.p, `Infra_S${slot}`) === 10));
        tick(w); assert.ok(active(w.p).every(slot => get(w.p, `Infra_S${slot}`) === 9));
        assert.equal(units(w.p), 10); scenarios++;
    }
}
console.log(`PASS: ${scenarios} order scheduler scenarios; non-preemption, conditional class cap, separate orders, legacy progress, annual snapshots, record reuse and admission; ${nativeOrders.length} expanded MT order entries`);
