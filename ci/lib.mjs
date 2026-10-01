import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const unique = values => new Set(values).size === values.length;

export function safePath(value) {
    assert.equal(typeof value, 'string', 'Path must be a string');
    assert.ok(value && !isAbsolute(value) && !value.includes('\\') && !value.includes(':') &&
        value.split('/').every(part => part && part !== '.' && part !== '..'), `Invalid relative path: ${value}`);
    return value;
}

export function sourceFile(root, relative) {
    safePath(relative);
    let current = root;
    for (const part of relative.split('/')) {
        current = join(current, part);
        assert.ok(!lstatSync(current).isSymbolicLink(), `Symlink is not a build input: ${relative}`);
    }
    assert.ok(lstatSync(current).isFile(), `Build input is not a file: ${relative}`);
    return current;
}

export function loadRegistry(root) {
    const registry = JSON.parse(readFileSync(join(root, 'ci/mods.json'), 'utf8'));
    assert.equal(registry.schema_version, 1);
    assert.ok(Array.isArray(registry.mods) && registry.mods.length > 0);
    assert.ok(Array.isArray(registry.shared_inputs));
    for (const input of registry.shared_inputs) sourceFile(root, input);
    assert.ok(unique(registry.mods.map(mod => mod.id)), 'Duplicate mod ID');
    for (const mod of registry.mods) {
        assert.match(mod.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
        assert.ok(typeof mod.name === 'string' && mod.name.trim());
        assert.ok(Array.isArray(mod.files) && mod.files.includes('descriptor.mod') && unique(mod.files));
        for (const file of mod.files) sourceFile(root, `${mod.id}/${safePath(file)}`);
        for (const file of mod.test_inputs) sourceFile(root, file);
        assert.ok(Array.isArray(mod.tests) && mod.tests.length > 0);
        for (const command of mod.tests) assert.ok(Array.isArray(command) && command.length > 0 &&
            command.every(arg => typeof arg === 'string' && arg.length > 0));
        assert.ok(Array.isArray(mod.depends_on) && unique(mod.depends_on));
        for (const id of mod.depends_on) assert.ok(registry.mods.some(item => item.id === id), `Unknown dependency: ${id}`);
        const visit = (id, seen) => {
            assert.ok(!seen.has(id), `Dependency cycle: ${id}`);
            for (const dependency of registry.mods.find(item => item.id === id).depends_on) visit(dependency, new Set([...seen, id]));
        };
        visit(mod.id, new Set());
    }
    return registry;
}

export function packageFiles(root, mod) {
    const entries = [{ source: `${mod.id}.mod`, archive: `${mod.id}.mod` },
        ...mod.files.map(file => ({ source: `${mod.id}/${file}`, archive: `${mod.id}/${file}` })),
        { source: 'LICENSE', archive: `${mod.id}/LICENSE` }];
    for (const entry of entries) sourceFile(root, entry.source);
    const walk = (directory, prefix = '') => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const relative = `${prefix}${entry.name}`;
        assert.ok(!entry.isSymbolicLink(), `Mod symlink: ${relative}`);
        return entry.isDirectory() ? walk(join(directory, entry.name), `${relative}/`) : [relative];
    });
    assert.deepEqual(walk(join(root, mod.id)).sort(), [...mod.files].sort(), 'Mod file list differs from the package allowlist');
    const outer = readFileSync(join(root, `${mod.id}.mod`), 'utf8').replace(/\r\n/g, '\n');
    const inner = readFileSync(join(root, mod.id, 'descriptor.mod'), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(outer.replace(/^path="[^"\n]*"\n?/m, ''), inner, 'Descriptor mismatch');
    assert.ok(outer.includes(`path="mod/${mod.id}"\n`), 'Launcher path is not portable');
    assert.ok(!/^replace_path=/m.test(outer), 'Whole-directory replacement is not supported');
    return entries;
}

export function describeMod(root, registry, mod) {
    const files = packageFiles(root, mod);
    const descriptor = readFileSync(join(root, mod.id, 'descriptor.mod'), 'utf8');
    const version = descriptor.match(/^version="((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))"\r?$/m)?.[1];
    assert.ok(version, `Invalid release version: ${mod.id}`);
    const records = files.map(entry => ({ ...entry, sha256: sha256(readFileSync(join(root, entry.source))) }));
    const contentFingerprint = sha256(JSON.stringify(records.map(({ archive, sha256: hash }) => [archive, hash])));
    const inputs = [...registry.shared_inputs, ...mod.test_inputs].sort().map(path => [path, sha256(readFileSync(sourceFile(root, path)))]);
    const dependencies = mod.depends_on.map(id => describeMod(root, registry,
        registry.mods.find(item => item.id === id)).fingerprint);
    const fingerprint = sha256(JSON.stringify({ mod, contentFingerprint, inputs, dependencies }));
    return { id: mod.id, name: mod.name, version, fingerprint, contentFingerprint, files: records };
}

export function affectedMods(registry, paths) {
    const selected = new Set();
    for (const mod of registry.mods) {
        if (paths.some(path => path === 'ci/mods.json' || path === 'LICENSE' || registry.shared_inputs.includes(path) ||
            path === `${mod.id}.mod` || path.startsWith(`${mod.id}/`) || mod.test_inputs.includes(path))) selected.add(mod.id);
    }
    let size;
    do {
        size = selected.size;
        for (const mod of registry.mods) if (mod.depends_on.some(id => selected.has(id))) selected.add(mod.id);
    } while (selected.size !== size);
    return registry.mods.filter(mod => selected.has(mod.id));
}

export function compareVersions(left, right) {
    const a = left.split('.').map(Number), b = right.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
    return 0;
}

export function releaseNeeded(current, previous) {
    if (!previous) return true;
    if (current.contentFingerprint === previous.contentFingerprint) return false;
    assert.ok(compareVersions(current.version, previous.version) > 0,
        `${current.id}: package content changed; increase version above ${previous.version}`);
    return true;
}

export function nightlyNeeded(current, release, metadataText, tagSha) {
    if (!release || release.draft || !release.prerelease || release.tag_name !== `${current.id}-nightly`) return true;
    let metadata;
    try { metadata = JSON.parse(metadataText); } catch { return true; }
    const filename = `${current.id}-nightly.zip`;
    if (!metadata || metadata.schema_version !== 1 || metadata.id !== current.id || metadata.channel !== 'nightly' ||
        metadata.version !== current.version || metadata.fingerprint !== current.fingerprint ||
        metadata.contentFingerprint !== current.contentFingerprint || metadata.filename !== filename ||
        !/^[a-f0-9]{40}$/.test(metadata.sourceSha) || metadata.sourceSha !== tagSha ||
        !/^[a-f0-9]{64}$/.test(metadata.zipSha256)) return true;
    const digests = [[filename, metadata.zipSha256],
        [`${filename}.sha256`, sha256(`${metadata.zipSha256}  ${filename}\n`)],
        [`${current.id}-build-info.json`, sha256(metadataText)]];
    return digests.some(([name, digest]) => !release.assets?.some(asset =>
        asset.name === name && asset.state === 'uploaded' && asset.digest === `sha256:${digest}`));
}

export function findRelease(releases, tag) {
    const matches = releases.filter(release => release.tag_name === tag);
    assert.ok(matches.length <= 1, `Duplicate release tag: ${tag}`);
    return matches[0] ?? null;
}
