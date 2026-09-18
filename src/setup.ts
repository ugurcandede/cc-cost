import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeDirs } from './paths.ts';

const HOME = os.homedir();
export const SCHEDULE_TIME = '10:23';
const [HOUR, MINUTE] = SCHEDULE_TIME.split(':').map(Number) as [number, number];
// Overridable so tests never touch a real task of the same name
const TASK = process.env.CC_COST_TASK || 'cc-cost';
const LAUNCHD_LABEL = 'com.cc-cost.sync';

// How the scheduler and the hook start cc-cost: this node binary and this script, resolved.
export interface Runner {
    node: string;
    script: string;
}
export const currentRunner = (): Runner => ({ node: process.execPath, script: fs.realpathSync(process.argv[1]!) });
// npx runs from a cache folder that gets cleaned; a scheduled path there would break silently.
export const isEphemeral = (r: Runner) => /[\\/]_npx[\\/]/.test(r.script);

// ---------- shared folder

function exists(p: string) {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}

// Sync-service folders on this machine, most likely first
export function syncFolders(): string[] {
    const found: string[] = [];
    // Dropbox records its folders (personal and business) in info.json
    const dropboxInfo = [
        path.join(process.env.LOCALAPPDATA ?? '', 'Dropbox', 'info.json'),
        path.join(process.env.APPDATA ?? '', 'Dropbox', 'info.json'),
        path.join(HOME, '.dropbox', 'info.json'),
    ];
    for (const f of dropboxInfo) {
        try {
            for (const v of Object.values(JSON.parse(fs.readFileSync(f, 'utf8'))) as { path?: string }[]) if (v?.path) found.push(v.path);
        } catch {
            // no Dropbox, or not at this location
        }
    }
    found.push(path.join(HOME, 'Dropbox'));
    for (const v of [process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial]) if (v) found.push(v);
    found.push(path.join(HOME, 'OneDrive'));
    if (process.platform === 'darwin') {
        found.push(path.join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
        try {
            for (const e of fs.readdirSync(path.join(HOME, 'Library', 'CloudStorage')))
                found.push(path.join(HOME, 'Library', 'CloudStorage', e, e.startsWith('GoogleDrive-') ? 'My Drive' : ''));
        } catch {
            // no File Provider mounts
        }
    }
    if (process.platform === 'win32') found.push(path.join(HOME, 'iCloudDrive'), 'G:\\My Drive');
    found.push(path.join(HOME, 'Google Drive'));
    return [...new Set(found.map((p) => path.resolve(p)))].filter(exists);
}

// Where to keep the data inside a sync folder: reuse an existing cc-cost folder (including one
// made by the original script, "claude-cost"), otherwise a new "cc-cost" folder.
export function dataFolderIn(root: string): string {
    for (const name of ['cc-cost', 'claude-cost']) if (exists(path.join(root, name))) return path.join(root, name);
    return path.join(root, 'cc-cost');
}

// ---------- scheduler

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
const xml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: 'utf8' });
const powershell = (script: string) =>
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);

const launchdPlist = () => path.join(HOME, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
const systemdDir = () => path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'systemd', 'user');

export function plistFor(r: Runner): string {
    const args = [r.node, r.script, 'sync', '--quiet'].map((a) => `    <string>${xml(a)}</string>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${HOUR}</integer>
    <key>Minute</key>
    <integer>${MINUTE}</integer>
  </dict>
</dict>
</plist>
`;
}

export function systemdUnits(r: Runner): { service: string; timer: string } {
    return {
        service: `[Unit]\nDescription=cc-cost sync\n\n[Service]\nType=oneshot\nExecStart="${r.node}" "${r.script}" sync --quiet\n`,
        // Persistent: a run missed while the machine was off happens at the next boot
        timer: `[Unit]\nDescription=Daily cc-cost sync\n\n[Timer]\nOnCalendar=*-*-* ${SCHEDULE_TIME}:00\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`,
    };
}

// PowerShell that registers the Windows task. The task starts a hidden PowerShell that runs node,
// so no console window flashes; StartWhenAvailable catches up on a run missed while powered off.
export function windowsTaskScript(r: Runner): string {
    const argument = `-NoProfile -WindowStyle Hidden -Command "& ${psQuote(r.node)} ${psQuote(r.script)} sync --quiet"`;
    return [
        `$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${psQuote(argument)}`,
        `$t = New-ScheduledTaskTrigger -Daily -At '${SCHEDULE_TIME}'`,
        '$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)',
        `Register-ScheduledTask -TaskName ${psQuote(TASK)} -Action $a -Trigger $t -Settings $s -Description 'cc-cost daily sync' -Force | Out-Null`,
    ].join('\n');
}

export interface ScheduleResult {
    ok: boolean;
    what: string; // human-readable location of the schedule, or the error
}

export function installSchedule(r: Runner): ScheduleResult {
    if (process.platform === 'win32') {
        const res = powershell(windowsTaskScript(r));
        return res.status === 0 ? { ok: true, what: `Task Scheduler "${TASK}", ${SCHEDULE_TIME}` } : { ok: false, what: (res.stderr || res.stdout || '').trim() };
    }
    if (process.platform === 'darwin') {
        const plist = launchdPlist();
        fs.mkdirSync(path.dirname(plist), { recursive: true });
        fs.writeFileSync(plist, plistFor(r));
        const domain = `gui/${process.getuid!()}`;
        run('launchctl', ['bootout', `${domain}/${LAUNCHD_LABEL}`]); // not loaded yet is fine
        const res = run('launchctl', ['bootstrap', domain, plist]);
        if (res.status === 0) return { ok: true, what: `${plist}, ${SCHEDULE_TIME}` };
        fs.rmSync(plist, { force: true }); // a plist left behind would read as installed
        return { ok: false, what: (res.stderr || '').trim() };
    }
    const units = systemdUnits(r), dir = systemdDir();
    if (run('systemctl', ['--user', '--version']).status !== 0) return { ok: false, what: 'systemctl --user is not available' };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cc-cost.service'), units.service);
    fs.writeFileSync(path.join(dir, 'cc-cost.timer'), units.timer);
    run('systemctl', ['--user', 'daemon-reload']);
    const res = run('systemctl', ['--user', 'enable', '--now', 'cc-cost.timer']);
    if (res.status === 0) return { ok: true, what: `${path.join(dir, 'cc-cost.timer')}, ${SCHEDULE_TIME}` };
    // e.g. no user session bus; unit files left behind would read as installed
    for (const f of ['cc-cost.timer', 'cc-cost.service']) fs.rmSync(path.join(dir, f), { force: true });
    return { ok: false, what: (res.stderr || '').trim() };
}

export function scheduleInstalled(): boolean {
    if (process.platform === 'win32') return run('schtasks', ['/Query', '/TN', TASK]).status === 0;
    if (process.platform === 'darwin') return fs.existsSync(launchdPlist());
    return fs.existsSync(path.join(systemdDir(), 'cc-cost.timer'));
}

export function removeSchedule(): string | undefined {
    if (!scheduleInstalled()) return undefined;
    if (process.platform === 'win32') {
        run('schtasks', ['/Delete', '/TN', TASK, '/F']);
        return `Task Scheduler "${TASK}"`;
    }
    if (process.platform === 'darwin') {
        run('launchctl', ['bootout', `gui/${process.getuid!()}/${LAUNCHD_LABEL}`]);
        fs.rmSync(launchdPlist(), { force: true });
        return launchdPlist();
    }
    run('systemctl', ['--user', 'disable', '--now', 'cc-cost.timer']);
    for (const f of ['cc-cost.timer', 'cc-cost.service']) fs.rmSync(path.join(systemdDir(), f), { force: true });
    run('systemctl', ['--user', 'daemon-reload']);
    return path.join(systemdDir(), 'cc-cost.timer');
}

// ---------- Claude Code hook

interface HookCommand {
    type: string;
    command?: string;
    timeout?: number;
}
interface HookEntry {
    matcher?: string;
    hooks?: HookCommand[];
}
interface ClaudeSettings {
    hooks?: Record<string, HookEntry[]>;
    [key: string]: unknown;
}

export const claudeSettingsFile = () => path.join(claudeDirs()[0] ?? process.env.CLAUDE_CONFIG_DIR?.split(',')[0] ?? path.join(HOME, '.claude'), 'settings.json');

// Forward slashes work in every shell Claude Code may run hooks with, Git Bash included.
export const hookCommand = (r: Runner) => [r.node, r.script].map((p) => `"${p.replace(/\\/g, '/')}"`).join(' ') + ' sync --quiet';
const isOurs = (h: HookCommand) => /cc-cost/.test(h.command ?? '') && /\bsync --quiet\b/.test(h.command ?? '');

function readSettings(file: string): ClaudeSettings {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}
function writeSettings(file: string, s: ClaudeSettings) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // one-time copy of the user's file before we first change it
    if (fs.existsSync(file) && !fs.existsSync(file + '.cc-cost.bak')) fs.copyFileSync(file, file + '.cc-cost.bak');
    fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
}

export function hookInstalled(file = claudeSettingsFile()): boolean {
    return (readSettings(file).hooks?.SessionEnd ?? []).some((e) => e.hooks?.some(isOurs));
}

// Adds the SessionEnd hook, or updates its command if cc-cost moved. Returns false if it was already current.
export function installHook(r: Runner, file = claudeSettingsFile()): boolean {
    const s = readSettings(file);
    const entries = ((s.hooks ??= {}).SessionEnd ??= []);
    const command = hookCommand(r);
    const ours = entries.flatMap((e) => e.hooks ?? []).find(isOurs);
    if (ours?.command === command) return false;
    if (ours) ours.command = command;
    // Synchronous with a short timeout: a sync takes about a second, and a background hook
    // may be killed when Claude Code exits.
    else entries.push({ hooks: [{ type: 'command', command, timeout: 60 }] });
    writeSettings(file, s);
    return true;
}

export function removeHook(file = claudeSettingsFile()): boolean {
    if (!hookInstalled(file)) return false;
    const s = readSettings(file);
    const kept = (s.hooks!.SessionEnd ?? [])
        .map((e) => ({ ...e, hooks: e.hooks?.filter((h) => !isOurs(h)) }))
        .filter((e) => e.hooks?.length);
    if (kept.length) s.hooks!.SessionEnd = kept;
    else delete s.hooks!.SessionEnd;
    if (!Object.keys(s.hooks!).length) delete s.hooks;
    writeSettings(file, s);
    return true;
}
