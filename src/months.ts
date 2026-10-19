import { T_LEN, UNKNOWN, type Header, type MonthFile, type Snapshot } from './types.ts';

// A machine's snapshot on disk, one file per month, and the formats before it. No node: imports: the
// dashboard reads the files with this same code (see dashboard.ts).

export const emptySnapshot = (machine: string, timezone: string): Snapshot => ({
    schema: 3, machine, updated: '', timezone, rows: [], hourly: [], sessions: {}, limits: [],
});

// Schema 1, written by the original cc-cost.mjs into the root of the sync folder:
// { host, updated, days: { date: { model or model-fast: [input, w5m, w1h, read, output, calls] } } }
export interface LegacySnapshot {
    host?: string;
    updated?: string;
    days: Record<string, Record<string, number[]>>;
}

export const isLegacy = (v: unknown): v is LegacySnapshot =>
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

// Rows and hours go by their local day; sessions by their first call and limit events by their time,
// both in UTC. A month outside the cleanup window never changes again, so its file is written once.
export const monthOf = (iso: string) => iso.slice(0, 7);

export function split(snap: Snapshot): { header: Header; months: Record<string, MonthFile> } {
    const { rows, hourly, sessions, limits, schema, ...rest } = snap;
    const months: Record<string, MonthFile> = {};
    const at = (iso: string) => (months[monthOf(iso)] ??= { rows: [], hourly: [], sessions: {}, limits: [] });
    for (const r of rows) at(r.d).rows.push(r);
    for (const h of hourly) at(h.d).hourly.push(h);
    for (const [id, s] of Object.entries(sessions)) at(s.first).sessions[id] = s;
    for (const l of limits) at(l.ts).limits.push(l);
    return { header: { ...rest, schema: 3, months: Object.keys(months).sort() }, months };
}

// A schema 2 file is already whole; a header takes its months in any order
export function join(header: Header | Snapshot, months: MonthFile[]): Snapshot {
    if (!('months' in header)) return header;
    const { months: _, ...rest } = header;
    const snap: Snapshot = { ...rest, rows: [], hourly: [], sessions: {}, limits: [] };
    for (const m of months) {
        snap.rows.push(...m.rows);
        snap.hourly.push(...m.hourly);
        Object.assign(snap.sessions, m.sessions);
        snap.limits.push(...m.limits);
    }
    return snap;
}
