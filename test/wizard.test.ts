import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { tempDir } from './tmp.ts';

// The interactive setup, driven by keys: a fake terminal (test/fake-tty.mjs) makes the wizard draw its
// menus, and each key goes in once the output has been quiet for a moment, as a person would type.
const home = tempDir('cc-cost-wizard-');
const claude = path.join(home, '.claude');
fs.mkdirSync(path.join(claude, 'projects'), { recursive: true });
// a login, the way Claude Code records it: ids and plan, no e-mail
fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'u', organizationUuid: 'o', organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_5x' } }));
const env = {
    ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'), XDG_CONFIG_HOME: path.join(home, '.config'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'), OneDrive: '', OneDriveConsumer: '', OneDriveCommercial: '',
    CLAUDE_CONFIG_DIR: claude, NO_COLOR: '1',
};
const KEYS: Record<string, string> = { down: '\x1b[B', enter: '\r', q: 'q' };

// Runs cc-cost with the keys, each sent after 400ms of silence; resolves with the output and exit code
function drive(args: string[], keys: string[], timeoutMs = 60_000) {
    return new Promise<{ code: number | null; out: string }>((resolve) => {
        const cli = path.join(import.meta.dirname, '..', 'src', 'cli.ts');
        const p = spawn(process.execPath, ['--import', pathToFileURL(path.join(import.meta.dirname, 'fake-tty.mjs')).href, cli, ...args, '--offline', '--no-color'], { env });
        let out = '', i = 0, timer: NodeJS.Timeout | undefined;
        const next = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (i < keys.length) p.stdin.write(KEYS[keys[i]!] ?? keys[i]!), i++, next();
            }, 400);
        };
        p.stdout.on('data', (d) => { out += d; next(); });
        p.stderr.on('data', (d) => { out += d; });
        const kill = setTimeout(() => p.kill(), timeoutMs);
        p.on('exit', (code) => { clearTimeout(timer); clearTimeout(kill); resolve({ code, out }); });
        next();
    });
}

test('setup: language, this machine only, a named account and its plan, no schedule or hook', async () => {
    // Language: English (Enter); where: "This machine only", preselected when no synced folder is found; account name;
    // plan: the preselected Max 5x; hook: No; open the dashboard: No
    const r = await drive(['setup', '--no-schedule'], ['enter', 'enter', 'Work\r', 'enter', 'down', 'enter', 'down', 'enter']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Language +✓ English/);
    assert.match(r.out, /This machine only/);
    assert.match(r.out, /Work: plan +✓ Max 5x/);
    const configFile = path.join(home, process.platform === 'win32' ? 'AppData' : '.config', 'cc-cost', 'config.json');
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const account = Object.values(config.accounts as Record<string, { name: string; plan: string }>)[0]!;
    assert.equal(account.name, 'Work');
    assert.equal(account.plan, 'max5x');
    assert.equal(config.syncDir, undefined, 'this machine only keeps no shared folder');
    assert.ok(fs.existsSync(path.join(path.dirname(configFile), 'data', 'dashboard.html')), 'the first sync wrote the dashboard next to the config');
});

test('setup: q cancels and saves nothing', async () => {
    const configFile = path.join(home, process.platform === 'win32' ? 'AppData' : '.config', 'cc-cost', 'config.json');
    const before = fs.readFileSync(configFile, 'utf8');
    const r = await drive(['setup', '--no-schedule', '--no-hook'], ['q']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /cancelled/i);
    assert.equal(fs.readFileSync(configFile, 'utf8'), before);
});
