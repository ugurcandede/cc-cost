import path from 'node:path';
import { detectAccount } from './accounts.ts';
import type { Config } from './config.ts';
import { retentionDays } from './paths.ts';
import { exchange } from './remote.ts';
import { localClock, scan, type ScanResult } from './scan.ts';
import { loadOwn, merge, save } from './snapshot.ts';
import type { AccountMeta } from './types.ts';

export interface Settings {
    syncDir: string;
    machine: string;
    lang: string;
    timezone: string;
    planPrice: number;
    anonymize: boolean;
    pricing: Record<string, number[]>;
    claudeDirs: string[];
    remote?: string; // user@host:path, exchanged over ssh after each sync
    accounts?: Config['accounts']; // name, plan and price the user gave each account
    unassigned?: string; // account id for rows synced before accounts were told apart
}

export const dashboardPath = (s: Settings) => path.join(s.syncDir, 'dashboard.html');

export interface SyncResult {
    scan: ScanResult;
    file: string;
    kept: number; // stored days that the scan did not replace
    remoteError?: string; // the server could not be reached; reports use the local copies
}

// Scan this machine's transcripts into its snapshot in the sync folder.
export async function sync(s: Settings): Promise<SyncResult> {
    const dirs = s.claudeDirs;
    // The account behind each folder, with the plan the user chose or, failing that, the one detected
    const accounts: Record<string, AccountMeta> = {};
    const accountOf: Record<string, string> = {};
    for (const dir of dirs) {
        const a = detectAccount(dir, s.machine);
        accountOf[dir] = a.id;
        const given = s.accounts?.[a.id] ?? {};
        accounts[a.id] = Object.fromEntries(
            Object.entries({ name: given.name, plan: given.plan ?? a.plan, price: given.price, folder: a.folder }).filter(([, v]) => v !== undefined),
        );
    }
    const result = await scan(dirs, { timezone: s.timezone, anonymize: s.anonymize, accounts: accountOf });
    const prev = loadOwn(s.syncDir, s.machine, s.timezone);
    const safeFrom = localClock(s.timezone)(new Date(Date.now() - (retentionDays(dirs) - 1) * 864e5).toISOString()).d;
    const next = merge(prev, result, safeFrom, { machine: s.machine, timezone: s.timezone, accounts, unassigned: s.unassigned });
    const file = save(s.syncDir, next);
    let remoteError: string | undefined;
    if (s.remote) {
        try {
            exchange(s.remote, file);
        } catch (e) {
            remoteError = (e as Error).message;
        }
    }
    const fromPrev = new Set(prev.rows);
    const kept = new Set(next.rows.filter((r) => fromPrev.has(r)).map((r) => r.d)).size;
    return { scan: result, file, kept, remoteError };
}
