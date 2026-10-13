import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from './tmp.ts';
import type { PricedRow } from '../src/aggregate.ts';
import { writeDashboard, type DashboardMeta } from '../src/dashboard.ts';
import { T_LEN } from '../src/types.ts';

const row = (account: string, cost: number): PricedRow => ({
    d: '2026-09-10', p: 'app', s: 's1', m: 'claude-opus-5', machine: 'pc', account, accountName: account,
    t: [0, 0, 0, 0, 0, 1, ...new Array(T_LEN - 6).fill(0)], c: [cost, 0, 0, 0, 0], cost,
});

const meta: DashboardMeta = {
    lang: 'en', timezone: 'UTC', planPrice: 100, accounts: { Personal: { plan: 'Max 5x', price: 100 }, Work: { plan: 'Sponsored / free', price: 0 } },
    updated: '2026-09-10T00:00:00Z', machines: 1, first: '2026-09-10', last: '2026-09-10', prices: 'bundled', version: '0', repo: '', npm: '', site: '',
};

test('dashboard: the page reads the account from where encode() puts it, and gets each account\'s plan', () => {
    const file = writeDashboard({ rows: [row('Personal', 3), row('Work', 1)], limits: [] }, meta, path.join(tempDir('cc-cost-dash-'), 'dashboard.html'));
    const html = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(html.match(/const DATA = (.*);\n/)![1]!);
    const at = Number(html.match(/const R = \{[^}]*account: (\d+)/)![1]);
    assert.deepEqual(data.accounts, ['Personal', 'Work']);
    assert.deepEqual(data.rows.map((r: number[]) => data.accounts[r[at]!]), ['Personal', 'Work'], 'R.account points at the account column');
    assert.equal(data.rows[0].length, at + 1, 'the account column is the last one, appended');
    assert.deepEqual(JSON.parse(html.match(/const META = (.*);\n/)![1]!).accounts, meta.accounts);
});
