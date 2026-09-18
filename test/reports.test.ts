import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PricedHour, PricedRow } from '../src/aggregate.ts';
import { blocksReport, dimensionReport, periodReport, planReport, renderCsv } from '../src/reports.ts';
import { T_LEN, UNKNOWN } from '../src/types.ts';

const counters = (calls: number) => {
    const t = new Array(T_LEN).fill(0);
    t[5] = calls;
    return t;
};
const row = (over: Partial<PricedRow>): PricedRow => ({
    d: '2026-09-10', p: 'app', s: 's1', m: 'claude-opus-5', machine: 'pc', t: counters(1), c: [0, 0, 1, 0, 0], cost: 1, ...over,
});
const hour = (d: string, h: number, cost: number): PricedHour => ({ d, h, m: 'claude-opus-5', machine: 'pc', t: counters(1), cost });

test('blocks: a window opens at the first active hour and lasts 5 hours', () => {
    const r = blocksReport(
        [hour('2026-09-10', 9, 1), hour('2026-09-10', 13, 2), hour('2026-09-10', 14, 4), hour('2026-09-10', 16, 8)],
        [{ ts: '2026-09-10T15:30:00Z', type: 'five_hour', status: 'rejected', machine: 'pc' }],
        { timezone: 'UTC', now: new Date('2026-09-10T17:30:00Z') },
    );
    assert.deepEqual(r.rows.map((x) => [x[0], x[1], x[4], x[5]]), [
        ['2026-09-10 09:00', '2026-09-10 14:00', 3, 0],
        ['2026-09-10 14:00', '2026-09-10 19:00', 12, 1],
    ]);
    assert.equal(r.rows[0]![6], '');
    assert.match(String(r.rows[1]![6]), /1h 30m/);
});

test('plan: months count calendar days inside the recorded range', () => {
    const p = planReport([row({ d: '2026-08-20', cost: 12 }), row({ d: '2026-09-05', cost: 5 })], [], { timezone: 'UTC', plan: 'max5x' });
    assert.deepEqual(p.report.rows.map((r) => [r[0], r[1]]), [['2026-08', 12], ['2026-09', 5]]);
    assert.equal(p.report.foot![1], 17);
    assert.equal(p.json.total.per30Days, 30); // $17 over 17 days
    assert.equal(p.json.multiples.max5x, 0.3);
});

test('sessions: legacy rows without ids are not listed as a session', () => {
    const r = dimensionReport([row({}), row({ s: UNKNOWN, cost: 100 })], 'sessions');
    assert.deepEqual(r.rows.map((x) => x[0]), ['s1']);
});

test('csv: one row per period and model, raw numbers, quoted text', () => {
    const r = periodReport([row({}), row({ m: 'claude-fable-5-1', cost: 2 })], 'daily', { breakdown: true, flat: true });
    const lines = renderCsv(r).split('\n');
    assert.equal(lines[0], 'Date,Model,Input,Output,Cache write,Cache read,Calls,Cost');
    assert.equal(lines[1], '2026-09-10,claude-fable-5-1,0,0,0,0,1,2');
    assert.equal(renderCsv({ cols: [{ title: 'a', kind: 'text' }], rows: [['x, "y"']] }), 'a\n"x, ""y"""');
});
