import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { affectedMods, compareVersions, describeMod, loadRegistry, nightlyNeeded, releaseNeeded, sha256 } from './lib.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const registry = loadRegistry(root);
const repository = process.env.GITHUB_REPOSITORY;
const command = (program, args, options = {}) => {
    const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
    if (result.error || result.status !== 0) throw new Error(`${program} ${args.join(' ')} failed: ${result.error ?? result.stderr ?? result.status}`);
    return result.stdout?.trim();
};
const api = (endpoint, optional = false, paginate = false) => {
    assert.ok(repository, 'GITHUB_REPOSITORY is required');
    const result = spawnSync('gh', ['api', endpoint, ...(paginate ? ['--paginate', '--slurp'] : [])],
        { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (optional && result.status !== 0 && result.stderr?.includes('(HTTP 404)')) return null;
    if (result.error || result.status !== 0) throw new Error(`GitHub API ${endpoint}: ${result.error ?? result.stderr}`);
    return JSON.parse(result.stdout);
};
const summary = text => {
    console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
};
const getMod = id => {
    const mod = registry.mods.find(item => item.id === id);
    assert.ok(mod, `Unknown mod: ${id}`);
    return mod;
};
const sourceSha = () => command('git', ['rev-parse', 'HEAD']);

function metadataFor(release, id) {
    const directory = mkdtempSync(join(tmpdir(), 'mod-release-'));
    try {
        command('gh', ['release', 'download', release.tag_name, '--repo', repository,
            '--pattern', `${id}-build-info.json`, '--dir', directory]);
        const metadata = JSON.parse(readFileSync(join(directory, `${id}-build-info.json`), 'utf8'));
        assert.equal(metadata.schema_version, 1);
        assert.equal(metadata.id, id);
        assert.equal(release.tag_name, `${id}-v${metadata.version}`);
        assert.match(metadata.contentFingerprint, /^[a-f0-9]{64}$/);
        return metadata;
    } finally { rmSync(directory, { recursive: true, force: true }); }
}

function previousRelease(mod, releases) {
    const prefix = `${mod.id}-v`;
    const candidates = releases.filter(release => !release.draft && !release.prerelease &&
        release.tag_name.startsWith(prefix) && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(release.tag_name.slice(prefix.length)));
    candidates.sort((a, b) => compareVersions(b.tag_name.slice(prefix.length), a.tag_name.slice(prefix.length)));
    return candidates.length ? metadataFor(candidates[0], mod.id) : null;
}

function plan(channel) {
    let selected;
    let validation;
    if (channel === 'nightly') {
        const jobCache = new Map();
        selected = registry.mods.filter(mod => {
            const current = describeMod(root, registry, mod);
            const name = `nightly-${mod.id}-${current.fingerprint}`;
            const pages = api(`repos/${repository}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`, false, true);
            const artifacts = pages.flatMap(page => page.artifacts).filter(artifact => !artifact.expired);
            for (const artifact of artifacts) {
                const runId = artifact.workflow_run?.id;
                if (!runId) continue;
                if (!jobCache.has(runId)) jobCache.set(runId, api(`repos/${repository}/actions/runs/${runId}/jobs?per_page=100`, false, true)
                    .flatMap(page => page.jobs));
                artifact.successful = jobCache.get(runId).some(job => job.name === `Nightly / ${mod.id}` && job.conclusion === 'success');
            }
            const needed = nightlyNeeded(current, artifacts);
            if (!needed) {
                const artifact = artifacts.find(item => item.successful);
                summary(`- ${mod.id}: unchanged; [existing nightly](https://github.com/${repository}/actions/runs/${artifact.workflow_run.id}/artifacts/${artifact.id})`);
            }
            return needed;
        });
    } else {
        assert.equal(channel, 'release');
        const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
        assert.equal(event.pull_request.base.ref, 'main');
        assert.equal(event.pull_request.head.ref, 'develop');
        assert.equal(event.pull_request.head.repo.full_name, repository);
        const paths = api(`repos/${repository}/pulls/${event.number}/files?per_page=100`, false, true)
            .flatMap(page => page).flatMap(file => [file.filename, ...(file.previous_filename ? [file.previous_filename] : [])]);
        const releases = api(`repos/${repository}/releases?per_page=100`, false, true).flat();
        validation = affectedMods(registry, paths);
        selected = validation.filter(mod => releaseNeeded(describeMod(root, registry, mod), previousRelease(mod, releases)));
    }
    const matrix = { include: selected.map(mod => {
        const { id, version, fingerprint, contentFingerprint } = describeMod(root, registry, mod);
        return { id, version, fingerprint, contentFingerprint };
    }) };
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
        `matrix=${JSON.stringify(matrix)}\nhas_mods=${selected.length > 0}\nsource_sha=${sourceSha()}\n` +
        `verify_matrix=${JSON.stringify({ include: (validation ?? selected).map(mod => ({ id: mod.id })) })}\nhas_verify=${(validation ?? selected).length > 0}\n`);
    summary(`Selected ${selected.length} mod(s) for ${channel}: ${selected.map(mod => mod.id).join(', ') || 'none'}`);
    console.log(JSON.stringify(matrix));
}

function verify(id) {
    const mod = getMod(id);
    const before = describeMod(root, registry, mod);
    for (const [program, ...args] of mod.tests) command(program, args, { stdio: 'inherit' });
    assert.equal(describeMod(root, registry, mod).fingerprint, before.fingerprint, 'Tests changed build inputs');
    return before;
}

function build(channel, id, outputDirectory) {
    assert.ok(['nightly', 'release'].includes(channel));
    const description = verify(id);
    const output = resolve(outputDirectory ?? join(root, 'dist', id));
    mkdirSync(output, { recursive: true });
    const filename = channel === 'nightly' ? `${id}-nightly.zip` : `${id}-${description.version}.zip`;
    const archive = join(output, filename);
    const directory = mkdtempSync(join(tmpdir(), 'mod-package-'));
    try {
        const planPath = join(directory, 'plan.json');
        writeFileSync(planPath, JSON.stringify({ ...description, root }));
        command('sh', [join(root, 'ci/package.sh'), planPath, archive], { stdio: 'inherit' });
    } finally { rmSync(directory, { recursive: true, force: true }); }
    const digest = sha256(readFileSync(archive));
    writeFileSync(`${archive}.sha256`, `${digest}  ${filename}\n`);
    writeFileSync(join(output, `${id}-build-info.json`), JSON.stringify({ schema_version: 1, ...description,
        channel, sourceSha: sourceSha(), builtAt: new Date().toISOString(), filename, zipSha256: digest }, null, 2) + '\n');
    summary(`PASS: ${channel.toUpperCase()} ${id}; version=${description.version}; files=${description.files.length}; SHA256=${digest}`);
}

function publish(id) {
    const output = join(root, 'dist', id);
    const metadata = JSON.parse(readFileSync(join(output, `${id}-build-info.json`), 'utf8'));
    const current = describeMod(root, registry, getMod(id));
    assert.equal(metadata.channel, 'release');
    assert.equal(metadata.sourceSha, sourceSha());
    assert.equal(metadata.fingerprint, current.fingerprint);
    assert.equal(metadata.filename, `${id}-${current.version}.zip`);
    assert.equal(sha256(readFileSync(join(output, metadata.filename))), metadata.zipSha256);
    assert.equal(readFileSync(join(output, `${metadata.filename}.sha256`), 'utf8'), `${metadata.zipSha256}  ${metadata.filename}\n`);
    const tag = `${id}-v${current.version}`;
    const endpoint = `repos/${repository}/releases/tags/${tag}`;
    const existing = api(endpoint, true);
    if (existing) {
        assert.equal(api(`repos/${repository}/commits/${tag}`).sha, metadata.sourceSha, 'Existing release tag points to another commit');
        if (!existing.draft) {
            const previous = metadataFor(existing, id);
            assert.equal(previous.contentFingerprint, metadata.contentFingerprint);
            assert.equal(previous.zipSha256, metadata.zipSha256);
            for (const name of [metadata.filename, `${metadata.filename}.sha256`, `${id}-build-info.json`]) {
                assert.ok(existing.assets.some(asset => asset.name === name), `Published release asset missing: ${name}`);
            }
            summary(`PASS: RELEASE ${tag} already published and verified`);
            return;
        }
    }
    const assets = [metadata.filename, `${metadata.filename}.sha256`, `${id}-build-info.json`].map(name => join(output, name));
    const notes = join(output, 'release-notes.md');
    writeFileSync(notes, `## ${current.name} ${current.version}\n\nCommit: ${metadata.sourceSha}\n\n` +
        `Download \`${metadata.filename}\` and extract it into the EU4 mod directory.\n\n` +
        `SHA256: \`${metadata.zipSha256}\`\n\nThis package contains ${current.files.length} runtime/license files.\n`);
    if (!existing) command('gh', ['release', 'create', tag, '--repo', repository, '--target', metadata.sourceSha,
        '--draft', '--title', `${current.name} ${current.version}`, '--notes-file', notes]);
    command('gh', ['release', 'upload', tag, ...assets, '--repo', repository, '--clobber']);
    const draft = api(endpoint);
    for (const asset of assets) assert.ok(draft.assets.some(item => item.name === asset.split(/[\\/]/).at(-1)));
    command('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest=false']);
    summary(`PASS: RELEASE https://github.com/${repository}/releases/tag/${tag}`);
}

try {
    const [action, ...args] = process.argv.slice(2);
    if (action === 'plan') plan(...args);
    else if (action === 'verify') verify(...args);
    else if (action === 'build') build(...args);
    else if (action === 'publish') publish(...args);
    else if (action === 'describe') console.log(JSON.stringify({ ...describeMod(root, registry, getMod(args[0])), root }));
    else throw new Error('Usage: node ci/run.mjs plan CHANNEL | verify MOD | build CHANNEL MOD [OUTPUT] | publish MOD | describe MOD');
} catch (error) {
    console.error(error.stack);
    process.exitCode = 1;
}
