import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url)));
const outer = readFileSync(resolve(root, 'redux-tweak.mod'), 'utf8');
const inner = readFileSync(resolve(root, 'redux-tweak/descriptor.mod'), 'utf8');
assert.equal(outer.replace(/^path="mod\/redux-tweak"\r?\n?/m, ''), inner, 'Descriptor mismatch');
assert.match(outer, /^path="mod\/redux-tweak"\r?$/m);
assert.match(inner, /^supported_version="v1\.37\.\*\.\*"\r?$/m);
assert.ok(inner.includes('"MEIOU and Taxes v3.0"') && inner.includes('"Pop Display"'));
assert.ok(!/^replace_path=/m.test(outer));
console.log('PASS: descriptor parity, dependency, version, path, no replace_path');
