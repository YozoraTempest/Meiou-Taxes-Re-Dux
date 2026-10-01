import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { affectedMods, compareVersions, describeMod, findRelease, loadRegistry, nightlyNeeded, packageFiles, releaseNeeded, safePath, sha256 } from './lib.mjs';
import { publishNightly } from './nightly.mjs';

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
function nightlyFixture(t, existing = false) {
    const f = fixture(t);
    const current = f.describe('alpha');
    const sourceSha = 'a'.repeat(40);
    const repository = 'owner/mods';
    const endpoint = `repos/${repository}`;
    const tag = 'alpha-nightly';
    const metadata = { schema_version: 1, ...current, channel: 'nightly', sourceSha,
        builtAt: '2026-10-01T00:00:00.000Z', filename: 'alpha-nightly.zip', zipSha256: sha256('nightly package') };
    const metadataText = JSON.stringify(metadata, null, 2) + '\n';
    f.write('dist/alpha/alpha-nightly.zip', 'nightly package');
    f.write('dist/alpha/alpha-nightly.zip.sha256', `${metadata.zipSha256}  ${metadata.filename}\n`);
    f.write('dist/alpha/alpha-build-info.json', metadataText);
    const asset = name => ({ name, state: 'uploaded', digest: `sha256:${sha256(readFileSync(join(f.root, 'dist/alpha', name)))}` });
    const ready = { id: 1, tag_name: tag, draft: false, prerelease: true, immutable: false,
        assets: [metadata.filename, `${metadata.filename}.sha256`, 'alpha-build-info.json'].map(asset) };
    const state = { release: existing ? structuredClone(ready) : null, tagSha: existing ? 'b'.repeat(40) : null, calls: [] };
    const api = (path, optional) => {
        state.calls.push(['read', path]);
        if (path === `${endpoint}/releases?per_page=100`) return [state.release ? [structuredClone(state.release)] : []];
        if (path === `${endpoint}/releases/1`) return structuredClone(state.release);
        if (path === `${endpoint}/git/ref/tags/${tag}` && optional) return state.tagSha ? { object: { type: 'commit', sha: state.tagSha } } : null;
        if (path === `${endpoint}/commits/${tag}`) return { sha: state.tagSha };
        assert.fail(`Unexpected API call: ${path}`);
    };
    const command = (program, args) => {
        assert.equal(program, 'gh');
        state.calls.push(args);
        if (args[0] === 'api') {
            if (args[3] === `${endpoint}/releases`) {
                assert.equal(args[2], 'POST');
                assert.equal(state.release, null);
                assert.ok(args.includes(`tag_name=${tag}`) && args.includes(`target_commitish=${sourceSha}`));
                assert.ok(args.includes('draft=true') && args.includes('prerelease=true') && args.includes('make_latest=false'));
                state.release = { ...ready, draft: true, assets: [] };
                return JSON.stringify(state.release);
            }
            assert.equal(args[2], state.tagSha ? 'PATCH' : 'POST');
            assert.equal(args[3], state.tagSha ? `${endpoint}/git/refs/tags/${tag}` : `${endpoint}/git/refs`);
            if (state.tagSha) assert.ok(args.includes('force=true'));
            else assert.ok(args.includes(`ref=refs/tags/${tag}`));
            state.tagSha = args.find(arg => arg.startsWith('sha=')).slice(4);
            return;
        }
        assert.equal(args[0], 'release');
        assert.equal(args[2], tag);
        assert.equal(args[args.indexOf('--repo') + 1], repository);
        if (args[1] === 'upload') {
            assert.ok(args.includes('--clobber'));
            const paths = args.slice(3, args.indexOf('--repo'));
            if (state.failMetadata && paths.some(path => path.endsWith('alpha-build-info.json'))) throw new Error('Upload interrupted');
            for (const path of paths) {
                const name = path.split(/[\\/]/).at(-1);
                state.release.assets = state.release.assets.filter(item => item.name !== name);
                state.release.assets.push(asset(name));
            }
            return;
        }
        if (args[1] === 'edit') {
            assert.ok(args.includes('--prerelease') && args.includes('--latest=false'));
            state.release.prerelease = true;
            if (args.includes('--draft=false')) {
                assert.equal(nightlyNeeded(current, { ...state.release, draft: false }, metadataText, state.tagSha), false,
                    'A new nightly must have all verified assets before publication');
                state.release.draft = false;
            }
            if (args.includes('--notes-file')) state.release.body = readFileSync(args[args.indexOf('--notes-file') + 1], 'utf8');
            if (args.includes('--target')) state.release.target_commitish = args[args.indexOf('--target') + 1];
            return;
        }
        assert.fail(`Unexpected command: ${args.join(' ')}`);
    };
    const publish = () => publishNightly({ root: f.root, repository, current, sourceSha, api, command, summary: () => {} });
    return { ...f, current, sourceSha, metadata, metadataText, ready, state, publish };
}

test('nightly skips an intact published release even when Actions artifacts have expired', t => {
    const f = nightlyFixture(t);
    assert.equal(nightlyNeeded(f.current, f.ready, f.metadataText, f.sourceSha), false);
    f.write('verification/alpha.mjs', 'changed validation');
    assert.equal(nightlyNeeded(f.describe('alpha'), f.ready, f.metadataText, f.sourceSha), true);
});

test('nightly retries absent, draft, wrong-channel, stale, or damaged releases', t => {
    const f = nightlyFixture(t);
    for (const release of [null, { ...f.ready, draft: true }, { ...f.ready, prerelease: false },
        { ...f.ready, tag_name: 'alpha-v1.0.0' }, { ...f.ready, assets: f.ready.assets.slice(0, 2) },
        { ...f.ready, assets: f.ready.assets.map(asset => ({ ...asset, digest: 'sha256:wrong' })) },
        { ...f.ready, assets: f.ready.assets.map(asset => ({ ...asset, state: 'starter' })) }]) {
        assert.equal(nightlyNeeded(f.current, release, f.metadataText, f.sourceSha), true);
    }
    assert.equal(nightlyNeeded(f.current, f.ready, f.metadataText, 'b'.repeat(40)), true);
    assert.equal(nightlyNeeded(f.current, f.ready, f.metadataText, null), true);
    for (const text of [null, '{invalid', 'null', JSON.stringify({ ...f.metadata, channel: 'release' }),
        JSON.stringify({ ...f.metadata, fingerprint: 'stale' }), JSON.stringify({ ...f.metadata, zipSha256: 'wrong' })]) {
        assert.equal(nightlyNeeded(f.current, f.ready, text, f.sourceSha), true);
    }
});

test('nightly publisher creates one prerelease with verified assets and a matching tag', t => {
    const f = nightlyFixture(t);
    f.publish();
    assert.equal(nightlyNeeded(f.current, f.state.release, f.metadataText, f.state.tagSha), false);
    assert.match(f.state.release.body, /Rolling development build/);
    assert.equal(f.state.release.target_commitish, f.sourceSha);
    assert.equal(f.state.calls.filter(args => args[0] === 'api' && args[3] === 'repos/owner/mods/releases').length, 1);
    assert.equal(f.state.calls.filter(args => args[0] === 'read' && args[1].includes('releases?')).length, 1,
        'Use the creation response without relying on a freshly updated release list');
});

test('nightly publisher reuses release ID, moves the tag, and overwrites fixed asset names', t => {
    const f = nightlyFixture(t, true);
    f.state.release.assets = f.state.release.assets.map(asset => ({ ...asset, digest: 'sha256:old' }));
    f.publish();
    assert.equal(f.state.release.id, 1);
    assert.equal(f.state.tagSha, f.sourceSha);
    assert.equal(f.state.calls.filter(args => args[0] === 'api' && args[3] === 'repos/owner/mods/releases').length, 0);
    assert.equal(f.state.calls.filter(args => args[2] === 'PATCH').length, 1);
    const uploads = f.state.calls.filter(args => args[1] === 'upload');
    assert.equal(uploads.length, 2);
    assert.ok(uploads[0][3].endsWith('alpha-nightly.zip') && uploads[0][4].endsWith('.zip.sha256'));
    assert.ok(uploads[1][3].endsWith('alpha-build-info.json'));
    assert.equal(nightlyNeeded(f.current, f.state.release, f.metadataText, f.state.tagSha), false);
});

test('interrupted nightly update remains eligible and can be retried', t => {
    const f = nightlyFixture(t, true);
    f.state.release.assets = f.state.release.assets.map(asset => ({ ...asset, digest: 'sha256:old' }));
    f.state.failMetadata = true;
    assert.throws(f.publish, /Upload interrupted/);
    assert.equal(nightlyNeeded(f.current, f.state.release, f.metadataText, f.state.tagSha), true);
    f.state.failMetadata = false;
    f.publish();
    assert.equal(f.state.release.id, 1);
    assert.equal(nightlyNeeded(f.current, f.state.release, f.metadataText, f.state.tagSha), false);
});

test('nightly publisher resumes a draft left by an interrupted first publication', t => {
    const f = nightlyFixture(t);
    f.state.failMetadata = true;
    assert.throws(f.publish, /Upload interrupted/);
    assert.equal(f.state.release.draft, true);
    f.state.failMetadata = false;
    f.publish();
    assert.equal(f.state.release.draft, false);
    assert.equal(f.state.calls.filter(args => args[0] === 'api' && args[3] === 'repos/owner/mods/releases').length, 1);
});

test('nightly publisher rejects tampered artifacts or a different checkout before remote changes', t => {
    const f = nightlyFixture(t);
    f.write('dist/alpha/alpha-nightly.zip', 'damaged package');
    assert.throws(f.publish);
    assert.deepEqual(f.state.calls, []);
    f.write('dist/alpha/alpha-nightly.zip', 'nightly package');
    f.write('dist/alpha/alpha-build-info.json', JSON.stringify({ ...f.metadata, sourceSha: 'b'.repeat(40) }));
    assert.throws(f.publish);
    assert.deepEqual(f.state.calls, []);
});

test('nightly publisher protects formal and immutable releases', t => {
    const f = nightlyFixture(t, true);
    f.state.release.prerelease = false;
    assert.throws(f.publish, /formal release/);
    f.state.release.prerelease = true;
    f.state.release.immutable = true;
    assert.throws(f.publish, /mutable/);
    assert.ok(f.state.calls.every(args => args[0] === 'read'));
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
