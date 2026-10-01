import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRelease, nightlyNeeded, sha256 } from './lib.mjs';

export function publishNightly({ root, repository, current, sourceSha, api, command, summary }) {
    assert.ok(repository, 'GITHUB_REPOSITORY is required');
    const { id } = current;
    const output = join(root, 'dist', id);
    const metadataName = `${id}-build-info.json`;
    const metadataText = readFileSync(join(output, metadataName), 'utf8');
    const metadata = JSON.parse(metadataText);
    assert.equal(metadata.schema_version, 1);
    assert.equal(metadata.id, id);
    assert.equal(metadata.channel, 'nightly');
    assert.equal(metadata.version, current.version);
    assert.equal(metadata.sourceSha, sourceSha);
    assert.equal(metadata.fingerprint, current.fingerprint);
    assert.equal(metadata.contentFingerprint, current.contentFingerprint);
    assert.equal(metadata.filename, `${id}-nightly.zip`);
    assert.equal(sha256(readFileSync(join(output, metadata.filename))), metadata.zipSha256);
    assert.equal(readFileSync(join(output, `${metadata.filename}.sha256`), 'utf8'), `${metadata.zipSha256}  ${metadata.filename}\n`);

    const tag = `${id}-nightly`;
    const endpoint = `repos/${repository}`;
    const listReleases = () => api(`${endpoint}/releases?per_page=100`, false, true).flat();
    let release = findRelease(listReleases(), tag);
    if (release) {
        assert.ok(release.draft || release.prerelease, 'Refusing to overwrite a formal release');
        assert.ok(!release.immutable, 'Rolling nightly release must be mutable');
    }
    const title = `${current.name} Nightly`;
    const notes = join(output, 'nightly-notes.md');
    writeFileSync(notes, `## ${title}\n\nRolling development build from \`develop\`; assets are replaced after successful builds.\n\n` +
        `Version: ${current.version}\n\nCommit: ${sourceSha}\n\nBuilt at: ${metadata.builtAt}\n\n` +
        `Download \`${metadata.filename}\` and extract it into the EU4 mod directory.\n\n` +
        `SHA256: \`${metadata.zipSha256}\`\n\nThis package contains ${current.files.length} runtime/license files.\n`);
    if (!release) {
        command('gh', ['release', 'create', tag, '--repo', repository, '--target', sourceSha,
            '--draft', '--prerelease', '--latest=false', '--title', title, '--notes-file', notes]);
        release = findRelease(listReleases(), tag);
        assert.ok(release?.draft, 'Expected a new nightly draft');
    }
    const packageNames = [metadata.filename, `${metadata.filename}.sha256`];
    command('gh', ['release', 'upload', tag, ...packageNames.map(name => join(output, name)), '--repo', repository, '--clobber']);
    const uploaded = api(`${endpoint}/releases/${release.id}`);
    for (const name of packageNames) assert.ok(uploaded.assets.some(asset => asset.name === name &&
        asset.state === 'uploaded' && asset.digest === `sha256:${sha256(readFileSync(join(output, name)))}`), `Uploaded asset mismatch: ${name}`);

    const ref = api(`${endpoint}/git/ref/tags/${tag}`, true);
    if (ref) {
        if (ref.object.type !== 'commit' || ref.object.sha !== sourceSha) command('gh',
            ['api', '--method', 'PATCH', `${endpoint}/git/refs/tags/${tag}`, '-f', `sha=${sourceSha}`, '-F', 'force=true']);
    } else command('gh', ['api', '--method', 'POST', `${endpoint}/git/refs`, '-f', `ref=refs/tags/${tag}`, '-f', `sha=${sourceSha}`]);
    command('gh', ['release', 'edit', tag, '--repo', repository, '--target', sourceSha,
        '--prerelease', '--latest=false', '--title', title, '--notes-file', notes]);
    // Upload the build record last so interrupted updates remain eligible for retry.
    command('gh', ['release', 'upload', tag, join(output, metadataName), '--repo', repository, '--clobber']);
    const complete = api(`${endpoint}/releases/${release.id}`);
    const tagSha = api(`${endpoint}/commits/${tag}`).sha;
    assert.equal(nightlyNeeded(current, { ...complete, draft: false }, metadataText, tagSha), false, 'Nightly assets or tag failed verification');
    if (complete.draft) command('gh', ['release', 'edit', tag, '--repo', repository, '--draft=false', '--prerelease', '--latest=false']);
    assert.equal(nightlyNeeded(current, api(`${endpoint}/releases/${release.id}`), metadataText, tagSha), false);
    summary(`PASS: NIGHTLY https://github.com/${repository}/releases/tag/${tag}`);
}
