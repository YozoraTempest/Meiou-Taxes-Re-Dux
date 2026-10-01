import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, packageFiles } from './lib.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [directory, ...ids] = process.argv.slice(2);
assert.ok(directory, 'Usage: sh Sync-ReduxMods.sh MOD_DIRECTORY [MOD_ID ...]');
const destination = resolve(directory);
assert.ok(destination !== resolve(root) && (!destination.startsWith(resolve(root) + sep) ||
    destination.startsWith(join(root, 'dist') + sep)), 'Install target must not overwrite repository source');
if (existsSync(destination)) assert.ok(lstatSync(destination).isDirectory() && !lstatSync(destination).isSymbolicLink(),
    'Install directory must be a real directory');
const registry = loadRegistry(root);
const requested = ids.length ? ids : registry.mods.map(mod => mod.id);
assert.equal(new Set(requested).size, requested.length, 'Duplicate mod ID');
const plans = requested.map(id => {
    const mod = registry.mods.find(mod => mod.id === id);
    assert.ok(mod, `Unknown mod ID: ${id}`);
    const files = packageFiles(root, mod).map(entry => ({ relative: entry.archive,
        content: readFileSync(join(root, entry.source)) }));
    const launcher = files.find(file => file.relative === `${id}.mod`);
    const path = join(destination, id).replaceAll('\\', '/');
    assert.ok(!path.includes('"'), 'Install path contains a quote');
    launcher.content = Buffer.from(launcher.content.toString('utf8')
        .replace(/^path="[^"\r\n]*"/m, () => `path="${path}"`));
    return { mod, files };
});
const retiredTweak = requested.some(id => id === 'redux-tweak' || id === 'redux-subject') ? [
    'common/custom_gui/ReduxSubjectSelection.txt',
    'common/on_actions/00_on_actions.txt',
    'common/scripted_effects/ReduxSubjectSelection.txt',
    'common/scripted_effects/SYS-Construct.txt',
    'common/scripted_effects/SYS-Prov.txt',
    'common/scripted_triggers/ReduxSubjectSelection.txt',
    'customizable_localization/ReduxSubjectSelection.txt',
    'decisions/ReduxSubjectSelection.txt',
    'interface/provinceview.gui',
    'localisation/redux-tweak_l_english.yml',
].map(path => `redux-tweak/${path}`) : [];
const retiredUi = requested.includes('redux-subject') ? [
    'redux-ui.mod',
    'redux-ui/descriptor.mod',
    'redux-ui/LICENSE',
    'redux-ui/interface/provinceview.gui',
    'redux-ui/common/custom_gui/ReduxProvinceSelection.txt',
    'redux-ui/common/scripted_effects/ReduxProvinceSelection.txt',
    'redux-ui/common/scripted_effects/SYS-Construct.txt',
    'redux-ui/common/scripted_triggers/ReduxProvinceSelection.txt',
    'redux-ui/customizable_localization/ReduxSubjectSelection.txt',
    'redux-ui/decisions/ReduxSubjectSelection.txt',
    'redux-ui/localisation/redux-ui_l_english.yml',
] : [];
const retired = [...retiredTweak, ...retiredUi];

for (const relative of [...plans.flatMap(plan => plan.files.map(file => file.relative)), ...retired]) {
    let path = destination;
    for (const part of relative.split('/')) {
        path = join(path, part);
        if (existsSync(path)) assert.ok(!lstatSync(path).isSymbolicLink(), `Install symlink: ${path}`);
    }
    if (existsSync(path)) assert.ok(lstatSync(path).isFile(), `Install path is not a file: ${path}`);
}
for (const plan of plans) for (const file of plan.files) {
    const path = join(destination, file.relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.content);
}
for (const relative of retired) {
    const path = join(destination, relative);
    if (existsSync(path)) unlinkSync(path);
}
for (const plan of plans) console.log(`SYNC PASS: ${plan.mod.name}; ${plan.files.length} runtime/license files`);
