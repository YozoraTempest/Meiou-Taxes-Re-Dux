import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encoding } from './vendor/eu4-special-escape/encode.mjs';

export function encodeLocalisation(source) {
    assert.ok(source.startsWith('\uFEFFl_english:'), 'Localisation source must have a UTF-8 BOM and English language header');
    const text = source.slice(1);
    assert.ok(!/[\x10-\x13]/u.test(text), 'Localisation source must contain readable text, not pre-escaped text');
    assert.ok([...text].every(character => character.codePointAt(0) <= 0xFFFF),
        'EU4 double-byte localisation only supports characters in the Unicode BMP');
    return '\uFEFF' + encoding(text);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const [id] = process.argv.slice(2);
    assert.match(id ?? '', /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Usage: node ci/localisation.mjs MOD_ID');
    const source = join(root, 'localisation-src', `${id}_l_english.yml`);
    const destination = join(root, id, 'localisation', `${id}_l_english.yml`);
    writeFileSync(destination, encodeLocalisation(readFileSync(source, 'utf8')), 'utf8');
    console.log(`LOCALISATION GENERATED: ${id}; EU4 double-byte escape encoding; UTF-8 BOM`);
}
