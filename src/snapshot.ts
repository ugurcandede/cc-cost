import fs from 'node:fs';
import path from 'node:path';
import { localClock, type ScanResult } from './scan.ts';
import { T_LEN, UNKNOWN, type LimitEvent, type Snapshot } from './types.ts';

// One file per machine: each machine only writes its own, so a sync service never sees two
// writers on the same file and can't produce conflicted copies.
export const machinesDir = (syncDir: string) => path.join(syncDir, 'machines');
const fileFor = (syncDir: string, machine: string) => path.join(machinesDir(syncDir), `${machine}.json`);

export const emptySnapshot = (machine: string, timezone: string): Snapshot => ({
    schema: 2, machine, updated: '', timezone, rows: [], hourly: [], sessions: {}, limits: [],
});

// Schema 1, written by the original cc-cost.mjs into the root of the sync folder:
// { host, updated, days: { date: { model or model-fast: [input, w5m, w1h, read, output, calls] } } }
interface LegacySnapshot {
    host?: string;
    updated?: string;
    days: Record<string, Record<string, number[]>>;
}

const isLegacy = (v: unknown): v is LegacySnapshot =>
    typeof v === 'object' && v !== null && !('schema' in v) && typeof (v as LegacySnapshot).days === 'object';

export function fromLegacy(v1: LegacySnapshot, machine: string): Snapshot {
    const snap = emptySnapshot(v1.host ?? machine, UNKNOWN);
    snap.updated = v1.updated ?? '';
    for (const [d, models] of Object.entries(v1.days))
        for (const [key, t] of Object.entries(models)) {
            const fast = key.endsWith('-fast');
            const counters = [...t.slice(0, 6), ...new Array(T_LEN - 6).fill(0)];
            snap.rows.push({ d, p: UNKNOWN, s: UNKNOWN, m: fast ? key.slice(0, -5) : key, ...(fast && { f: 1 as const }), t: counters });
        }
    return snap;
}

function readJson(file: string): unknown {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// All machines in the sync folder. Legacy files count only for machines not yet on schema 2.
export function loadAll(syncDir: string): Snapshot[] {
    const byMachine = new Map<string, Snapshot>();
    if (fs.existsSync(machinesDir(syncDir)))
        for (const f of fs.readdirSync(machinesDir(syncDir)).filter((f) => f.endsWith('.json'))) {
            const snap = readJson(path.join(machinesDir(syncDir), f)) as Snapshot;
            if (snap.schema === 2) byMachine.set(snap.machine, snap);
        }
    if (fs.existsSync(syncDir))
        for (const f of fs.readdirSync(syncDir).filter((f) => f.endsWith('.json'))) {
            const v = readJson(path.join(syncDir, f));
            if (!isLegacy(v)) continue;
            const snap = fromLegacy(v, f.replace(/\.json$/, ''));
            if (!byMachine.has(snap.machine)) byMachine.set(snap.machine, snap);
        }
    return [...byMachine.values()];
}

export function loadOwn(syncDir: string, machine: string, timezone: string): Snapshot {
    const file = fileFor(syncDir, machine);
    if (fs.existsSync(file)) return readJson(file) as Snapshot;
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
export function merge(prev: Snapshot, scan: ScanResult, safeFrom: string, meta: { machine: string; timezone: string }): Snapshot {
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
        const key = `${l.type}|${l.status}|${l.resetsAt ?? l.ts}`;
        const seen = limits.get(key);
        if (!seen || l.ts < seen.ts) limits.set(key, l);
    }

    return {
        schema: 2,
        machine: meta.machine,
        updated: new Date().toISOString(),
        timezone: meta.timezone,
        rows: [...prev.rows.filter((r) => !take.has(r.d)), ...scan.rows.filter((r) => take.has(r.d))],
        hourly: [...prev.hourly.filter((r) => !take.has(r.d)), ...scan.hourly.filter((r) => take.has(r.d))],
        sessions,
        limits: [...limits.values()].sort((a, b) => a.ts.localeCompare(b.ts)),
    };
}

export function save(syncDir: string, snap: Snapshot): string {
    const file = fileFor(syncDir, snap.machine);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // write-then-rename so the sync client never uploads a half-written file
    fs.writeFileSync(file + '.tmp', JSON.stringify(snap));
    fs.renameSync(file + '.tmp', file);
    return file;
}
