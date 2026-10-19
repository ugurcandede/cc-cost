import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from './tmp.ts';
import type { ScanResult } from '../src/scan.ts';
import { emptySnapshot, fromLegacy, join, split } from '../src/months.ts';
import { indexFile, loadAll, loadOwn, merge, save } from '../src/snapshot.ts';
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
    assert.deepEqual(JSON.parse(fs.readFileSync(indexFile(dir), 'utf8')), ['mac', 'pc'], 'the index names the legacy machine too, so the dashboard finds it');
});

test('loadAll: a half-written month file leaves that machine out with a note, not the whole folder', () => {
    const dir = tempDir('cc-cost-sync-');
    save(dir, { ...emptySnapshot('pc', 'UTC'), rows: [row('2026-09-10', 2)] });
    save(dir, { ...emptySnapshot('mac', 'UTC'), rows: [row('2026-09-10', 1)] });
    fs.writeFileSync(path.join(dir, 'machines', 'mac', '2026-09.json'), '{"rows":[');
    const notes: string[] = [];
    const error = console.error;
    console.error = (m: string) => notes.push(m);
    try {
        assert.deepEqual(loadAll(dir).map((s) => s.machine), ['pc']);
    } finally {
        console.error = error;
    }
    assert.match(notes[0]!, /mac\.json/);
    assert.throws(() => loadOwn(dir, 'mac', 'UTC'), 'a machine never merges over its own archive without reading it');
});

test('months: a snapshot splits into one file per month and joins back whole', () => {
    const snap = {
        ...emptySnapshot('pc', 'UTC'), rows: [row('2026-08-31', 1), row('2026-09-01', 2)],
        sessions: { s: { p: 'app', first: '2026-08-31T23:00:00Z', last: '2026-09-01T01:00:00Z' } },
        limits: [{ ts: '2026-09-01T00:30:00Z', type: 'five_hour', status: 'rejected' }],
        accounts: { a1: { name: 'Personal' } },
    };
    const { header, months } = split(snap);
    assert.deepEqual(header.months, ['2026-08', '2026-09']);
    assert.equal(header.accounts!.a1!.name, 'Personal');
    assert.equal(months['2026-08']!.rows.length, 1);
    assert.ok('s' in months['2026-08']!.sessions, 'a session goes by its first call');
    assert.equal(months['2026-09']!.limits.length, 1);
    const back = join(header, [months['2026-09']!, months['2026-08']!]);
    assert.deepEqual(back.rows.map((r) => r.d).sort(), ['2026-08-31', '2026-09-01']);
    assert.deepEqual(back.sessions, snap.sessions);
    assert.equal(back.accounts!.a1!.name, 'Personal');
});

test('save: only the months that changed are rewritten, and the machine joins index.json once', () => {
    const dir = tempDir('cc-cost-sync-');
    save(dir, { ...emptySnapshot('pc', 'UTC'), rows: [row('2026-08-31', 1), row('2026-09-01', 2)] });
    const aug = path.join(dir, 'machines', 'pc', '2026-08.json');
    const before = fs.statSync(aug).mtimeMs;
    const index = fs.statSync(indexFile(dir)).mtimeMs;
    fs.utimesSync(aug, new Date(0), new Date(0)); // any rewrite would make it newer
    save(dir, { ...emptySnapshot('pc', 'UTC'), rows: [row('2026-08-31', 1), row('2026-09-01', 5)] });
    assert.equal(fs.statSync(aug).mtimeMs, 0, 'August was not touched');
    assert.ok(before <= fs.statSync(path.join(dir, 'machines', 'pc', '2026-09.json')).mtimeMs);
    assert.equal(fs.statSync(indexFile(dir)).mtimeMs, index, 'the index is not rewritten');
    assert.deepEqual(JSON.parse(fs.readFileSync(indexFile(dir), 'utf8')), ['pc']);
    assert.deepEqual(loadOwn(dir, 'pc', 'UTC').rows.map((r) => r.t[5]), [1, 5]);
});

test('loadAll: a schema 2 file still reads whole, and a schema 3 machine reads its months', () => {
    const dir = tempDir('cc-cost-sync-');
    fs.mkdirSync(path.join(dir, 'machines'));
    fs.writeFileSync(path.join(dir, 'machines', 'old.json'), JSON.stringify({ ...emptySnapshot('old', 'UTC'), schema: 2, rows: [row('2026-07-01', 3)] }));
    save(dir, { ...emptySnapshot('pc', 'UTC'), rows: [row('2026-09-10', 2)] });
    const snaps = loadAll(dir);
    assert.deepEqual(snaps.map((s) => [s.machine, s.rows.length]).sort(), [['old', 1], ['pc', 1]]);
});
