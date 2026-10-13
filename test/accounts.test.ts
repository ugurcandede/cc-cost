import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from './tmp.ts';
import { detectAccount, planOf } from '../src/accounts.ts';
import { applyFilter, priceRows } from '../src/aggregate.ts';
import { planPrice } from '../src/config.ts';
import { BUNDLED } from '../src/pricing.ts';
import { scan } from '../src/scan.ts';
import { emptySnapshot, merge } from '../src/snapshot.ts';
import { T_LEN, UNKNOWN, type Row, type Snapshot } from '../src/types.ts';

// A Claude Code folder logged in to the given account
function claudeDir(oauthAccount?: object): string {
    const dir = path.join(tempDir('cc-cost-acct-'), '.claude-work');
    fs.mkdirSync(path.join(dir, 'projects', 'app'), { recursive: true });
    if (oauthAccount) fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount, emailAddress: 'me@example.com' }));
    return dir;
}

const max5x = { accountUuid: 'u1', organizationUuid: 'o1', emailAddress: 'me@example.com', organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_5x' };

test('plan from the login: Max, Pro, and a guess for Team', () => {
    assert.equal(planOf(max5x), 'max5x');
    assert.equal(planOf({ organizationType: 'claude_max', organizationRateLimitTier: 'default_claude_max_20x' }), 'max20x');
    assert.equal(planOf({ organizationType: 'claude_pro' }), 'pro');
    // the Team seat seen on a real login: Max 5x-level limits, so most likely Premium
    assert.equal(planOf({ organizationType: 'claude_team', seatTier: 'team_tier_1', organizationRateLimitTier: 'default_raven', userRateLimitTier: 'default_claude_max_5x' } as object), 'teamPremium');
    assert.equal(planOf({ organizationType: 'claude_team', organizationRateLimitTier: 'default_raven' }), 'teamStandard');
    assert.equal(planOf({ organizationType: 'something_new' }), undefined);
});

test('account id: a hash of the login ids, never the e-mail, the same on every machine', () => {
    const a = detectAccount(claudeDir(max5x));
    const again = detectAccount(claudeDir(max5x));
    assert.match(a.id, /^a[0-9a-f]{10}$/);
    assert.equal(a.id, again.id, 'same login in another folder or machine');
    assert.notEqual(detectAccount(claudeDir({ ...max5x, organizationUuid: 'o2' })).id, a.id, 'another organization is another account');
    assert.equal(a.plan, 'max5x');
    assert.equal(a.folder, '.claude-work');
    assert.ok(!JSON.stringify(a).includes('example.com'));
});

test('a folder without a login stands for its own account', () => {
    const a = detectAccount(claudeDir());
    assert.match(a.id, /^d[0-9a-f]{10}$/);
    assert.equal(a.plan, undefined);
});

test('scan tags rows, hours and limit events with the folder\'s account', async () => {
    const dir = claudeDir(max5x);
    const line = (o: object) => JSON.stringify(o);
    fs.writeFileSync(path.join(dir, 'projects', 'app', 's.jsonl'), [
        line({ type: 'assistant', requestId: 'r1', timestamp: '2026-09-10T10:00:00Z', sessionId: 's', cwd: '/app', message: { id: 'm1', model: 'claude-opus-5', usage: { input_tokens: 1, output_tokens: 1 } } }),
        line({ timestamp: '2026-09-10T11:00:00Z', quotaLimits: { rateLimitType: 'five_hour', status: 'rejected', resetsAt: 1 } }),
    ].join('\n'));
    const r = await scan([dir], { timezone: 'UTC', anonymize: false, accounts: { [dir]: 'a1' } });
    assert.equal(r.rows[0]!.ac, 'a1');
    assert.equal(r.hourly[0]!.ac, 'a1');
    assert.equal(r.limits[0]!.ac, 'a1');
});

const row = (d: string, ac?: string): Row => ({ d, p: 'app', s: 's', m: 'claude-opus-5', ...(ac && { ac }), t: [1000, 0, 0, 0, 1000, 1, ...new Array(T_LEN - 6).fill(0)] });

test('merge keeps the notes of accounts read before, for the rows still pointing at them', () => {
    const prev: Snapshot = { ...emptySnapshot('pc', 'UTC'), accounts: { old: { name: 'Old', plan: 'pro' } } };
    const scanned = { rows: [row('2026-09-10', 'a1')], hourly: [], sessions: {}, limits: [], files: 1, duplicates: 0 };
    const next = merge(prev, scanned, '2026-09-01', { machine: 'pc', timezone: 'UTC', accounts: { a1: { name: 'Max', plan: 'max5x' } }, unassigned: 'a1' });
    assert.deepEqual(next.accounts, { old: { name: 'Old', plan: 'pro' }, a1: { name: 'Max', plan: 'max5x' } });
    assert.equal(next.unassigned, 'a1');
});

test('rows from before accounts go to the account the user chose, else stay unknown', () => {
    const snap = (machine: string, unassigned?: string): Snapshot => ({
        ...emptySnapshot(machine, 'UTC'),
        updated: '2026-09-10T00:00:00Z',
        rows: [row('2026-09-01'), row('2026-09-10', 'team')],
        accounts: { max: { name: 'Max', plan: 'max5x' }, team: { folder: '.claude-team', plan: 'teamPremium' } },
        ...(unassigned && { unassigned }),
    });
    const { rows, accounts } = priceRows([snap('pc', 'max'), snap('mac')], BUNDLED);
    assert.deepEqual(rows.map((r) => `${r.machine}:${r.accountName}`), ['pc:Max', 'pc:claude-team', 'mac:' + UNKNOWN, 'mac:claude-team']);
    assert.deepEqual(accounts.get('team')?.machines, ['pc', 'mac']);
    assert.deepEqual(applyFilter(rows, { account: ['team'] }).map((r) => r.machine), ['pc', 'mac'], 'filter by the name shown');
});

test('plan price: list price, own price, sponsored seat', () => {
    assert.equal(planPrice('max5x'), 100);
    assert.equal(planPrice('teamPremium', 100), 100, 'an annual or negotiated price wins');
    assert.equal(planPrice('free'), 0);
    assert.equal(planPrice(undefined), undefined);
});
