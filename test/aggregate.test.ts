import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyFilter, groupBy, weekOf, type PricedRow } from '../src/aggregate.ts';

const row = (over: Partial<PricedRow>): PricedRow => ({
    d: '2026-09-10', p: 'app', s: 'abcdef12-0000', m: 'claude-opus-5', machine: 'work-pc',
    t: [0, 0, 0, 0, 0, 1, 0, 0, 0, 0], c: [0, 0, 1, 0, 0], cost: 1, ...over,
});

test('filters: dates inclusive, names by substring, sessions by prefix', () => {
    const rows = [
        row({}),
        row({ d: '2026-09-12', m: 'claude-fable-5-1', machine: 'macbook' }),
        row({ s: 'zzzz', p: 'other' }),
    ];
    assert.equal(applyFilter(rows, { since: '2026-09-10', until: '2026-09-10' }).length, 2);
    assert.equal(applyFilter(rows, { model: ['FABLE'] }).length, 1);
    assert.equal(applyFilter(rows, { machine: ['macbook'] }).length, 1);
    assert.equal(applyFilter(rows, { session: ['abcdef'] }).length, 2);
    assert.equal(applyFilter(rows, { project: ['app', 'oth'] }).length, 3);
});

test('fast rows filter and group under their own label', () => {
    const rows = [row({}), row({ f: 1 })];
    assert.equal(applyFilter(rows, { model: ['fast'] }).length, 1);
    assert.deepEqual([...groupBy(rows, (r) => (r.f ? r.m + '-fast' : r.m)).keys()], ['claude-opus-5', 'claude-opus-5-fast']);
});

test('groupBy sums counters but keeps the max context', () => {
    const g = groupBy([row({ t: [0, 0, 0, 0, 0, 2, 0, 0, 0, 500] }), row({ t: [0, 0, 0, 0, 0, 3, 0, 0, 0, 900] })], () => 'all').get('all')!;
    assert.equal(g.t[5], 5);
    assert.equal(g.t[9], 900);
    assert.equal(g.cost, 2);
});

test('weeks start on Monday', () => {
    assert.equal(weekOf('2026-09-18'), '2026-09-14'); // Friday
    assert.equal(weekOf('2026-09-14'), '2026-09-14'); // Monday
    assert.equal(weekOf('2026-09-20'), '2026-09-14'); // Sunday
});
