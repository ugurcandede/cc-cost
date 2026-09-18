import {
    agentOf, avgContext, byCost, cacheHitRatio, contextTokens, daysBetween, groupBy, modelLabel, repriceAs, totals, weekOf,
    type MachineLimit, type PricedHour, type PricedRow, type Totals,
} from './aggregate.ts';
import { PLANS } from './config.ts';
import { int, paint, table, tokens, usd } from './format.ts';
import { fill, L, lang } from './i18n.ts';
import type { PriceTable } from './pricing.ts';
import { localClock } from './scan.ts';
import { T, UNKNOWN } from './types.ts';

// A report is raw values plus how to show them; the terminal formats them, CSV keeps them raw.
export type Kind = 'text' | 'usd' | 'int' | 'tok' | 'pct' | 'x';
export type Cell = string | number;
export interface Report {
    cols: { title: string; kind: Kind }[];
    rows: Cell[][];
    foot?: Cell[];
    dim?: Set<number>;
}

const col = (title: string, kind: Kind) => ({ title, kind });
const FMT: Record<Kind, (v: number) => string> = {
    text: String, usd, int, tok: tokens, pct: (v) => v.toFixed(1) + '%', x: (v) => v.toFixed(1) + '×',
};

export function renderTable(r: Report): string {
    const cell = (v: Cell, i: number) => (typeof v === 'number' ? FMT[r.cols[i]!.kind](v) : v);
    const left = r.cols.flatMap((c, i) => (c.kind === 'text' ? [i] : []));
    return table(r.cols.map((c) => c.title), r.rows.map((row) => row.map(cell)), { foot: r.foot?.map(cell), left, dim: r.dim });
}

const csvCell = (v: Cell) =>
    typeof v === 'number' ? String(Math.round(v * 1e4) / 1e4) : /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
export const renderCsv = (r: Report) => [r.cols.map((c) => c.title), ...r.rows].map((row) => row.map(csvCell).join(',')).join('\n');

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const pctOf = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const at = (t: Totals, i: number) => t.t[i] ?? 0;
const writes = (t: Totals) => at(t, T.write5m) + at(t, T.write1h);
const span = (t: Totals) => {
    const days = [...t.days].sort();
    return { first: days[0] ?? '', last: days[days.length - 1] ?? '' };
};

export function toJson(t: Totals) {
    return {
        cost: round(t.cost),
        costBreakdown: { input: round(t.c[0]), cacheWrite: round(t.c[1]), cacheRead: round(t.c[2]), output: round(t.c[3]), webSearch: round(t.c[4]) },
        inputTokens: at(t, T.input),
        cacheWrite5mTokens: at(t, T.write5m),
        cacheWrite1hTokens: at(t, T.write1h),
        cacheReadTokens: at(t, T.read),
        outputTokens: at(t, T.output),
        thinkingTokens: at(t, T.thinking),
        webSearches: at(t, T.webSearch),
        calls: at(t, T.calls),
        sessions: t.sessions.size,
        avgContext: Math.round(avgContext(t.t)),
        maxContext: at(t, T.maxContext),
    };
}

// ---------- periods

export type Period = 'daily' | 'weekly' | 'monthly';
export const PERIODS: Period[] = ['daily', 'weekly', 'monthly'];
const periodKey: Record<Period, (r: PricedRow) => string> = {
    daily: (r) => r.d,
    weekly: (r) => weekOf(r.d),
    monthly: (r) => r.d.slice(0, 7),
};
const byKey = (m: Map<string, Totals>) => [...m].sort((a, b) => a[0].localeCompare(b[0]));

export function periodReport(rows: PricedRow[], period: Period, opts: { breakdown?: boolean; flat?: boolean } = {}): Report {
    const c = L().col;
    const nums = (t: Totals): Cell[] => [at(t, T.input), at(t, T.output), writes(t), at(t, T.read), at(t, T.calls), t.cost];
    const numCols = [col(c.input, 'tok'), col(c.output, 'tok'), col(c.cacheWrite, 'tok'), col(c.cacheRead, 'tok'), col(c.calls, 'int'), col(c.cost, 'usd')];
    const label = col({ daily: c.date, weekly: c.week, monthly: c.month }[period], 'text');
    const groups = byKey(groupBy(rows, periodKey[period]));
    const models = (key: string) => byCost(groupBy(rows.filter((r) => periodKey[period](r) === key), modelLabel));

    // CSV wants one self-contained row per period and model rather than indented sub-rows
    if (opts.breakdown && opts.flat)
        return {
            cols: [label, col(c.model, 'text'), ...numCols],
            rows: groups.flatMap(([key]) => models(key).map(([m, t]) => [key, m, ...nums(t)])),
        };
    const body: Cell[][] = [];
    const dim = new Set<number>();
    for (const [key, t] of groups) {
        body.push([key, ...nums(t)]);
        if (opts.breakdown)
            for (const [m, mt] of models(key)) {
                dim.add(body.length);
                body.push(['  └ ' + m, ...nums(mt)]);
            }
    }
    return { cols: [label, ...numCols], rows: body, foot: [c.total, ...nums(totals(rows))], dim };
}

export function periodJson(rows: PricedRow[], period: Period, breakdown?: boolean) {
    return {
        [period]: byKey(groupBy(rows, periodKey[period])).map(([key, t]) => ({
            period: key,
            ...toJson(t),
            ...(breakdown && {
                models: byCost(groupBy(rows.filter((r) => periodKey[period](r) === key), modelLabel)).map(([m, mt]) => ({ model: m, ...toJson(mt) })),
            }),
        })),
        totals: toJson(totals(rows)),
    };
}

// ---------- dimensions

export type Dimension = 'models' | 'machines' | 'projects' | 'agents' | 'skills' | 'mcp' | 'sessions';
export const DIMENSIONS: Dimension[] = ['models', 'machines', 'projects', 'agents', 'skills', 'mcp', 'sessions'];
const none = () => L().dash.none;
// The main thread is "main" in data and filters, and a translated label on screen
const agentLabel = (key: string) => (key === 'main' ? L().dash.main : key);
const dimensionKey: Record<Dimension, (r: PricedRow) => string> = {
    models: modelLabel,
    machines: (r) => r.machine,
    projects: (r) => r.p,
    agents: agentOf,
    skills: (r) => r.k ?? none(),
    mcp: (r) => r.x ?? none(),
    sessions: (r) => r.s,
};
const singular: Record<Dimension, string> = {
    models: 'model', machines: 'machine', projects: 'project', agents: 'agent', skills: 'skill', mcp: 'mcp', sessions: 'session',
};

function dimensionGroups(rows: PricedRow[], dimension: Dimension, limit?: number) {
    // Legacy data has no session ids; lumped together it would pose as one huge session.
    const source = dimension === 'sessions' ? rows.filter((r) => r.s !== UNKNOWN) : rows;
    const all = byCost(groupBy(source, dimensionKey[dimension]));
    return limit ? all.slice(0, limit) : all;
}

const sessionInfo = (rows: PricedRow[], id: string) => {
    const r = rows.find((x) => x.s === id);
    return { project: r?.p ?? '', machine: r?.machine ?? '' };
};

export function dimensionReport(rows: PricedRow[], dimension: Dimension, limit?: number): Report {
    const c = L().col;
    const groups = dimensionGroups(rows, dimension, limit);
    if (dimension === 'sessions')
        return {
            cols: [col(c.session, 'text'), col(c.project, 'text'), col(c.machine, 'text'), col(c.first, 'text'), col(c.last, 'text'),
                col(c.calls, 'int'), col(c.avgContext, 'tok'), col(c.cost, 'usd')],
            rows: groups.map(([id, t]) => {
                const { project, machine } = sessionInfo(rows, id);
                const { first, last } = span(t);
                return [id.slice(0, 8), project, machine, first, last, at(t, T.calls), avgContext(t.t), t.cost];
            }),
        };
    const grand = totals(rows);
    const name = { models: c.model, machines: c.machine, projects: c.project, agents: c.agent, skills: c.skill, mcp: c.mcp }[dimension];
    const nums = (t: Totals): Cell[] => [at(t, T.calls), avgContext(t.t), at(t, T.read), at(t, T.output), t.cost, pctOf(t.cost, grand.cost)];
    return {
        cols: [col(name, 'text'), col(c.calls, 'int'), col(c.avgContext, 'tok'), col(c.cacheRead, 'tok'), col(c.output, 'tok'), col(c.cost, 'usd'), col(c.share, 'pct')],
        rows: groups.map(([key, t]) => [dimension === 'agents' ? agentLabel(key) : key, ...nums(t)]),
        foot: [c.total, ...nums(grand)],
    };
}

export function dimensionJson(rows: PricedRow[], dimension: Dimension, limit?: number) {
    return {
        [dimension]: dimensionGroups(rows, dimension, limit).map(([key, t]) => ({
            [singular[dimension]]: key,
            ...(dimension === 'sessions' && { ...sessionInfo(rows, key), ...span(t) }),
            ...toJson(t),
        })),
        totals: toJson(totals(rows)),
    };
}

// ---------- summary

export function summary(rows: PricedRow[]): string {
    const L_ = L(), c = L_.col, grand = totals(rows);
    const costTable = (title: string, groups: [string, Totals][]): Report => ({
        cols: [col(title, 'text'), col(c.cost, 'usd'), col(c.share, 'pct')],
        rows: groups.map(([k, t]) => [k, t.cost, pctOf(t.cost, grand.cost)]),
    });
    const items: [string, number][] = [
        [L_.item.read, grand.c[2]], [L_.item.write, grand.c[1]], [L_.item.output, grand.c[3]], [L_.item.input, grand.c[0]], [L_.item.web, grand.c[4]],
    ];
    return [
        paint('bold', fill(L_.total, { cost: usd(grand.cost), calls: int(at(grand, T.calls)), machines: grand.machines.size })),
        renderTable({ cols: [col(c.month, 'text'), col(c.cost, 'usd')], rows: byKey(groupBy(rows, periodKey.monthly)).map(([k, t]) => [k, t.cost]) }),
        renderTable(costTable(c.machine, byCost(groupBy(rows, dimensionKey.machines)))),
        renderTable(costTable(c.model, byCost(groupBy(rows, modelLabel)))),
        renderTable(costTable(c.project, byCost(groupBy(rows, dimensionKey.projects)).slice(0, 5))),
        renderTable({
            cols: [col(c.item, 'text'), col(c.cost, 'usd'), col(c.share, 'pct')],
            rows: items.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, pctOf(v, grand.cost)]),
        }),
    ].join('\n\n');
}

export function summaryJson(rows: PricedRow[]) {
    return {
        totals: toJson(totals(rows)),
        months: periodJson(rows, 'monthly').monthly,
        machines: dimensionJson(rows, 'machines').machines,
        models: dimensionJson(rows, 'models').models,
        projects: dimensionJson(rows, 'projects').projects,
    };
}

// ---------- insights

const weekdayName = (w: number) =>
    new Intl.DateTimeFormat(lang() === 'tr' ? 'tr-TR' : 'en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + w))); // 2026-01-04 is a Sunday

function topBy<K>(entries: Iterable<[K, number]>): [K, number] | undefined {
    let best: [K, number] | undefined;
    for (const e of entries) if (!best || e[1] > best[1]) best = e;
    return best;
}

export interface InsightInput {
    rows: PricedRow[];
    hours: PricedHour[] | undefined; // undefined when the filters can't apply to hourly data
    limits: MachineLimit[];
    table: PriceTable;
    timezone: string;
}

export function insights({ rows, hours, limits, table: prices, timezone }: InsightInput) {
    const g = totals(rows), t = g.t;
    const dates = [...g.days].sort();
    const calendar = dates.length ? daysBetween(dates[0]!, dates[dates.length - 1]!) : 0;
    // Part of each row's cache reads that went to context beyond 200K tokens, assuming its calls sat at the row's average
    const above200k = rows.reduce((acc, r) => {
        const avg = avgContext(r.t);
        return acc + (avg > 200_000 ? r.c[2] * (1 - 200_000 / avg) : 0);
    }, 0);
    const buckets = [T.ctx50k, T.ctx200k, T.ctx500k, T.ctxOver500k].map((i) => at(g, i));
    const bigSessions = [...groupBy(rows.filter((r) => r.s !== UNKNOWN), (r) => r.s)].sort((a, b) => b[1].c[2] - a[1].c[2]).slice(0, 5);
    const withKey = (key: (r: PricedRow) => string | undefined) =>
        byCost(groupBy(rows.filter((r) => key(r) !== undefined), (r) => key(r)!));
    const models = byCost(groupBy(rows, modelLabel));
    const baseModels = [...new Set(rows.map((r) => r.m))];
    const whatIf = baseModels
        .flatMap((m) => {
            const cost = repriceAs(rows, prices, m);
            return cost === undefined ? [] : [{ model: m, cost }];
        })
        .sort((a, b) => a.cost - b.cost);
    const fast = rows.filter((r) => r.f).reduce((a, r) => a + r.cost, 0);

    const weekdays = new Map<number, number>();
    for (const r of rows) {
        const w = new Date(r.d + 'T00:00:00Z').getUTCDay();
        weekdays.set(w, (weekdays.get(w) ?? 0) + r.cost);
    }
    const hourCost = new Map<number, number>();
    for (const h of hours ?? []) hourCost.set(h.h, (hourCost.get(h.h) ?? 0) + h.cost);
    const busiestDay = topBy(weekdays), busiestHour = topBy(hourCost);

    const clock = localClock(timezone);
    const hits = limits.filter((l) => l.status === 'rejected');
    const hitTypes = new Map<string, number>();
    for (const l of hits) hitTypes.set(l.type, (hitTypes.get(l.type) ?? 0) + 1);
    const lastHit = hits.map((l) => l.ts).sort().pop();
    const localTime = (iso: string) => {
        const k = clock(iso);
        return `${k.d} ${String(k.h).padStart(2, '0')}:${String(k.min).padStart(2, '0')}`;
    };

    const json = {
        cost: round(g.cost),
        calls: at(g, T.calls),
        activeDays: dates.length,
        calendarDays: calendar,
        avgContext: Math.round(avgContext(t)),
        maxContext: at(g, T.maxContext),
        cacheHitRatio: round(cacheHitRatio(t)),
        cacheReadShare: round(pctOf(g.c[2], g.cost) / 100),
        cacheWriteShare: round(pctOf(g.c[1], g.cost) / 100),
        oneHourWriteShare: round(writes(g) ? at(g, T.write1h) / writes(g) : 0),
        contextBuckets: { under50k: buckets[0], from50kTo200k: buckets[1], from200kTo500k: buckets[2], over500k: buckets[3] },
        cacheReadAbove200kEstimate: round(above200k),
        largestContextSessions: bigSessions.map(([id, s]) => ({ session: id, ...sessionInfo(rows, id), calls: at(s, T.calls), avgContext: Math.round(avgContext(s.t)), cacheReadCost: round(s.c[2]), cost: round(s.cost) })),
        agents: withKey(agentOf).map(([k, s]) => ({ agent: k, cost: round(s.cost), calls: at(s, T.calls) })),
        skills: withKey((r) => r.k).map(([k, s]) => ({ skill: k, cost: round(s.cost), calls: at(s, T.calls) })),
        mcp: withKey((r) => r.x).map(([k, s]) => ({ mcp: k, cost: round(s.cost), calls: at(s, T.calls) })),
        effort: withKey((r) => r.e).map(([k, s]) => ({ effort: k, cost: round(s.cost), calls: at(s, T.calls) })),
        models: models.map(([k, s]) => ({ model: k, cost: round(s.cost) })),
        sameTokensOn: whatIf.map((w) => ({ model: w.model, cost: round(w.cost) })),
        fastModeCost: round(fast),
        thinkingShareOfOutput: round(at(g, T.output) ? at(g, T.thinking) / at(g, T.output) : 0),
        busiestWeekday: busiestDay && { weekday: weekdayName(busiestDay[0]), cost: round(busiestDay[1]) },
        busiestHour: busiestHour && { hour: busiestHour[0], cost: round(busiestHour[1]) },
        rateLimitHits: { total: hits.length, byType: Object.fromEntries(hitTypes), last: lastHit },
    };

    const I = L().ins, c = L().col;
    const pct = (v: number) => v.toFixed(1) + '%';
    const out: string[] = [];
    const section = (title: string, lines: string[]) => out.push(paint('bold', title) + '\n' + lines.join('\n'));
    const kv = (pairs: [string, string][]) => {
        const w = Math.max(...pairs.map(([k]) => k.length));
        return pairs.map(([k, v]) => '  ' + paint('dim', k.padEnd(w)) + '  ' + v);
    };
    const shareTable = (title: string, groups: [string, Totals][]) =>
        renderTable({ cols: [col(title, 'text'), col(c.calls, 'int'), col(c.cost, 'usd'), col(c.share, 'pct')], rows: groups.map(([k, s]) => [k, at(s, T.calls), s.cost, pctOf(s.cost, g.cost)]) });

    section(I.overview, kv([
        [I.cost, usd(g.cost)],
        [I.calls, `${int(at(g, T.calls))}  (${fill(I.perCall, { cost: usd(g.cost / (at(g, T.calls) || 1)) })})`],
        [I.activeDays, fill(I.activeOf, { active: dates.length, calendar })],
        [I.avgContext, fill(I.avgContextValue, { avg: tokens(avgContext(t)), max: tokens(at(g, T.maxContext)) })],
    ]));
    section(I.cache, kv([
        [I.hitRatio, fill(I.hitRatioValue, { pct: pct(cacheHitRatio(t) * 100) })],
        [I.readShare, fill(I.ofCost, { pct: pct(pctOf(g.c[2], g.cost)) })],
        [I.writeShare, fill(I.oneHour, { pct: pct(pctOf(g.c[1], g.cost)), tier: pct(pctOf(at(g, T.write1h), writes(g))) })],
    ]));
    const bucketTotal = buckets.reduce((a, b) => a + b, 0);
    if (bucketTotal)
        section(I.contextSize, [
            renderTable({ cols: [col(c.context, 'text'), col(c.calls, 'int'), col(c.share, 'pct')], rows: buckets.map((b, i) => [I.bucket[i]!, b, pctOf(b, bucketTotal)]) }),
            fill(I.above200k, { cost: usd(above200k) }),
            paint('dim', I.contextTip),
        ]);
    if (bigSessions.length)
        section(I.bigSessions, [renderTable({
            cols: [col(c.session, 'text'), col(c.project, 'text'), col(c.calls, 'int'), col(c.avgContext, 'tok'), col(c.readCost, 'usd'), col(c.cost, 'usd')],
            rows: bigSessions.map(([id, s]) => [id.slice(0, 8), sessionInfo(rows, id).project, at(s, T.calls), avgContext(s.t), s.c[2], s.cost]),
        })]);
    section(I.agents, [shareTable(c.agent, withKey(agentOf).map(([k, s]) => [agentLabel(k), s]))]);
    const skills = withKey((r) => r.k), mcps = withKey((r) => r.x), efforts = withKey((r) => r.e);
    if (skills.length) section(I.skills, [shareTable(c.skill, skills.slice(0, 5))]);
    if (mcps.length) section(I.mcp, [shareTable(c.mcp, mcps.slice(0, 5))]);
    if (efforts.length) section(I.effort, [shareTable(c.effort, efforts)]);
    section(I.models, [
        shareTable(c.model, models),
        ...(whatIf.length > 1 ? whatIf.map((w) => fill(I.whatIf, { model: w.model, cost: usd(w.cost) })) : []),
        ...kv([
            ...(fast ? [[I.fast, `${usd(fast)} (${pct(pctOf(fast, g.cost))})`] as [string, string]] : []),
            [I.thinking, fill(I.thinkingValue, { pct: pct(pctOf(at(g, T.thinking), at(g, T.output))) })],
        ]),
    ]);
    const when: [string, string][] = [];
    if (busiestDay) when.push([I.weekday, `${weekdayName(busiestDay[0])} (${usd(busiestDay[1])})`]);
    if (busiestHour) when.push([I.hour, `${String(busiestHour[0]).padStart(2, '0')}:00–${String((busiestHour[0] + 1) % 24).padStart(2, '0')}:00 (${usd(busiestHour[1])})`]);
    if (when.length) section(I.when, kv(when));
    section(I.limits, ['  ' + (hits.length
        ? fill(I.limitsValue, { n: hits.length, types: [...hitTypes].map(([k, v]) => `${k}: ${v}`).join(', '), last: localTime(lastHit!) })
        : I.noLimits)]);

    return { text: out.join('\n\n'), json };
}

// ---------- plan

// Limit events filtered to the rows' date range, by local date
export function limitsInRange(limits: MachineLimit[], timezone: string, since?: string, until?: string, machines?: (m: string) => boolean) {
    const clock = localClock(timezone);
    return limits.filter((l) => {
        const d = clock(l.ts).d;
        return (!since || d >= since) && (!until || d <= until) && (!machines || machines(l.machine));
    });
}

export function planReport(rows: PricedRow[], limits: MachineLimit[], opts: { timezone: string; plan?: string }) {
    const c = L().col, P = L().plan;
    const dates = [...new Set(rows.map((r) => r.d))].sort();
    const first = dates[0] ?? '', last = dates[dates.length - 1] ?? '';
    const clock = localClock(opts.timezone);
    const hitsIn = (month?: string) => limits.filter((l) => l.status === 'rejected' && (!month || clock(l.ts).d.startsWith(month))).length;
    const plans = Object.entries(PLANS);
    const line = (label: string, days: number, cost: number, hits: number): Cell[] => {
        const perMonth = days ? (cost / days) * 30 : 0;
        return [label, days, cost, perMonth, ...plans.map(([, price]) => perMonth / price), hits];
    };
    const months = byKey(groupBy(rows, (r) => r.d.slice(0, 7))).map(([m, t]) => {
        // calendar days of the month that fall inside the recorded range; idle days count, days before the first record don't
        const [y, mo] = m.split('-').map(Number) as [number, number];
        const monthEnd = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
        const from = m + '-01' > first ? m + '-01' : first;
        const to = monthEnd < last ? monthEnd : last;
        return line(m, daysBetween(from, to), t.cost, hitsIn(m));
    });
    const grand = totals(rows);
    const foot = line(c.total, first ? daysBetween(first, last) : 0, grand.cost, hitsIn());
    const planName: Record<string, string> = { pro: 'Pro', max5x: 'Max 5x', max20x: 'Max 20x' };
    const report: Report = {
        cols: [col(c.month, 'text'), col(c.days, 'int'), col(c.cost, 'usd'), col(c.perMonth, 'usd'),
            ...plans.map(([k, price]) => col(`${planName[k] ?? k} ($${price})`, 'x')), col(c.limitHits, 'int')],
        rows: months,
        foot,
    };
    const perMonth = foot[3] as number;
    const price = opts.plan ? PLANS[opts.plan] : undefined;
    const notes = [
        price ? fill(P.yours, { plan: planName[opts.plan!] ?? opts.plan!, price, multiple: (perMonth / price).toFixed(1) }) : P.noPlan,
        paint('dim', P.note),
    ];
    const json = {
        months: months.map((r) => ({ month: r[0], days: r[1], cost: round(r[2] as number), per30Days: round(r[3] as number), limitHits: r[r.length - 1] })),
        total: { days: foot[1], cost: round(grand.cost), per30Days: round(perMonth), limitHits: foot[foot.length - 1] },
        multiples: Object.fromEntries(plans.map(([k, p]) => [k, round(perMonth / p)])),
        plan: opts.plan ?? null,
    };
    return { report, notes, json };
}

// ---------- 5-hour blocks

// Claude's usage limits reset in 5-hour windows that start with the first message. With hourly data a
// window starts at the top of its first active hour, and the next activity after it closes opens a new one.
export function blocksReport(hours: PricedHour[], limits: MachineLimit[], opts: { timezone: string; limit?: number; now?: Date }): Report {
    const c = L().col;
    const clock = localClock(opts.timezone);
    const index = (d: string, h: number) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), h) / 36e5;
    const label = (i: number) => new Date(i * 36e5).toISOString().slice(0, 13).replace('T', ' ') + ':00';

    const byHour = new Map<number, { cost: number; calls: number; tokens: number }>();
    for (const h of hours) {
        const k = index(h.d, h.h);
        const acc = byHour.get(k) ?? { cost: 0, calls: 0, tokens: 0 };
        acc.cost += h.cost;
        acc.calls += h.t[T.calls] ?? 0;
        acc.tokens += contextTokens(h.t) + (h.t[T.output] ?? 0);
        byHour.set(k, acc);
    }
    const blocks: { start: number; cost: number; calls: number; tokens: number; hits: number }[] = [];
    for (const k of [...byHour.keys()].sort((a, b) => a - b)) {
        let b = blocks[blocks.length - 1];
        if (!b || k >= b.start + 5) blocks.push((b = { start: k, cost: 0, calls: 0, tokens: 0, hits: 0 }));
        const v = byHour.get(k)!;
        b.cost += v.cost;
        b.calls += v.calls;
        b.tokens += v.tokens;
    }
    for (const l of limits) {
        if (l.status !== 'rejected') continue;
        const k = clock(l.ts), i = index(k.d, k.h);
        const b = blocks.find((x) => i >= x.start && i < x.start + 5);
        if (b) b.hits++;
    }
    const now = clock((opts.now ?? new Date()).toISOString());
    const nowAt = index(now.d, now.h) + now.min / 60;
    const shown = opts.limit ? blocks.slice(-opts.limit) : blocks;
    return {
        cols: [col(c.start, 'text'), col(c.end, 'text'), col(c.calls, 'int'), col(c.tokens, 'tok'), col(c.cost, 'usd'), col(c.limitHits, 'int'), col(c.state, 'text')],
        rows: shown.map((b) => {
            const left = b.start + 5 - nowAt;
            const active = nowAt >= b.start && left > 0;
            const state = active ? fill(L().blocks.active, { left: `${Math.floor(left)}h ${Math.round((left % 1) * 60)}m` }) : '';
            return [label(b.start), label(b.start + 5), b.calls, b.tokens, b.cost, b.hits, state];
        }),
        foot: [c.total, '', shown.reduce((a, b) => a + b.calls, 0), shown.reduce((a, b) => a + b.tokens, 0), shown.reduce((a, b) => a + b.cost, 0), shown.reduce((a, b) => a + b.hits, 0), ''],
    };
}
