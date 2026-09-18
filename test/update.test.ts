import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from './tmp.ts';
import { installMethod, isNewer, latestVersion } from '../src/update.ts';

test('version comparison', () => {
    assert.ok(isNewer('0.1.1', '0.1.0'));
    assert.ok(isNewer('0.2.0', '0.1.9'));
    assert.ok(isNewer('1.0.0', '0.9.9'));
    assert.ok(isNewer('0.10.0', '0.9.0'), 'numeric, not string, comparison');
    assert.ok(!isNewer('0.1.0', '0.1.0'));
    assert.ok(!isNewer('0.1.0', '0.1.1'));
    assert.ok(!isNewer('0.2.0-beta.1', '0.2.0'), 'a pre-release is not newer than its release');
    assert.ok(isNewer('0.2.0', '0.2.0-beta.1'));
});

test('install method from the script path', () => {
    const pkg = ['node_modules', '@ugurcandede', 'cc-cost', 'dist', 'cli.js'];
    const win = (...parts: string[]) => [...parts, ...pkg].join('\\');
    assert.equal(installMethod(win('C:', 'Users', 'me', 'AppData', 'Local', 'nvm', 'v25.2.1')), 'npm');
    assert.equal(installMethod('/usr/local/lib/' + pkg.join('/')), 'npm');
    assert.equal(installMethod('/Users/me/.config/yarn/global/' + pkg.join('/')), 'yarn');
    assert.equal(installMethod(win('C:', 'Users', 'me', 'AppData', 'Local', 'Yarn', 'Data', 'global')), 'yarn');
    assert.equal(installMethod('/Users/me/Library/pnpm/global/5/' + pkg.join('/')), 'pnpm');
    assert.equal(installMethod('/tmp/xfs-1a2b/dlx-4242/' + pkg.join('/')), 'ephemeral');
    assert.equal(installMethod('/home/me/src/cc-cost/dist/cli.js'), 'unknown', 'a git checkout');
});

test('latest version comes from a fresh cache without asking the registry', async () => {
    const cache = path.join(tempDir('cc-cost-update-'), 'update-check.json');
    fs.writeFileSync(cache, JSON.stringify({ checked: new Date().toISOString(), latest: '9.9.9' }));
    assert.equal(await latestVersion('@ugurcandede/cc-cost', cache), '9.9.9');
    // offline never touches the network, even with a stale cache
    fs.writeFileSync(cache, JSON.stringify({ checked: '2000-01-01T00:00:00Z', latest: '1.2.3' }));
    assert.equal(await latestVersion('@ugurcandede/cc-cost', cache, { offline: true }), '1.2.3');
});
