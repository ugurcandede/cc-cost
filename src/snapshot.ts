import fs from 'node:fs';
import path from 'node:path';
import { localClock } from './aggregate.ts';
import { fill, L } from './i18n.ts';
import { emptySnapshot, fromLegacy, isLegacy, join, split } from './months.ts';
import type { ScanResult } from './scan.ts';
import type { AccountMeta, Header, LimitEvent, MonthFile, Snapshot } from './types.ts';

// One header file and one folder of months per machine: each machine only writes its own, so a sync
// service never sees two writers on the same file and can't produce conflicted copies. index.json
// lists the machines for the dashboard, which can't list a folder; a machine adds itself once.
export const machinesDir = (syncDir: string) => path.join(syncDir, 'machines');
export const indexFile = (syncDir: string) => path.join(machinesDir(syncDir), 'index.json');
const headerFile = (syncDir: string, machine: string) => path.join(machinesDir(syncDir), `${machine}.json`);
const monthFile = (syncDir: string, machine: string, month: string) => path.join(machinesDir(syncDir), machine, `${month}.json`);

function readJson(file: string): unknown {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// A header with its months; a schema 2 file is whole by itself. A month file missing from the folder
// (a sync service still copying it) is skipped rather than failing the whole machine.
function readMachine(syncDir: string, file: string): Snapshot | undefined {
    const v = readJson(file) as Header | Snapshot;
    if (v.schema !== 2 && v.schema !== 3) return undefined;
    const months: MonthFile[] = [];
    if ('months' in v)
        for (const m of v.months) {
            const f = monthFile(syncDir, v.machine, m);
            if (fs.existsSync(f)) months.push(readJson(f) as MonthFile);
        }
    return join(v, months);
}

const headerFiles = (syncDir: string) => fs.readdirSync(machinesDir(syncDir)).filter((f) => f.endsWith('.json') && f !== 'index.json');

// All machines in the sync folder. Legacy files count only for machines not yet on schema 2 or 3. A
// machine whose files can't be read (a sync service still copying one) is left out, with a note.
export function loadAll(syncDir: string): Snapshot[] {
    const byMachine = new Map<string, Snapshot>();
    const unreadable = (file: string, e: unknown) => console.error(fill(L().unreadable, { file, reason: (e as Error).message }));
    if (fs.existsSync(machinesDir(syncDir)))
        for (const f of headerFiles(syncDir)) {
            try {
                const snap = readMachine(syncDir, path.join(machinesDir(syncDir), f));
                if (snap) byMachine.set(snap.machine, snap);
            } catch (e) {
                unreadable(path.join('machines', f), e);
            }
        }
    if (fs.existsSync(syncDir))
        for (const f of fs.readdirSync(syncDir).filter((f) => f.endsWith('.json'))) {
            let v: unknown;
            try {
                v = readJson(path.join(syncDir, f));
            } catch (e) {
                unreadable(f, e);
                continue;
            }
            if (!isLegacy(v)) continue;
            const snap = fromLegacy(v, f.replace(/\.json$/, ''));
            if (!byMachine.has(snap.machine)) byMachine.set(snap.machine, snap);
        }
    return [...byMachine.values()];
}

export function loadOwn(syncDir: string, machine: string, timezone: string): Snapshot {
    const file = headerFile(syncDir, machine);
    if (fs.existsSync(file)) return readMachine(syncDir, file) ?? emptySnapshot(machine, timezone);
    const legacy = path.join(syncDir, `${machine}.json`);
    if (fs.existsSync(legacy)) {
        const v = readJson(legacy);
        if (isLegacy(v)) return fromLegacy(v, machine);
    }
    return emptySnapshot(machine, timezone);
}

// A scanned day replaces the stored one only when all of its transcripts must still be on disk,
// i.e. it is newer than `safeFrom`. Older scanned days can be partial (short sessions of that day
// already cleaned up, a long session reaching into it still there), so they only fill gaps.
// meta.accounts describes the accounts read now; ones read before keep their entry, since archived rows
// still point at them.
export function merge(
    prev: Snapshot,
    scan: ScanResult,
    safeFrom: string,
    meta: { machine: string; timezone: string; accounts?: Record<string, AccountMeta>; unassigned?: string; plan?: string },
): Snapshot {
    const stored = new Set(prev.rows.map((r) => r.d));
    const take = new Set([...scan.rows, ...scan.hourly].map((r) => r.d).filter((d) => d >= safeFrom || !stored.has(d)));

    const sessions = { ...prev.sessions };
    for (const [id, s] of Object.entries(scan.sessions)) {
        const old = sessions[id];
        sessions[id] = old ? { p: s.p, first: s.first < old.first ? s.first : old.first, last: s.last > old.last ? s.last : old.last } : s;
    }
    const limits = new Map<string, LimitEvent>();
    // Like rows, a replaced day's limit events come from the scan only.
    const day = localClock(meta.timezone);
    for (const l of [...prev.limits.filter((x) => !take.has(day(x.ts).d)), ...scan.limits]) {
        const key = `${l.ac}|${l.type}|${l.status}|${l.resetsAt ?? l.ts}`;
        const seen = limits.get(key);
        if (!seen || l.ts < seen.ts) limits.set(key, l);
    }

    return {
        schema: 3,
        machine: meta.machine,
        updated: new Date().toISOString(),
        timezone: meta.timezone,
        rows: [...prev.rows.filter((r) => !take.has(r.d)), ...scan.rows.filter((r) => take.has(r.d))],
        hourly: [...prev.hourly.filter((r) => !take.has(r.d)), ...scan.hourly.filter((r) => take.has(r.d))],
        sessions,
        limits: [...limits.values()].sort((a, b) => a.ts.localeCompare(b.ts)),
        ...(meta.accounts || prev.accounts ? { accounts: { ...prev.accounts, ...meta.accounts } } : {}),
        ...(meta.unassigned ? { unassigned: meta.unassigned } : {}),
        ...(meta.plan ? { plan: meta.plan } : {}),
    };
}

// write-then-rename, so a sync client never uploads a half-written file; untouched when the content is
// the same, so a sync client has nothing to upload either
function writeIfChanged(file: string, text: string) {
    try {
        if (fs.readFileSync(file, 'utf8') === text) return;
    } catch {
        // new file
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', text);
    fs.renameSync(file + '.tmp', file);
}

// Months first, the header last: a reader never finds a month in the list that is not on disk yet.
// Returns the header file.
export function save(syncDir: string, snap: Snapshot): string {
    const { header, months } = split(snap);
    for (const [m, data] of Object.entries(months)) writeIfChanged(monthFile(syncDir, snap.machine, m), JSON.stringify(data));
    const file = headerFile(syncDir, snap.machine);
    writeIfChanged(file, JSON.stringify(header));
    writeIfChanged(indexFile(syncDir), JSON.stringify(machineNames(syncDir)));
    return file;
}

// What index.json lists: the file to read for each machine found here, so a machine whose files were
// deleted leaves the index too. A header in machines/, or in the root the legacy file of a machine still
// on the original cc-cost.mjs, which the dashboard can't find otherwise; its host may differ from the file.
function machineNames(syncDir: string): string[] {
    const headers = headerFiles(syncDir).map((f) => f.slice(0, -5));
    const legacy = fs.readdirSync(syncDir).filter((f) => f.endsWith('.json')).filter((f) => {
        try {
            const v = readJson(path.join(syncDir, f));
            return isLegacy(v) && !headers.includes(v.host ?? f.slice(0, -5));
        } catch {
            return false; // not whole yet: listed by a later save
        }
    });
    return [...headers, ...legacy.map((f) => f.slice(0, -5))].sort();
}
