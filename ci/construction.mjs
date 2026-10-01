import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { sha256 } from './lib.mjs';

export const orderCapacity = 32;
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = join(root, 'verification/redux-tweak/mt-runtime');
const runtimeFiles = ['common/scripted_effects/SYS-Infra.txt', 'common/scripted_triggers/SYS-Infra.txt',
    'events/SYS-CensusNew.txt', 'events/SYS-Construct.txt', 'events/SYS-AI.txt',
    'events/SYS-Courthouse.txt', 'events/E-BurghersEvents.txt', 'decisions/D - Granada.txt'];
const calls = (effect, argument, count = orderCapacity) => Array.from({ length: count }, (_, i) =>
    `    ${effect} = { ${argument} = ${argument === 'order' ? i + 1 : i} }`).join('\n');
const dispatchRecord = (effect, variable, low = 1, high = orderCapacity, indent = '    ') => {
    if (low === high) return `${indent}${effect} = { order = ${low} }`;
    const midpoint = Math.floor((low + high) / 2) + 1;
    return `${indent}if = { limit = { check_variable = { which = ${variable} value = ${midpoint} } }\n` +
        dispatchRecord(effect, variable, midpoint, high, indent + '    ') + `\n${indent}}\n${indent}else = {\n` +
        dispatchRecord(effect, variable, low, midpoint - 1, indent + '    ') + `\n${indent}}`;
};

// All changes use byte offsets in the frozen MT release, preserving unrelated code.
function blockEnd(text, start) {
    let depth = 0, quoted = false, comment = false;
    for (let i = text.indexOf('{', start); i < text.length; i++) {
        const c = text[i];
        if (comment) { if (c === '\r' || c === '\n') comment = false; continue; }
        if (c === '"' && text[i - 1] !== '\\') quoted = !quoted;
        if (quoted) continue;
        if (c === '#') { comment = true; continue; }
        if (c === '{') depth++;
        if (c === '}' && --depth === 0) return i + 1;
    }
    throw new Error('Unclosed MT block');
}
function applyEdits(text, edits) {
    edits.sort((a, b) => a.start - b.start);
    for (let i = 1; i < edits.length; i++) assert.ok(edits[i - 1].end <= edits[i].start, 'Overlapping MT patches');
    let output = '', cursor = 0;
    for (const edit of edits) { output += text.slice(cursor, edit.start) + edit.replacement; cursor = edit.end; }
    return output + text.slice(cursor);
}
export function patchRuntime(path, bytes, aliases) {
    const text = bytes.toString('latin1'), edits = [];
    const inverse = Object.fromEntries(Object.entries(aliases).map(([key, alias]) => [alias, key]));
    const edit = (start, end, replacement, reason) => edits.push({ start, end, replacement, reason });
    if (path === 'common/scripted_effects/SYS-Infra.txt') {
        for (const [name, replacement] of [
            ['Infra_StartProject', `Infra_StartProject = {
    set_variable = { which = Redux_ConstructionInputType value = $id$ }
    if = { limit = { check_variable = { which = Redux_ConstructionInputType value = 8 }
        NOT = { check_variable = { which = Redux_ConstructionInputType value = 15 } } }
        Redux_ConstructionSubmit = { id = $id$ height = $height$ width = $width$ origin = 1 [[owner] owner = $owner$ ] }
    }
    else = { Redux_ConstructionStartProperty = { id = $id$ height = $height$ width = $width$ [[owner] owner = $owner$ ] } }
}`],
            ['Infra_CheckProject', `Infra_CheckProject = {
    Redux_ConstructionPrepare = yes
    if = { limit = { has_province_flag = Redux_ConstructionS$slot$ }
        Redux_ConstructionCheckUnit = { slot = $slot$ }
    }
    else = {
        Redux_ConstructionCheckProperty = { slot = $slot$ }
        if = { limit = { NOT = { has_province_flag = Infra_S$slot$ }
            NOT = { has_province_flag = Redux_ConstructionSuspended } }
            Redux_ConstructionDispatch = yes
        }
    }
}`],
        ]) {
            const start = text.indexOf(`${name} = {`), end = blockEnd(text, start);
            assert.ok(start >= 0);
            const original = text.slice(start, end).replace(name, name === 'Infra_StartProject'
                ? 'Redux_ConstructionStartProperty' : 'Redux_ConstructionCheckProperty');
            edit(start, end, replacement + '\n\n' + original, name);
        }
    } else if (path === 'common/scripted_triggers/SYS-Infra.txt') {
        const start = text.indexOf('Infra_CanConstruct = {'), end = blockEnd(text, start);
        const original = text.slice(start, end).replace('Infra_CanConstruct', 'Redux_ConstructionHasFreeSlot');
        edit(start, end, `${original}
Infra_CanConstruct = {
    OR = {
        AND = { is_key_equal = { lhs = Construct_Type value = 3 } Redux_ConstructionCanQueue = yes }
        AND = { NOT = { is_key_equal = { lhs = Construct_Type value = 3 } } Redux_ConstructionHasFreeSlot = yes }
    }
}`, 'Infrastructure admission');
    } else {
        const startPattern = /set_variable\s*=\s*\{\s*which\s*=\s*amo\s+value\s*=\s*10\s*\}\s*set_variable\s*=\s*\{\s*which\s*=\s*amp\s+which\s*=\s*(\w+)\s*\}\s*set_variable\s*=\s*\{\s*which\s*=\s*amq\s+value\s*=\s*0\s*\}/g;
        const endPattern = /set_variable\s*=\s*\{\s*which\s*=\s*amo\s+value\s*=\s*0\s*\}\s*set_variable\s*=\s*\{\s*which\s*=\s*amp\s+value\s*=\s*0\s*\}\s*set_variable\s*=\s*\{\s*which\s*=\s*amq\s+value\s*=\s*0\s*\}\s*set_variable\s*=\s*\{\s*which\s*=\s*amr\s+value\s*=\s*0\s*\}/g;
        for (const match of text.matchAll(startPattern)) {
            endPattern.lastIndex = match.index;
            const end = endPattern.exec(text);
            assert.ok(end, 'MT allocator end missing');
            const body = text.slice(match.index, end.index + end[0].length);
            const id = body.match(new RegExp(`which\\s*=\\s*${aliases.Infra_S0}\\s+value\\s*=\\s*(\\d+)`))?.[1];
            assert.ok(id, 'MT allocator type missing');
            if (+id < 8 || +id > 14) continue;
            const width = body.match(new RegExp(`which\\s*=\\s*${aliases.Infra_S0Parallel}\\s+which\\s*=\\s*(\\w+)`))?.[1];
            const payer = body.match(new RegExp(`which\\s*=\\s*${aliases.Infra_S0Owner}\\s+value\\s*=\\s*(\\d+)`))?.[1] ?? '0';
            assert.ok(inverse[match[1]] && inverse[width], 'MT allocator input aliases missing');
            const origin = path.endsWith('SYS-CensusNew.txt') || path.endsWith('E-BurghersEvents.txt') ? 2 : 1;
            edit(match.index, end.index + end[0].length,
                `Redux_ConstructionSubmit = { id = ${id} height = ${inverse[match[1]]} width = ${inverse[width]} owner = ${payer} origin = ${origin} }`, 'Infrastructure order');
        }
        // Reconnect expanded construction eligibility to the updated trigger.
        const gate = /AND\s*=\s*\{\s*OR\s*=\s*\{\s*NOT\s*=\s*\{\s*has_province_flag\s*=\s*Infra_S0\s*\}/g;
        for (const match of text.matchAll(gate)) {
            const end = blockEnd(text, match.index), body = text.slice(match.index, end);
            if ((body.match(/has_province_flag/g) ?? []).length !== 10 || /Infra_S10/.test(body)) continue;
            edit(match.index, end, 'Infra_CanConstruct = yes', 'Expanded admission');
        }
        if (path === 'events/SYS-AI.txt') {
            // Check room before capital/amenities budgets are transferred.
            const scopes = /(?:capital_scope|event_target:Prov_BiggestCity_[123]|every_owned_province|every_province)\s*=\s*\{/g;
            const limits = new Set();
            for (const match of text.matchAll(scopes)) {
                const end = blockEnd(text, match.index);
                if (!edits.some(change => change.reason === 'Infrastructure order' && change.start > match.index && change.end < end)) continue;
                const start = text.indexOf('limit = {', match.index);
                assert.ok(start < end);
                limits.add(start);
            }
            for (const start of limits) {
                const opening = text.indexOf('{', start) + 1;
                edit(opening, opening, '\nRedux_ConstructionCanQueue = yes\n', 'AI budget admission');
            }
            // The CE loop must stop selecting full provinces; skipping its body
            // without removing the candidate would leave its budget loop running.
            const candidates = /limit\s*=\s*\{\s*has_province_flag\s*=\s*CE_Cand/g;
            for (const match of text.matchAll(candidates)) {
                const end = blockEnd(text, match.index), body = text.slice(match.index, end);
                const highest = new RegExp(`which\\s*=\\s*${aliases.Tmp_0}\\s+value\\s*=\\s*0\\.001`);
                if (!highest.test(body) || !body.includes('event_target:Prov')) continue;
                const opening = text.indexOf('{', match.index) + 1;
                edit(opening, opening, '\nRedux_ConstructionCanQueue = yes\n', 'AI candidate admission');
            }
        }
        if (path === 'events/E-BurghersEvents.txt') {
            const event = text.indexOf('id = burghers_estate_events.13');
            const option = text.indexOf('name = burghers_estate_events.13.a', event);
            const opening = text.lastIndexOf('option = {', option) + 'option = {'.length;
            assert.ok(option > event && opening > event);
            edit(opening, opening, '\ntrigger = { event_target:urbanization_province = { Redux_ConstructionCanQueue = yes } }\n', 'Estate option admission');
        }
        if (path === 'events/SYS-CensusNew.txt') {
            const census = text.indexOf('id = POP_Census.107');
            const start = text.indexOf('limit = {', census), end = blockEnd(text, start);
            // The old free-slot and all-infrastructure guards forbid waiting orders.
            for (let i = edits.length - 1; i >= 0; i--) if (edits[i].start >= start && edits[i].end <= end) edits.splice(i, 1);
            edit(start, end, `limit = {
                        isValidProv = yes
                        check_key = { lhs = Infra_Wealth value = 80 }
                        check_key = { lhs = Infra_Fill value = 99 }
                        Redux_ConstructionCanQueue = yes
                    }`, 'Class order admission');
            for (let slot = 0; slot < 10; slot++) {
                const pattern = new RegExp(`if\\s*=\\s*\\{\\s*limit\\s*=\\s*\\{\\s*has_province_flag\\s*=\\s*Infra_S${slot}\\s*\\}\\s*if\\s*=\\s*\\{\\s*limit\\s*=\\s*\\{\\s*AND\\s*=\\s*\\{\\s*check_variable\\s*=\\s*\\{\\s*which\\s*=\\s*${aliases[`Infra_S${slot}6`]}\\s+value\\s*=\\s*0\\.1`, 'g');
                const matches = [...text.matchAll(pattern)];
                assert.equal(matches.length, 1, `Annual check ${slot}`);
                const start = matches[0].index, end = blockEnd(text, start);
                edit(start, end, `${slot === 0 ? 'Redux_ConstructionAnnualBegin = yes\n' : ''}Redux_ConstructionAnnualCheck = { slot = ${slot} }${slot === 9 ? '\nRedux_ConstructionAnnualEnd = yes' : ''}`, 'Annual unit completion');
            }
        }
    }
    return { bytes: Buffer.from(applyEdits(text, edits), 'latin1'), edits };
}

export function generateDispatch() {
    return `# Generated by ci/construction.mjs. Edit scheduler helpers, not this file.
Redux_ConstructionPrepare = {
${calls('Redux_ConstructionImportSlot', 'slot', 10)}
}
Redux_ConstructionRefresh = {
    clr_province_flag = Redux_ConstructionOrders
    set_variable = { which = Redux_ConstructionManualPresent value = 0 }
    set_variable = { which = Redux_ConstructionClassActive value = 0 }
${calls('Redux_ConstructionResetActive', 'order')}
${calls('Redux_ConstructionCountActive', 'slot', 10)}
${calls('Redux_ConstructionRefreshOrder', 'order')}
}
Redux_ConstructionFindRecord = {
    set_variable = { which = Redux_ConstructionRecord value = 0 }
${calls('Redux_ConstructionFindEmpty', 'order')}
}
Redux_ConstructionImportFind = {
    set_variable = { which = Redux_ConstructionRecord value = 0 }
${calls('Redux_ConstructionFindLegacy', 'order')}
    if = { limit = { is_variable_equal = { which = Redux_ConstructionRecord value = 0 } }
        Redux_ConstructionFindRecord = yes
        Redux_ConstructionCreateRecord = yes
    }
}
Redux_ConstructionCreateRecord = {
${dispatchRecord('Redux_ConstructionCreateAt', 'Redux_ConstructionRecord')}
}
Redux_ConstructionAttachRecord = {
${dispatchRecord('Redux_ConstructionAttachAt', 'Redux_ConstructionRecord')}
}
Redux_ConstructionCountRecord = {
${dispatchRecord('Redux_ConstructionCountAt', 'Redux_ConstructionCountRecord')}
}
Redux_ConstructionPick = {
    set_variable = { which = Redux_ConstructionChoice value = 0 }
    set_variable = { which = Redux_ConstructionAge value = 0 }
${calls('Redux_ConstructionPickClass', 'order')}
    if = { limit = { is_variable_equal = { which = Redux_ConstructionChoice value = 0 } }
${calls('Redux_ConstructionPickState', 'order')}
    }
}
Redux_ConstructionOpen = {
${dispatchRecord('Redux_ConstructionOpenAt', 'Redux_ConstructionChoice')}
}
Redux_ConstructionDispatch = {
    Redux_ConstructionPrepare = yes
    Redux_ConstructionRefresh = yes
${calls('Redux_ConstructionDispatchSlot', 'slot', 10)}
    Redux_ConstructionRefresh = yes
    Infra_RefreshModifier = yes
}
Redux_ConstructionRefill = { Redux_ConstructionDispatch = yes }
Redux_ConstructionAnnualBegin = {
    Redux_ConstructionPrepare = yes
${calls('Redux_ConstructionSnapshotSlot', 'slot', 10)}
}
Redux_ConstructionAnnualEnd = {
${Array.from({ length: 10 }, (_, slot) => `    clr_province_flag = Redux_ConstructionAnnualS${slot}`).join('\n')}
}
Redux_ConstructionCancelWaiting = {
${calls('Redux_ConstructionCancelOrder', 'order')}
}
`;
}

export function generateTriggers() {
    return `# Generated by ci/construction.mjs.
Redux_ConstructionCanQueue = {
    OR = {
${Array.from({ length: orderCapacity }, (_, i) => `        NOT = { has_province_flag = Redux_ConstructionQ${i + 1} }`).join('\n')}
    }
}
Redux_ConstructionNeedsDispatch = {
    OR = {
        AND = { has_province_flag = Redux_ConstructionOrders Redux_ConstructionHasFreeSlot = yes }
${Array.from({ length: 10 }, (_, slot) => `        AND = {
            has_province_flag = Infra_S${slot}
            NOT = { has_province_flag = Redux_ConstructionS${slot} }
            check_key = { lhs = Infra_S${slot} value = 8 }
            NOT = { check_key = { lhs = Infra_S${slot} value = 15 } }
        }`).join('\n')}
    }
}
`;
}

export function generateRuntime() {
    const manifest = JSON.parse(readFileSync(join(fixture, 'manifest.json'), 'utf8'));
    return manifest.files.map(record => {
        const original = gunzipSync(readFileSync(join(fixture, record.fixture)));
        assert.equal(sha256(original), record.sha256, record.path);
        return { ...record, ...patchRuntime(record.path, original, manifest.aliases) };
    });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    if (process.argv[2] === 'capture') {
        assert.ok(process.argv[3], 'Specify the installed MT release directory');
        mkdirSync(fixture, { recursive: true });
        const aliasFile = readFileSync(join(process.argv[3], 'common/scripted_effects/00-scripts.txt'), 'utf8');
        const aliases = Object.fromEntries([...aliasFile.matchAll(/set_key_rhs_(\w+)\s*=\s*\{\s*_b\s*=\s*\{\s*d\s*=\s*(\w+)/g)]
            .filter(match => /^(?:Infra_S\d(?:6|Owner|Parallel)?|Public_Tmp\d+|Tmp_\d+|Construct_(?:Amount|Parallel)|Courthouse_(?:Amount|Parallel))$/.test(match[1]))
            .map(match => [match[1], match[2]]));
        const files = runtimeFiles.map((path, index) => {
            const original = readFileSync(join(process.argv[3], path)), name = `${index}.txt.gz`;
            writeFileSync(join(fixture, name), gzipSync(original));
            return { path, fixture: name, sha256: sha256(original) };
        });
        writeFileSync(join(fixture, 'manifest.json'), JSON.stringify({ source: 'Installed MEIOU and Taxes v3.0 release', aliases, files }, null, 2) + '\n');
    }
    for (const result of generateRuntime()) {
        const destination = join(root, 'redux-tweak', result.path);
        mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, result.bytes);
        console.log(`MT PATCH: ${result.path}; ${result.edits.length} changes`);
    }
    writeFileSync(join(root, 'redux-tweak/common/scripted_effects/ReduxConstructionDispatch.txt'), generateDispatch());
    mkdirSync(join(root, 'redux-tweak/common/scripted_triggers'), { recursive: true });
    writeFileSync(join(root, 'redux-tweak/common/scripted_triggers/ReduxConstruction.txt'), generateTriggers());
}
