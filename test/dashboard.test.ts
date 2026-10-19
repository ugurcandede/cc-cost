import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { tempDir } from './tmp.ts';
import { renderDashboard, sharedScript, writeDashboard, type DashboardMeta } from '../src/dashboard.ts';
import { emptySnapshot, split } from '../src/months.ts';
import { BUNDLED } from '../src/pricing.ts';
import { T_LEN } from '../src/types.ts';

const meta: DashboardMeta = { version: '2.0.0', repo: '', npm: '', site: '' };

test('dashboard: the embedded modules run outside Node and price a snapshot like the terminal does', () => {
    const script = sharedScript();
    assert.ok(!/\b(import|export|require)\b/.test(script.replace(/\/\/.*$/gm, '')), 'no module syntax left');
    const CC = vm.runInNewContext(script + '\nCC', {});
    const t = new Array(T_LEN).fill(0);
    t[0] = 1e6; t[5] = 1; // 1M uncached input tokens, one call
    const snap = { ...emptySnapshot('pc', 'UTC'), rows: [{ d: '2026-09-10', p: 'app', s: 's1', m: 'claude-opus-5', t }] };
    const { header, months } = split(snap);
    const { rows } = CC.priceRows([CC.join(header, Object.values(months))], CC.withFallback({ ...BUNDLED, overrides: { 'claude-opus-5': [1, 1, 1, 1, 1] } }));
    assert.equal(rows[0].cost, 1, 'the override priced it');
    assert.equal(rows[0].machine, 'pc');
    assert.equal(CC.planPrice('max5x'), 100);
    assert.equal(CC.storedTable(null).source, 'bundled', 'no pricing.json yet');
    assert.equal(CC.fromLegacy({ host: 'old', days: { '2026-08-01': { 'claude-opus-5': [1, 0, 0, 0, 0, 1] } } }, 'x').machine, 'old', 'a cc-cost.mjs file reads in the page too');
    // objects from another realm have another Object prototype, so compare them as JSON
    assert.equal(JSON.stringify(CC.localClock('Europe/Istanbul')('2026-09-10T22:30:00Z')), JSON.stringify({ d: '2026-09-11', h: 1, min: 30 }));
});

test('dashboard: a static page that reads the folder it is in, and says so under file://', () => {
    const html = renderDashboard(meta);
    assert.match(html, /<meta name="cc-cost-version" content="2.0.0">/);
    assert.ok(html.includes("get('machines/index.json')") && html.includes("get('pricing.json')"));
    assert.ok(html.includes('CC.fromLegacy('), 'a machine still on cc-cost.mjs is read from its file in the root');
    assert.ok(html.includes("location.protocol === 'file:'"));
    // no usage is embedded: the page has the data lists only as empty state
    assert.ok(html.includes('let ROWS = [];'));
    // accounts are picked with buttons and shown as cards, not through a select
    assert.ok(html.includes('id="accountRow"') && html.includes('id="accts"') && !html.includes('id="fAccount"'));
    // the filter rows: account, then scope and breakdown, then the period
    const labels = [...html.matchAll(/class="flabel grp"[^>]*data-t="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(labels, ['account', 'scope', 'breakdown', 'groupBy', 'period']);
});

test('dashboard: written once per version, never over a newer one', () => {
    const file = path.join(tempDir('cc-cost-dash-'), 'dashboard.html');
    assert.equal(writeDashboard(file, meta), true);
    assert.equal(writeDashboard(file, meta), false, 'the same page again');
    assert.equal(writeDashboard(file, { ...meta, version: '2.1.0' }), true, 'a newer cc-cost replaces it');
    assert.equal(writeDashboard(file, meta), false, 'an older cc-cost leaves the newer page');
    assert.match(fs.readFileSync(file, 'utf8'), /content="2.1.0"/);
});
