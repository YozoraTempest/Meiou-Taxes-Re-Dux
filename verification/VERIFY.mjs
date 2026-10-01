import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url)));
const id = process.argv[3] ?? 'redux-tweak';
assert.ok(['redux-tweak', 'redux-subject'].includes(id));
const outer = readFileSync(resolve(root, `${id}.mod`), 'utf8');
const inner = readFileSync(resolve(root, id, 'descriptor.mod'), 'utf8');
assert.equal(outer.replace(/^path="[^"\r\n]*"\r?\n?/m, ''), inner, 'Descriptor mismatch');
assert.ok(outer.includes(`path="mod/${id}"`));
assert.match(inner, /^supported_version="v1\.37\.\*\.\*"\r?$/m);
assert.ok(inner.includes('"MEIOU and Taxes v3.0"'));
assert.equal(inner.includes('"Pop Display"'), id === 'redux-subject');
assert.ok(!/^replace_path=/m.test(outer));
if (id === 'redux-subject') {
    assert.equal(createHash('sha256').update(readFileSync(resolve(root, id, 'common/scripted_effects/SYS-Construct.txt')))
        .digest('hex').toUpperCase(), 'F179ED5E26FB1469D5D57AC173313261295F35A9A94F772F21C13A597F002CA3');
} else {
    assert.equal(existsSync(resolve(root, id, 'common/scripted_effects/SYS-Construct.txt')), false,
        'Subject construction belongs to Redux Subject');
}
console.log('PASS: descriptor parity, dependency, version, path, no replace_path');
