import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { dataFolderIn, hookCommand, hookInstalled, installHook, isEphemeral, plistFor, removeHook, systemdUnits, windowsTaskScript } from '../src/setup.ts';

const runner = { node: 'C:\\Program Files\\nodejs\\node.exe', script: "C:\\Users\\o'brien\\cc-cost\\dist\\cli.js" };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cost-setup-'));

test('hook: added next to existing hooks, idempotent, removed cleanly', () => {
    const file = path.join(tmp(), 'settings.json');
    const other = { hooks: [{ type: 'command', command: 'echo bye' }] };
    fs.writeFileSync(file, JSON.stringify({ model: 'opus', hooks: { SessionEnd: [other] } }));

    assert.equal(installHook(runner, file), true);
    assert.equal(installHook(runner, file), false, 'second install changes nothing');
    assert.ok(hookInstalled(file));
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(s.model, 'opus');
    assert.equal(s.hooks.SessionEnd.length, 2);
    assert.ok(fs.existsSync(file + '.cc-cost.bak'), 'the original file is backed up');

    assert.equal(removeHook(file), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { model: 'opus', hooks: { SessionEnd: [other] } });
    assert.equal(removeHook(file), false);
});

test('hook: a moved install updates the command instead of adding a second hook', () => {
    const file = path.join(tmp(), 'settings.json');
    installHook(runner, file);
    installHook({ ...runner, script: 'D:\\tools\\cc-cost\\dist\\cli.js' }, file);
    const hooks = JSON.parse(fs.readFileSync(file, 'utf8')).hooks.SessionEnd;
    assert.equal(hooks.length, 1);
    assert.match(hooks[0].hooks[0].command, /D:\/tools\/cc-cost/);
});

test('hook command: quoted, forward slashes', () => {
    assert.equal(hookCommand(runner), `"C:/Program Files/nodejs/node.exe" "C:/Users/o'brien/cc-cost/dist/cli.js" sync --quiet`);
});

test('scheduler definitions carry the runner and escape it', () => {
    // the path sits in a single-quoted literal nested inside another, so its quote is doubled twice
    assert.ok(windowsTaskScript(runner).includes(`''C:\\Users\\o''''brien\\cc-cost\\dist\\cli.js''`));
    const plist = plistFor({ node: '/usr/local/bin/node', script: '/a&b/cli.js' });
    assert.match(plist, /<string>\/a&#38;b\/cli\.js<\/string>/);
    assert.match(plist, /<key>Hour<\/key>\s*<integer>10<\/integer>/);
    const units = systemdUnits({ node: '/usr/bin/node', script: '/opt/cc-cost/cli.js' });
    assert.match(units.service, /ExecStart="\/usr\/bin\/node" "\/opt\/cc-cost\/cli\.js" sync --quiet/);
    assert.match(units.timer, /Persistent=true/);
});

test('data folder: reuses an existing cc-cost or claude-cost folder', () => {
    const root = tmp();
    assert.equal(dataFolderIn(root), path.join(root, 'cc-cost'));
    fs.mkdirSync(path.join(root, 'claude-cost'));
    assert.equal(dataFolderIn(root), path.join(root, 'claude-cost'));
});

test('temporary runners are recognized: npx, yarn dlx, pnpm dlx', () => {
    const at = (script: string) => isEphemeral({ node: 'node', script });
    assert.ok(at(String.raw`C:\Users\me\AppData\Local\npm-cache\_npx\1a2b\node_modules\@ugurcandede\cc-cost\dist\cli.js`));
    assert.ok(at('/tmp/xfs-4f2a1c/dlx-12345/node_modules/@ugurcandede/cc-cost/dist/cli.js'));
    assert.ok(at('/home/me/.cache/pnpm/dlx/abc123/node_modules/@ugurcandede/cc-cost/dist/cli.js'));
    assert.ok(!at('/usr/local/lib/node_modules/@ugurcandede/cc-cost/dist/cli.js'));
    assert.ok(!at(String.raw`C:\Users\me\AppData\Roaming\npm\node_modules\@ugurcandede\cc-cost\dist\cli.js`));
});
