import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const XDG_CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');

// Comma-separated folders, with a leading ~ meaning the home folder
export const parseDirs = (list: string) =>
    list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => path.resolve(s.replace(/^~(?=$|[\\/])/, HOME)));

// Claude Code data roots. The configured list wins over CLAUDE_CONFIG_DIR: a hook started from one
// account's session inherits that account's CLAUDE_CONFIG_DIR and would otherwise sync only that account.
export function claudeDirs(configured?: string[]): string[] {
    const env = process.env.CLAUDE_CONFIG_DIR;
    const dirs = configured?.length ? configured : env ? parseDirs(env) : [path.join(HOME, '.claude'), path.join(XDG_CONFIG, 'claude')];
    return dirs.filter((d) => fs.existsSync(path.join(d, 'projects')));
}

// ~/.claude, ~/.claude-work and the like: one folder per Claude account
export function findClaudeDirs(): string[] {
    const inHome = fs.readdirSync(HOME).filter((n) => n.startsWith('.claude')).map((n) => path.join(HOME, n));
    return [...inHome, path.join(XDG_CONFIG, 'claude')].filter((d) => fs.existsSync(path.join(d, 'projects')));
}

export function configDir(): string {
    if (process.platform === 'win32')
        return path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'cc-cost');
    return path.join(XDG_CONFIG, 'cc-cost');
}

// Where the data goes without a shared folder: this machine only
export const defaultSyncDir = () => path.join(configDir(), 'data');

// A path under the home folder, shown from ~
export function tilde(p: string): string {
    const rel = path.relative(path.resolve(HOME), p);
    return !rel ? '~' : rel.startsWith('..') || path.isAbsolute(rel) ? p : path.join('~', rel);
}

// Claude Code deletes transcripts older than cleanupPeriodDays (default 30). With several roots,
// the shortest window wins: a day older than that may have been partially cleaned up somewhere.
export function retentionDays(dirs: string[]): number {
    let min = Infinity;
    for (const dir of dirs) {
        let days = 30;
        const file = path.join(dir, 'settings.json');
        try {
            const v = JSON.parse(fs.readFileSync(file, 'utf8')).cleanupPeriodDays;
            if (typeof v === 'number' && v > 0) days = v;
        } catch {
            // missing or unreadable settings: Claude Code falls back to its default too
        }
        min = Math.min(min, days);
    }
    return min === Infinity ? 30 : min;
}

export const defaultMachine = () => os.hostname().replace(/[^A-Za-z0-9._-]/g, '_');

// A machine name names files (machines/<name>.json, machines/<name>/): nothing a file system refuses, no
// dot or space at either end, and not "index", which names the list of machines
export const validMachine = (name: string) => /^[^\\/:*?"<>|\x00-\x1f]+$/.test(name) && !/^[ .]|[ .]$/.test(name) && name !== 'index';
