import { priceFor, type Price, type PriceTable } from './pricing.ts';
import { T, T_LEN, type HourRow, type LimitEvent, type Row, type Snapshot } from './types.ts';

// $ per part: input, cache write, cache read, output, web search
export type Cost = [number, number, number, number, number];

export interface PricedRow extends Row {
    machine: string;
    c: Cost;
    cost: number;
}

export interface PricedHour extends HourRow {
    machine: string;
    cost: number;
}

export interface MachineLimit extends LimitEvent {
    machine: string;
}

export const modelLabel = (r: { m: string; f?: 1 }) => (r.f ? `${r.m}-fast` : r.m);
export const agentOf = (r: Row) => r.a ?? 'main';

const n = (t: number[], i: number) => t[i] ?? 0;

export function costOf(t: number[], p: Price, webSearch: number): Cost {
    return [
        (n(t, T.input) * p[0]) / 1e6,
        (n(t, T.write5m) * p[1] + n(t, T.write1h) * p[2]) / 1e6,
        (n(t, T.read) * p[3]) / 1e6,
        (n(t, T.output) * p[4]) / 1e6,
        n(t, T.webSearch) * webSearch,
    ];
}

const sum = (c: Cost) => c[0] + c[1] + c[2] + c[3] + c[4];

export function priceRows(snaps: Snapshot[], table: PriceTable, overrides: Record<string, number[]> = {}) {
    const rows: PricedRow[] = [];
    const hours: PricedHour[] = [];
    const limits: MachineLimit[] = [];
    const unknown = new Set<string>();
    for (const snap of snaps) {
        for (const r of snap.rows) {
            const p = priceFor(table, r.m, !!r.f, overrides);
            if (!p) {
                unknown.add(modelLabel(r));
                continue;
            }
            const c = costOf(r.t, p, table.webSearch);
            rows.push({ ...r, machine: snap.machine, c, cost: sum(c) });
        }
        for (const h of snap.hourly) {
            const p = priceFor(table, h.m, !!h.f, overrides);
            if (p) hours.push({ ...h, machine: snap.machine, cost: sum(costOf(h.t, p, table.webSearch)) });
        }
        for (const l of snap.limits) limits.push({ ...l, machine: snap.machine });
    }
    return { rows, hours, limits, unknown };
}

// What the same tokens would cost on another model at standard speed
export function repriceAs(rows: PricedRow[], table: PriceTable, model: string): number | undefined {
    const p = table.models[model];
    return p && rows.reduce((acc, r) => acc + sum(costOf(r.t, p, table.webSearch)), 0);
}

export interface Filter {
    since?: string;
    until?: string;
    machine?: string[];
    project?: string[];
    model?: string[];
    session?: string[];
    agent?: string[];
    skill?: string[];
    mcp?: string[];
}

// Name filters match case-insensitive substrings ("opus" -> every Opus model); sessions match by id prefix.
const matches = (wanted: string[] | undefined, value: string) =>
    !wanted?.length || wanted.some((w) => value.toLowerCase().includes(w.toLowerCase()));

export function applyFilter(rows: PricedRow[], f: Filter): PricedRow[] {
    return rows.filter(
        (r) =>
            (!f.since || r.d >= f.since) &&
            (!f.until || r.d <= f.until) &&
            matches(f.machine, r.machine) &&
            matches(f.project, r.p) &&
            matches(f.model, modelLabel(r)) &&
            (!f.session?.length || f.session.some((s) => r.s.startsWith(s))) &&
            matches(f.agent, agentOf(r)) &&
            matches(f.skill, r.k ?? '') &&
            matches(f.mcp, r.x ?? ''),
    );
}

// Hourly data has no project, session or attribution; only these filters apply to it.
export const hourFilterable = (f: Filter) => !f.project?.length && !f.session?.length && !f.agent?.length && !f.skill?.length && !f.mcp?.length;

export function applyHourFilter(hours: PricedHour[], f: Filter): PricedHour[] {
    return hours.filter(
        (h) => (!f.since || h.d >= f.since) && (!f.until || h.d <= f.until) && matches(f.machine, h.machine) && matches(f.model, modelLabel(h)),
    );
}

export interface Totals {
    cost: number;
    c: Cost;
    t: number[];
    sessions: Set<string>;
    days: Set<string>;
    machines: Set<string>;
}

const emptyTotals = (): Totals => ({
    cost: 0, c: [0, 0, 0, 0, 0], t: new Array(T_LEN).fill(0), sessions: new Set(), days: new Set(), machines: new Set(),
});

function add(acc: Totals, r: PricedRow) {
    acc.cost += r.cost;
    for (let i = 0; i < 5; i++) acc.c[i]! += r.c[i]!;
    for (let i = 0; i < T_LEN; i++) acc.t[i] = i === T.maxContext ? Math.max(acc.t[i]!, n(r.t, i)) : acc.t[i]! + n(r.t, i);
    acc.sessions.add(r.s);
    acc.days.add(r.d);
    acc.machines.add(r.machine);
}

export function totals(rows: PricedRow[]): Totals {
    const acc = emptyTotals();
    for (const r of rows) add(acc, r);
    return acc;
}

export function groupBy(rows: PricedRow[], key: (r: PricedRow) => string): Map<string, Totals> {
    const out = new Map<string, Totals>();
    for (const r of rows) {
        const k = key(r);
        let acc = out.get(k);
        if (!acc) out.set(k, (acc = emptyTotals()));
        add(acc, r);
    }
    return out;
}

export const byCost = (m: Map<string, Totals>) => [...m].sort((a, b) => b[1].cost - a[1].cost);

// Monday of the ISO week containing the date
export function weekOf(date: string): string {
    const t = new Date(date + 'T00:00:00Z');
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
}

export const contextTokens = (t: number[]) => n(t, T.input) + n(t, T.write5m) + n(t, T.write1h) + n(t, T.read);

// Mean context per call: every call re-reads its whole prompt, which is what drives cache-read cost.
export const avgContext = (t: number[]) => (n(t, T.calls) ? contextTokens(t) / n(t, T.calls) : 0);

// Share of prompt tokens served from cache
export const cacheHitRatio = (t: number[]) => (contextTokens(t) ? n(t, T.read) / contextTokens(t) : 0);

// Calendar days from `from` to `to`, inclusive
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
