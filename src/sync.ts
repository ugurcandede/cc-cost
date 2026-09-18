import path from 'node:path';
import { claudeDirs, retentionDays } from './paths.ts';
import { localClock, scan, type ScanResult } from './scan.ts';
import { loadOwn, merge, save } from './snapshot.ts';

export interface Settings {
    syncDir: string;
    machine: string;
    lang: string;
    timezone: string;
    planPrice: number;
    anonymize: boolean;
    pricing: Record<string, number[]>;
}

export const dashboardPath = (s: Settings) => path.join(s.syncDir, 'dashboard.html');

export interface SyncResult {
    scan: ScanResult;
    file: string;
    kept: number; // stored days that the scan did not replace
}

// Scan this machine's transcripts into its snapshot in the sync folder.
export async function sync(s: Settings): Promise<SyncResult> {
    const dirs = claudeDirs();
    const result = await scan(dirs, { timezone: s.timezone, anonymize: s.anonymize });
    const prev = loadOwn(s.syncDir, s.machine, s.timezone);
    const safeFrom = localClock(s.timezone)(new Date(Date.now() - (retentionDays(dirs) - 1) * 864e5).toISOString()).d;
    const next = merge(prev, result, safeFrom, { machine: s.machine, timezone: s.timezone });
    const file = save(s.syncDir, next);
    const fromPrev = new Set(prev.rows);
    const kept = new Set(next.rows.filter((r) => fromPrev.has(r)).map((r) => r.d)).size;
    return { scan: result, file, kept };
}
