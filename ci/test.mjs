import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { affectedMods, compareVersions, describeMod, findRelease, loadRegistry, nightlyNeeded, packageFiles, releaseNeeded, safePath } from './lib.mjs';

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'mod-ci-test-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const write = (path, value) => {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), value);
    };
    const registry = { schema_version: 1, shared_inputs: ['ci/package.sh'], mods: ['alpha', 'beta'].map(id => ({
        id, name: id, files: ['descriptor.mod', 'common/test.txt'], test_inputs: [`verification/${id}.mjs`],
        tests: [['node', `verification/${id}.mjs`]], depends_on: []
    })) };
    for (const mod of registry.mods) {
        const descriptor = `name="${mod.name}"\nversion="1.0.0"\n`;
        write(`${mod.id}/descriptor.mod`, descriptor);
        write(`${mod.id}.mod`, `${descriptor}path="mod/${mod.id}"\n`);
        write(`${mod.id}/common/test.txt`, 'value = 1\r\n');
        write(`verification/${mod.id}.mjs`, 'console.log("PASS");\n');
    }
    write('ci/package.sh', '# fixture\n');
    write('LICENSE', 'fixture license\n');
    const save = () => write('ci/mods.json', JSON.stringify(registry));
    save();
    return { root, registry, write, save, describe: id => describeMod(root, registry, registry.mods.find(mod => mod.id === id)) };
}

test('registry validates multiple independent mods', t => {
    const f = fixture(t);
    assert.equal(loadRegistry(f.root).mods.length, 2);
    assert.equal(packageFiles(f.root, f.registry.mods[0]).length, 4);
});
for (const path of ['../escape', '/absolute', 'a/../b', 'a\\b', 'C:/absolute', 'a//b', './a', '']) {
    test(`reject unsafe path ${JSON.stringify(path)}`, () => assert.throws(() => safePath(path)));
}
test('reject duplicate IDs', t => {
    const f = fixture(t);
    f.registry.mods[1].id = 'alpha'; f.save();
    assert.throws(() => loadRegistry(f.root), /Duplicate/);
});
test('reject dependency cycle', t => {
    const f = fixture(t);
    f.registry.mods[0].depends_on = ['beta']; f.registry.mods[1].depends_on = ['alpha']; f.save();
    assert.throws(() => loadRegistry(f.root), /cycle/);
});
test('reject missing registry file', t => {
    const f = fixture(t);
    f.registry.mods[0].files.push('missing.txt'); f.save();
    assert.throws(() => loadRegistry(f.root));
});
test('reject unlisted runtime file', t => {
    const f = fixture(t);
    f.write('alpha/common/new.txt', 'value = 2');
    assert.throws(() => f.describe('alpha'), /allowlist/);
});
test('reject absolute launcher path', t => {
    const f = fixture(t);
    f.write('alpha.mod', 'name="alpha"\nversion="1.0.0"\npath="C:/mod/alpha"\n');
    assert.throws(() => f.describe('alpha'), /portable/);
});
test('reject mismatched descriptor', t => {
    const f = fixture(t);
    f.write('alpha/descriptor.mod', 'name="alpha"\nversion="1.0.1"\n');
    assert.throws(() => f.describe('alpha'), /mismatch/);
});
test('reject invalid semantic version', t => {
    const f = fixture(t);
    const descriptor = 'name="alpha"\nversion="nightly"\n';
    f.write('alpha/descriptor.mod', descriptor); f.write('alpha.mod', `${descriptor}path="mod/alpha"\n`);
    assert.throws(() => f.describe('alpha'), /version/);
});
test('content and build fingerprints distinguish test-only changes', t => {
    const f = fixture(t);
    const before = f.describe('alpha');
    f.write('verification/alpha.mjs', 'console.log("changed test");\n');
    const after = f.describe('alpha');
    assert.equal(before.contentFingerprint, after.contentFingerprint);
    assert.notEqual(before.fingerprint, after.fingerprint);
    assert.equal(releaseNeeded(after, before), false);
});
test('one mod change does not invalidate another mod', t => {
    const f = fixture(t);
    const a = f.describe('alpha'), b = f.describe('beta');
    f.write('alpha/common/test.txt', 'value = 2\r\n');
    assert.notEqual(a.fingerprint, f.describe('alpha').fingerprint);
    assert.equal(b.fingerprint, f.describe('beta').fingerprint);
});
test('editing another registry entry does not invalidate unchanged mod', t => {
    const f = fixture(t);
    const before = f.describe('alpha');
    f.registry.mods[1].name = 'New Beta';
    assert.equal(f.describe('alpha').fingerprint, before.fingerprint);
});
test('shared inputs invalidate builds without changing runtime content', t => {
    const f = fixture(t);
    const a = f.describe('alpha'), b = f.describe('beta');
    f.write('ci/package.sh', '# changed builder\n');
    assert.notEqual(a.fingerprint, f.describe('alpha').fingerprint);
    assert.notEqual(b.fingerprint, f.describe('beta').fingerprint);
    assert.equal(a.contentFingerprint, f.describe('alpha').contentFingerprint);
});
test('declared dependency changes invalidate dependent builds', t => {
    const f = fixture(t);
    f.registry.mods[0].depends_on = ['beta'];
    const before = f.describe('alpha');
    f.write('beta/common/test.txt', 'value = 5');
    assert.notEqual(before.fingerprint, f.describe('alpha').fingerprint);
});
test('path selection excludes docs and local sync scripts', t => {
    const f = fixture(t);
    assert.deepEqual(affectedMods(f.registry, ['README.md', 'Sync-ReduxTweak.ps1']), []);
    assert.deepEqual(affectedMods(f.registry, ['alpha/common/test.txt']).map(mod => mod.id), ['alpha']);
    assert.equal(affectedMods(f.registry, ['LICENSE']).length, 2);
    assert.equal(affectedMods(f.registry, ['ci/mods.json']).length, 2);
});
test('path selection propagates dependencies', t => {
    const f = fixture(t);
    f.registry.mods[0].depends_on = ['beta'];
    assert.equal(affectedMods(f.registry, ['beta.mod']).length, 2);
});
test('initial release allowed; runtime changes require a version bump', t => {
    const f = fixture(t);
    const before = f.describe('alpha');
    assert.equal(releaseNeeded(before, null), true);
    assert.equal(releaseNeeded(before, before), false);
    f.write('alpha/common/test.txt', 'value = 3');
    assert.throws(() => releaseNeeded(f.describe('alpha'), before), /increase version/);
    const descriptor = 'name="alpha"\nversion="1.0.1"\n';
    f.write('alpha/descriptor.mod', descriptor); f.write('alpha.mod', `${descriptor}path="mod/alpha"\n`);
    assert.equal(releaseNeeded(f.describe('alpha'), before), true);
});
test('numeric version ordering', () => {
    assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
    assert.equal(compareVersions('0.1.1', '0.2.0'), -1);
    assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});
test('nightly skips only exact successful unexpired input fingerprint', t => {
    const f = fixture(t), current = f.describe('alpha');
    const artifact = { name: `nightly-alpha-${current.fingerprint}`, expired: false, successful: true };
    assert.equal(nightlyNeeded(current, [artifact]), false);
    assert.equal(nightlyNeeded(current, [{ ...artifact, expired: true }]), true);
    assert.equal(nightlyNeeded(current, [{ ...artifact, successful: false }]), true);
    assert.equal(nightlyNeeded(current, []), true);
    f.write('alpha/common/test.txt', 'value = 4');
    assert.equal(nightlyNeeded(f.describe('alpha'), [artifact]), true);
});
test('real packager verifies allowlist and produces repeatable ZIP bytes', t => {
    const f = fixture(t);
    const plan = { ...f.describe('alpha'), root: f.root };
    const planPath = join(f.root, 'plan.json');
    writeFileSync(planPath, JSON.stringify(plan));
    const script = fileURLToPath(new URL('./package.sh', import.meta.url));
    for (const filename of ['one.zip', 'two.zip']) {
        const result = spawnSync('sh', [script, planPath, join(f.root, filename)], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /4 allowlisted entries/);
    }
    assert.deepEqual(readFileSync(join(f.root, 'one.zip')), readFileSync(join(f.root, 'two.zip')));
    f.write('alpha/common/test.txt', 'changed after planning');
    const result = spawnSync('sh', [script, planPath, join(f.root, 'bad.zip')], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Source changed/);
});

test('release lookup includes drafts even when tag endpoint does not expose them', () => {
    const draft = { id: 123, tag_name: 'alpha-v1.0.0', draft: true, target_commitish: 'commit' };
    assert.equal(findRelease([draft], 'alpha-v1.0.0'), draft);
    assert.equal(findRelease([draft], 'beta-v1.0.0'), null);
});
test('release lookup rejects ambiguous duplicate tags', () => {
    assert.throws(() => findRelease([{ tag_name: 'alpha-v1.0.0' }, { tag_name: 'alpha-v1.0.0' }], 'alpha-v1.0.0'), /Duplicate/);
});
