import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const XDG_CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');

// Claude Code data roots. CLAUDE_CONFIG_DIR may list several, comma-separated.
export function claudeDirs(): string[] {
    const env = process.env.CLAUDE_CONFIG_DIR;
    const dirs = env
        ? env.split(',').map((s) => s.trim()).filter(Boolean)
        : [path.join(HOME, '.claude'), path.join(XDG_CONFIG, 'claude')];
    return dirs.filter((d) => fs.existsSync(path.join(d, 'projects')));
}

export function configDir(): string {
    if (process.platform === 'win32')
        return path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'cc-cost');
    return path.join(XDG_CONFIG, 'cc-cost');
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
