import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from './tmp.ts';

// The CLI end to end: node src/cli.ts against a throwaway config folder, Claude folder and sync folder,
// offline and without a terminal, the way CI and scripts run it.
const home = tempDir('cc-cost-cli-');
const claude = path.join(home, '.claude');
fs.mkdirSync(path.join(claude, 'projects', 'app'), { recursive: true });
fs.writeFileSync(path.join(claude, 'projects', 'app', 's.jsonl'), JSON.stringify({
    type: 'assistant', requestId: 'r1', timestamp: '2026-09-10T10:00:00Z', sessionId: 's1', cwd: '/app',
    message: { id: 'm1', model: 'claude-opus-5', usage: { input_tokens: 1000, output_tokens: 1000 } },
}) + '\n');
const env = {
    ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'), XDG_CONFIG_HOME: path.join(home, '.config'),
    CLAUDE_CONFIG_DIR: claude, CC_COST_DIR: path.join(home, 'sync'), NO_COLOR: '1',
    CC_COST_TASK: 'cc-cost-test', // never the real scheduled task of this machine
};
const cli = path.join(import.meta.dirname, '..', 'src', 'cli.ts');
const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, [cli, ...args, '--offline'], { env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout, err: r.stderr };
};

test('cli: --version and --help', () => {
    assert.match(run('--version').out, /^\d+\.\d+\.\d+/);
    assert.match(run('--help').out, /Usage: cc-cost/);
});

test('cli: a sync, then every report from the stored data', () => {
    const first = run('sync');
    assert.equal(first.code, 0, first.err);
    for (const cmd of ['', 'daily', 'weekly', 'monthly', 'models', 'machines', 'accounts', 'projects', 'sessions', 'agents', 'skills', 'mcp', 'insights', 'plan', 'blocks']) {
        const r = run(...(cmd ? [cmd] : []), '--no-sync');
        assert.equal(r.code, 0, `${cmd}: ${r.err}`);
        assert.match(r.out, /claude-opus-5|\$|Total/, cmd);
    }
    const json = JSON.parse(run('models', '--json', '--no-sync').out);
    assert.equal(json.models[0].model, 'claude-opus-5');
    assert.equal(json.totals.calls, 1);
    assert.match(run('daily', '--csv', '--no-sync').out, /^Date,/);
});

test('cli: filters and bad values', () => {
    assert.match(run('daily', '--no-sync', '--since', '2026-09-11').out, /No usage/);
    assert.equal(run('daily', '--since', 'yesterday').code, 1);
    assert.equal(run('sessions', '--limit', '0').code, 1);
    assert.equal(run('insights', '--csv').code, 1);
    assert.equal(run('nope').code, 1);
    assert.match(run('nope').err, /Unknown command/);
});

test('cli: config set checks languages, plans, time zones and remotes', () => {
    assert.equal(run('config', 'set', 'lang', 'xx').code, 1);
    assert.equal(run('config', 'set', 'plan', 'gold').code, 1);
    assert.equal(run('config', 'set', 'timezone', 'Mars/Base').code, 1);
    assert.equal(run('config', 'set', 'remote', 'pi@host:2222:cc-cost').code, 1);
    assert.equal(run('config', 'set', 'nope', 'x').code, 1);
    assert.equal(run('config', 'set', 'machine', 'work/pc').code, 1, 'a machine name names files');
    assert.equal(run('config', 'set', 'machine', 'index').code, 1, 'index.json is the list of machines');
    assert.equal(run('config', 'set', 'machine', 'Work PC').code, 0);
    assert.equal(run('config', 'set', 'lang', 'tr').code, 0);
    assert.equal(run('config', 'set', 'plan', 'pro').code, 0);
    const shown = JSON.parse(run('config', '--json').out.split('\n').slice(1).join('\n'));
    assert.equal(shown.lang, 'tr');
    assert.match(run('config', 'set', 'lang', 'en').out, /lang = en/);
});

test('cli: setup --yes and status without a terminal', () => {
    const s = run('setup', '--yes', '--no-schedule', '--no-hook', '--no-color');
    assert.equal(s.code, 0, s.err);
    assert.match(s.out, /saved/);
    const status = JSON.parse(run('status', '--json').out);
    assert.equal(status.schedule, false);
    assert.equal(status.hook, false);
    assert.deepEqual(status.claudeDirs, [claude]);
    assert.equal(status.accounts.length, 1);
});

test('cli: a missing Claude folder is said, not silently empty', () => {
    const r = spawnSync(process.execPath, [cli, 'sync', '--offline'], { env: { ...env, CLAUDE_CONFIG_DIR: path.join(home, 'nowhere') }, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /No Claude Code folder/);
});
