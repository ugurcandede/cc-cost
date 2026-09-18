import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from './tmp.ts';
import type { ScanResult } from '../src/scan.ts';
import { emptySnapshot, fromLegacy, loadAll, merge, save } from '../src/snapshot.ts';
import { T_LEN, type Row } from '../src/types.ts';

const row = (d: string, calls: number): Row => {
    const t = new Array(T_LEN).fill(0);
    t[5] = calls;
    return { d, p: 'app', s: 's', m: 'claude-opus-5', t };
};
const scanOf = (rows: Row[]): ScanResult => ({ rows, hourly: [], sessions: {}, limits: [], files: 1, duplicates: 0 });
const meta = { machine: 'pc', timezone: 'UTC' };

test('merge: recent scanned days replace stored ones', () => {
    const prev = { ...emptySnapshot('pc', 'UTC'), rows: [row('2026-09-10', 1)] };
    const next = merge(prev, scanOf([row('2026-09-10', 5)]), '2026-09-01', meta);
    assert.deepEqual(next.rows.map((r) => r.t[5]), [5]);
});

test('merge: a day older than the retention window never overwrites the archive', () => {
    // the scan only still sees a long session reaching into 08-01; the archive has the full day
    const prev = { ...emptySnapshot('pc', 'UTC'), rows: [row('2026-08-01', 40)] };
    const next = merge(prev, scanOf([row('2026-08-01', 3)]), '2026-09-01', meta);
    assert.deepEqual(next.rows.map((r) => r.t[5]), [40]);
});

test('merge: an old day missing from the archive is still filled in', () => {
    const next = merge(emptySnapshot('pc', 'UTC'), scanOf([row('2026-08-01', 3)]), '2026-09-01', meta);
    assert.equal(next.rows.length, 1);
});

test('merge: days the scan no longer sees are kept', () => {
    const prev = { ...emptySnapshot('pc', 'UTC'), rows: [row('2026-07-01', 9)] };
    const next = merge(prev, scanOf([row('2026-09-10', 1)]), '2026-09-01', meta);
    assert.deepEqual(next.rows.map((r) => r.d).sort(), ['2026-07-01', '2026-09-10']);
});

test('legacy snapshots convert, fast rows included', () => {
    const snap = fromLegacy({ host: 'work-pc', days: { '2026-08-10': { 'claude-opus-5': [1, 2, 3, 4, 5, 6], 'claude-opus-5-fast': [0, 0, 0, 0, 1, 1] } } }, 'x');
    assert.equal(snap.machine, 'work-pc');
    assert.deepEqual(snap.rows[0]!.t, [1, 2, 3, 4, 5, 6, ...new Array(T_LEN - 6).fill(0)]);
    assert.equal(snap.rows[1]!.m, 'claude-opus-5');
    assert.equal(snap.rows[1]!.f, 1);
});

test('loadAll: a machine on schema 2 hides its legacy file', () => {
    const dir = tempDir('cc-cost-sync-');
    fs.writeFileSync(path.join(dir, 'pc.json'), JSON.stringify({ host: 'pc', days: { '2026-08-10': { 'claude-opus-5': [0, 0, 0, 0, 0, 1] } } }));
    fs.writeFileSync(path.join(dir, 'mac.json'), JSON.stringify({ host: 'mac', days: { '2026-08-10': { 'claude-opus-5': [0, 0, 0, 0, 0, 1] } } }));
    save(dir, { ...emptySnapshot('pc', 'UTC'), rows: [row('2026-09-10', 2)] });
    const snaps = loadAll(dir);
    assert.deepEqual(snaps.map((s) => s.machine).sort(), ['mac', 'pc']);
    assert.equal(snaps.find((s) => s.machine === 'pc')!.rows[0]!.d, '2026-09-10');
});
