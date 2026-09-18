import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { priceRows } from '../src/aggregate.ts';
import { BUNDLED, loadPrices, modelId, parsePricingPage, priceFor } from '../src/pricing.ts';
import { emptySnapshot } from '../src/snapshot.ts';

// Trimmed copy of the structure of https://platform.claude.com/docs/en/about-claude/pricing.md
const PAGE = `
## Model pricing

| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
| :---- | :---- | :---- | :---- | :---- | :---- |
| Claude Fable 5.1 | $10 / MTok | $12.50 / MTok | $20 / MTok | $0.25 / MTok<sup>1</sup> | $50 / MTok |
| Claude Mythos 5.1 ([limited availability](https://anthropic.com/glasswing)) | $10 / MTok | $12.50 / MTok | $20 / MTok | $0.25 / MTok<sup>1</sup> | $50 / MTok |
| Claude Opus 5 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |
| Claude Opus 4.8 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |
| Claude Sonnet 5 | $2 / MTok | $2.50 / MTok | $4 / MTok | $0.20 / MTok | $10 / MTok |
| Claude Haiku 3.5 ([retired, except on Bedrock and Google Cloud](https://x)) | $0.80 / MTok | $1 / MTok | $1.60 / MTok | $0.08 / MTok | $4 / MTok |

## Cloud platform pricing

| Model | Batch input | Batch output |
| Claude Opus 5 | $2.50 / MTok | $12.50 / MTok |

### Fast mode pricing

| Model | Input | Output |
| ------------------------------- | ---------- | ---------- |
| Claude Opus 5 / Claude Opus 4.8 | $10 / MTok | $50 / MTok |

Web search is available on the Claude API for **$10 per 1,000 searches**, plus standard token costs.
`;

test('model names map to ids', () => {
    assert.equal(modelId('Claude Opus 4.8'), 'claude-opus-4-8');
    assert.equal(modelId('Claude Opus 4'), 'claude-opus-4');
    assert.equal(modelId('Claude Fable 5.1'), 'claude-fable-5-1');
    assert.equal(modelId('Claude Haiku 3.5 ([retired](https://x))'), 'claude-3-5-haiku');
    assert.equal(modelId('Model'), undefined);
});

test('pricing page parses: base, fast with cache multipliers, web search', () => {
    const t = parsePricingPage(PAGE, '2026-09-18T00:00:00Z')!;
    assert.deepEqual(t.models['claude-fable-5-1'], [10, 12.5, 20, 0.25, 50]);
    assert.deepEqual(t.models['claude-mythos-5-1'], [10, 12.5, 20, 0.25, 50]);
    assert.deepEqual(t.models['claude-3-5-haiku'], [0.8, 1, 1.6, 0.08, 4]);
    assert.deepEqual(t.fast['claude-opus-5'], [10, 12.5, 20, 1, 50]);
    assert.deepEqual(t.fast['claude-opus-4-8'], [10, 12.5, 20, 1, 50]);
    assert.equal(t.webSearch, 0.01);
    // the batch table under another heading must not leak into base prices
    assert.equal(t.models['claude-opus-5']![0], 5);
});

test('an unrecognizable page is rejected, not half-parsed', () => {
    assert.equal(parsePricingPage('## Model pricing\n| Claude Opus 5 | $5 / MTok |', 'x'), undefined);
});

test('the parsed live page agrees with the bundled table', () => {
    const t = parsePricingPage(PAGE, 'x')!;
    for (const [m, p] of Object.entries(t.models)) assert.deepEqual(p, BUNDLED.models[m], m);
});

test('overrides win; fast rows use fast prices', () => {
    assert.deepEqual(priceFor(BUNDLED, 'claude-opus-5', false, { 'claude-opus-5': [1, 1, 1, 1, 1] }), [1, 1, 1, 1, 1]);
    assert.equal(priceFor(BUNDLED, 'claude-opus-5', true)![4], 50);
    assert.equal(priceFor(BUNDLED, 'claude-opus-4-7', true), undefined);
});

test('row cost: every token type at its own rate', () => {
    // Opus 5: 1M each of input, 5m write, 1h write, read, output + 100 searches
    const snap = { ...emptySnapshot('pc', 'UTC'), rows: [{ d: '2026-09-10', p: 'a', s: 's', m: 'claude-opus-5', t: [1e6, 1e6, 1e6, 1e6, 1e6, 1, 0, 100, 0, 0] }] };
    const { rows } = priceRows([snap], BUNDLED);
    assert.deepEqual(rows[0]!.c, [5, 16.25, 0.5, 25, 1]);
    assert.equal(rows[0]!.cost, 47.75);
});

test('unknown models are reported, not priced as zero', () => {
    const snap = { ...emptySnapshot('pc', 'UTC'), rows: [{ d: '2026-09-10', p: 'a', s: 's', m: 'claude-opus-9', t: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0] }] };
    const { rows, unknown } = priceRows([snap], BUNDLED);
    assert.equal(rows.length, 0);
    assert.deepEqual([...unknown], ['claude-opus-9']);
});

test('loadPrices: offline without a cache falls back to the bundled table and says why', async () => {
    const cache = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cost-price-')), 'cache.json');
    const r = await loadPrices(cache, { offline: true });
    assert.equal(r.table.source, 'bundled');
    assert.equal(r.note, 'offline');
});

test('loadPrices: a fresh cache is used as is, bundled models fill its gaps', async () => {
    const cache = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cost-price-')), 'cache.json');
    const live = { date: new Date().toISOString(), source: 'live', models: { 'claude-opus-5': [9, 9, 9, 9, 9] }, fast: {}, webSearch: 0.02 };
    fs.writeFileSync(cache, JSON.stringify(live));
    const r = await loadPrices(cache);
    assert.equal(r.note, undefined);
    assert.deepEqual(r.table.models['claude-opus-5'], [9, 9, 9, 9, 9]);
    assert.deepEqual(r.table.models['claude-opus-4'], BUNDLED.models['claude-opus-4']);
    assert.equal(r.table.webSearch, 0.02);
});
