import path from 'node:path';
import { detectAccount } from './accounts.ts';
import { localClock } from './aggregate.ts';
import type { Config } from './config.ts';
import { retentionDays } from './paths.ts';
import { scan, type ScanResult } from './scan.ts';
import { loadOwn, merge, save } from './snapshot.ts';
import type { AccountMeta } from './types.ts';

export interface Settings {
    syncDir: string; // where the data is: the shared folder, or a mirror of the server's folder (see cli.ts)
    machine: string;
    lang: string;
    timezone: string;
    anonymize: boolean;
    plan?: string; // for rows that belong to no account
    claudeDirs: string[];
    remote?: string; // user@host:path of the server syncDir mirrors
    accounts?: Config['accounts']; // name, plan and price the user gave each account
    unassigned?: string; // account id for rows synced before accounts were told apart
}

export const dashboardPath = (s: Settings) => path.join(s.syncDir, 'dashboard.html');

export interface SyncResult {
    scan: ScanResult;
    file: string;
    kept: number; // stored days that the scan did not replace
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
    const next = merge(prev, result, safeFrom, { machine: s.machine, timezone: s.timezone, accounts, unassigned: s.unassigned, plan: s.plan });
    const file = save(s.syncDir, next);
    const fromPrev = new Set(prev.rows);
    const kept = new Set(next.rows.filter((r) => fromPrev.has(r)).map((r) => r.d)).size;
    return { scan: result, file, kept };
}
