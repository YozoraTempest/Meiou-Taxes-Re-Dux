import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeLocalisation } from '../../ci/localisation.mjs';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../../', import.meta.url)));
const source = readFileSync(join(root, 'localisation-src/redux-test_l_english.yml'), 'utf8');
const runtime = readFileSync(join(root, 'redux-test/localisation/redux-test_l_english.yml'), 'utf8');
assert.equal(runtime, encodeLocalisation(source), 'Runtime localisation is stale; run node ci/localisation.mjs redux-test');
assert.ok(!/[\u3400-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/u.test(runtime),
    'Chinese text must be escaped for the installed EU4 double-byte patch');

// Decode as EU4 does: convert the UTF-8 text back to CP1252 byte positions,
// then let the double-byte patch interpret the three-byte escape sequences.
const decoder = new TextDecoder('windows-1252');
const bytePositions = new Map(Array.from({ length: 256 }, (_, byte) =>
    [decoder.decode(Uint8Array.of(byte)), byte]));
function decodeEscapes(text) {
    let result = '';
    for (let index = 0; index < text.length; index++) {
        const marker = text.charCodeAt(index);
        if (marker < 0x10 || marker > 0x13) {
            result += text[index];
            continue;
        }
        let low = bytePositions.get(text[++index]);
        let high = bytePositions.get(text[++index]);
        assert.ok(low !== undefined && high !== undefined, 'Invalid CP1252 escape payload');
        if (marker === 0x11 || marker === 0x13) low -= 14;
        if (marker === 0x12 || marker === 0x13) high += 9;
        let codepoint = low + (high << 8);
        if (codepoint > 0xE100 && codepoint < 0xEA00) codepoint -= 0xE000;
        result += String.fromCharCode(codepoint);
    }
    return result;
}
assert.equal(decodeEscapes(runtime), source, 'Escaped localisation must recover every original Chinese character');
assert.deepEqual(runtime.match(/\[[^\]]*\]/gu), source.match(/\[[^\]]*\]/gu),
    'Chinese escape payloads must not introduce or corrupt localisation scope brackets');
assert.equal(runtime.split('[').length, source.split('[').length, 'Unexpected opening scope bracket');
assert.equal(runtime.split(']').length, source.split(']').length, 'Unexpected closing scope bracket');
assert.deepEqual(runtime.match(/§./gu), source.match(/§./gu), 'Chinese escape payloads must not introduce color codes');
for (const [plain, escaped] of [
    ['我', '\x10\x11b'],
    ['地', '\x100W'],
    ['\u5B01', '\x12\x01R'],
    ['\u5B00', '\x13\x0ER'],
    ['部', '\x10\xE8\x90'],
    ['技', '\x11\u017Db'],
    ['工程', '\x12\xE5T\x10\x0Bz'],
    ['\u4E5D', '\x11kN'],
    ['§G通过§! [Root.ReduxTestManual.GetValue]\\n', '\xA7G\x10\x1A\x90\x10\xC7\x8F\xA7! [Root.ReduxTestManual.GetValue]\\n'],
]) {
    assert.equal(encodeLocalisation('\uFEFFl_english:\n key:0 "' + plain + '"\n'),
        '\uFEFFl_english:\n key:0 "' + escaped + '"\n');
}
assert.throws(() => encodeLocalisation(runtime), /pre-escaped/);
const keys = [...source.matchAll(/^ ([A-Za-z0-9_.]+):0 /gm)].map(match => match[1]);
assert.equal(keys.length, 38);
console.log(`PASS: REDUX TEST ${keys.length} localisations; CP1252/escape round trip; fixed byte vectors; scope brackets and color codes preserved`);
