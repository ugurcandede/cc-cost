import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Account, PricedHour, PricedRow } from '../src/aggregate.ts';
import { blocksReport, dimensionReport, periodReport, planReport, renderCsv } from '../src/reports.ts';
import { T_LEN, UNKNOWN } from '../src/types.ts';

const counters = (calls: number) => {
    const t = new Array(T_LEN).fill(0);
    t[5] = calls;
    return t;
};
const row = (over: Partial<PricedRow>): PricedRow => ({
    d: '2026-09-10', p: 'app', s: 's1', m: 'claude-opus-5', machine: 'pc', account: UNKNOWN, accountName: UNKNOWN, t: counters(1), c: [0, 0, 1, 0, 0], cost: 1,
    ...over,
});
const hour = (d: string, h: number, cost: number, account = UNKNOWN): PricedHour => ({
    d, h, m: 'claude-opus-5', machine: 'pc', account, accountName: account, t: counters(1), cost,
});
const noAccounts = new Map<string, Account>();

test('blocks: a window opens at the first active hour and lasts 5 hours', () => {
    const r = blocksReport(
        [hour('2026-09-10', 9, 1), hour('2026-09-10', 13, 2), hour('2026-09-10', 14, 4), hour('2026-09-10', 16, 8)],
        [{ ts: '2026-09-10T15:30:00Z', type: 'five_hour', status: 'rejected', machine: 'pc', account: UNKNOWN, accountName: UNKNOWN }],
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
    const p = planReport([row({ d: '2026-08-20', cost: 12 }), row({ d: '2026-09-05', cost: 5 })], [], { timezone: 'UTC', plan: 'max5x', accounts: noAccounts });
    assert.deepEqual(p.report.rows.map((r) => [r[0], r[1]]), [['2026-08', 12], ['2026-09', 5]]);
    assert.equal(p.report.foot![1], 17);
    assert.equal(p.json.total.per30Days, 30); // $17 over 17 days
    assert.equal(p.json.multiples.max5x, 0.3);
});

test('plan: each account against its own plan; the total against the paid plans only', () => {
    const account = (id: string, plan: string): Account => ({ id, label: id, plan, machines: ['pc'] });
    const accounts = new Map([['max', account('max', 'max5x')], ['team', account('team', 'teamPremium')]]);
    accounts.get('team')!.price = 0; // a sponsored seat
    const own = (ac: string, d: string, cost: number) => row({ d, cost, account: ac, accountName: ac });
    // 30 days each: Max costs $50 against $100, the sponsored Team seat $300
    const rows = [own('max', '2026-09-01', 20), own('max', '2026-09-30', 30), own('team', '2026-09-01', 100), own('team', '2026-09-30', 200)];
    const hits = [{ ts: '2026-09-10T10:00:00Z', type: 'five_hour', status: 'rejected', machine: 'pc', account: 'team', accountName: 'team' }];
    const p = planReport(rows, hits, { timezone: 'UTC', plan: 'max20x', accounts });
    assert.deepEqual(p.json.accounts.map((a) => [a.account, a.plan, a.price, a.per30Days, a.multiple, a.limitHits]), [
        ['team', 'teamPremium', 0, 300, null, 1],
        ['max', 'max5x', 100, 50, 0.5, 0],
    ]);
    assert.deepEqual(p.json.paid, { price: 100, per30Days: 50, multiple: 0.5 });
    assert.match(p.notes.join('\n'), /team/, 'the sponsored seat is named as left out');
    assert.ok(p.report.cols.some((c) => c.title.startsWith('Team')), 'an account on Team brings the Team columns');
    assert.ok(!planReport([row({})], [], { timezone: 'UTC', plan: 'max5x', accounts: noAccounts }).report.cols.some((c) => c.title.startsWith('Team')));
    // rows from before accounts fall back to the configured plan
    assert.equal(planReport([row({})], [], { timezone: 'UTC', plan: 'max20x', accounts }).json.accounts[0]!.price, 200);
});

test('blocks: every account has its own 5-hour windows and its own limit hits', () => {
    const limit = { ts: '2026-09-10T10:30:00Z', type: 'five_hour', status: 'rejected', machine: 'pc', account: 'team', accountName: 'team' };
    const r = blocksReport([hour('2026-09-10', 9, 1, 'max'), hour('2026-09-10', 10, 2, 'team'), hour('2026-09-10', 13, 4, 'max')], [limit], {
        timezone: 'UTC', now: new Date('2026-09-11T00:00:00Z'),
    });
    assert.equal(r.cols[0]!.title, 'Account');
    // max's window from 09:00 takes its 13:00 hour; team's opens at 10:00 on its own and gets the hit
    assert.deepEqual(r.rows.map((x) => [x[0], x[1], x[5], x[6]]), [['max', '2026-09-10 09:00', 5, 0], ['team', '2026-09-10 10:00', 2, 1]]);
});

test('accounts: cost per account, by the name shown', () => {
    const r = dimensionReport([row({ account: 'a', accountName: 'Max', cost: 3 }), row({ account: 'b', accountName: 'Team', cost: 1 })], 'accounts');
    assert.deepEqual(r.rows.map((x) => [x[0], x[5]]), [['Max', 3], ['Team', 1]]);
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
