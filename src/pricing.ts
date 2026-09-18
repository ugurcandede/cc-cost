import fs from 'node:fs';
import path from 'node:path';

// $ per million tokens: [input, cache write 5m, cache write 1h, cache read, output]
export type Price = readonly [number, number, number, number, number];

export interface PriceTable {
    date: string; // when these prices were read
    source: string; // URL, or 'bundled'
    models: Record<string, Price>;
    fast: Record<string, Price>; // fast mode rates; cache multipliers already applied
    webSearch: number; // $ per search
}

export const PRICING_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Fallback when the live page can't be fetched or parsed. Checked against PRICING_URL on 2026-09-18.
export const BUNDLED: PriceTable = {
    date: '2026-09-18',
    source: 'bundled',
    models: {
        'claude-fable-5-1': [10, 12.5, 20, 0.25, 50],
        'claude-mythos-5-1': [10, 12.5, 20, 0.25, 50],
        'claude-fable-5': [10, 12.5, 20, 1, 50],
        'claude-mythos-5': [10, 12.5, 20, 1, 50],
        'claude-opus-5': [5, 6.25, 10, 0.5, 25],
        'claude-opus-4-8': [5, 6.25, 10, 0.5, 25],
        'claude-opus-4-7': [5, 6.25, 10, 0.5, 25],
        'claude-opus-4-6': [5, 6.25, 10, 0.5, 25],
        'claude-opus-4-5': [5, 6.25, 10, 0.5, 25],
        'claude-opus-4-1': [15, 18.75, 30, 1.5, 75],
        'claude-opus-4': [15, 18.75, 30, 1.5, 75],
        'claude-sonnet-5': [2, 2.5, 4, 0.2, 10],
        'claude-sonnet-4-6': [3, 3.75, 6, 0.3, 15],
        'claude-sonnet-4-5': [3, 3.75, 6, 0.3, 15],
        'claude-sonnet-4': [3, 3.75, 6, 0.3, 15],
        'claude-haiku-4-5': [1, 1.25, 2, 0.1, 5],
        'claude-3-5-haiku': [0.8, 1, 1.6, 0.08, 4],
    },
    fast: {
        'claude-opus-5': [10, 12.5, 20, 1, 50],
        'claude-opus-4-8': [10, 12.5, 20, 1, 50],
    },
    webSearch: 0.01,
};

export const normModel = (m: string) => m.replace(/\[1m\]$/, '').replace(/-20\d{6}$/, '');

// "Claude Opus 4.8" -> claude-opus-4-8, "Claude Haiku 3.5 (retired...)" -> claude-3-5-haiku
export function modelId(name: string): string | undefined {
    const clean = name.replace(/<[^>]*>/g, '').replace(/\(.*$/, '').trim().toLowerCase();
    const m = clean.match(/^claude ([a-z]+) (\d+)(?:\.(\d+))?$/);
    if (!m) return undefined;
    const [, family, major, minor] = m;
    const ver = minor ? `${major}-${minor}` : major;
    return Number(major) < 4 ? `claude-${ver}-${family}` : `claude-${family}-${ver}`;
}

const money = (cell: string) => {
    const m = cell.match(/\$([\d.,]+)\s*\/\s*MTok/);
    return m ? Number(m[1]!.replace(/,/g, '')) : NaN;
};

function section(md: string, heading: RegExp): string {
    const start = md.search(heading);
    if (start < 0) return '';
    const rest = md.slice(start + 1);
    const end = rest.search(/\n#{2,3} /);
    return end < 0 ? rest : rest.slice(0, end);
}

function tableRows(text: string): string[][] {
    return text
        .split('\n')
        .filter((l) => l.trim().startsWith('|'))
        .map((l) => l.trim().slice(1, -1).split('|').map((c) => c.trim()));
}

export function parsePricingPage(md: string, date: string): PriceTable | undefined {
    const models: Record<string, Price> = {};
    for (const cells of tableRows(section(md, /^## Model pricing/m))) {
        const id = cells.length === 6 && modelId(cells[0]!);
        const v = cells.slice(1).map(money);
        if (id && v.every(Number.isFinite)) models[id] = v as unknown as Price;
    }
    // A page redesign that breaks the table shouldn't silently leave us with a handful of models.
    if (Object.keys(models).length < 5) return undefined;

    const fast: Record<string, Price> = {};
    for (const cells of tableRows(section(md, /^### Fast mode pricing/m))) {
        if (cells.length !== 3) continue;
        const input = money(cells[1]!), output = money(cells[2]!);
        if (!Number.isFinite(input) || !Number.isFinite(output)) continue;
        for (const name of cells[0]!.split(' / ')) {
            const id = modelId(name), base = id && models[id];
            // cache multipliers apply on top of the fast input rate, same ratios as the base model
            if (base) fast[id] = [input, (base[1] * input) / base[0], (base[2] * input) / base[0], (base[3] * input) / base[0], output];
        }
    }

    const search = md.match(/\$([\d.]+) per 1,000 searches/);
    const webSearch = search ? Number(search[1]) / 1000 : BUNDLED.webSearch;
    return { date, source: PRICING_URL, models, fast, webSearch };
}

// Live prices over bundled ones: the page drops retired models, old usage still needs them.
const withFallback = (t: PriceTable): PriceTable => ({
    ...t,
    models: { ...BUNDLED.models, ...t.models },
    fast: { ...BUNDLED.fast, ...t.fast },
});

export interface LoadResult {
    table: PriceTable;
    note?: string; // why live prices weren't used
}

export async function loadPrices(cacheFile: string, opts: { offline?: boolean; refresh?: boolean } = {}): Promise<LoadResult> {
    let cached: PriceTable | undefined;
    try {
        cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch {
        // no cache yet
    }
    const fresh = cached && Date.now() - Date.parse(cached.date) < MAX_AGE_MS;
    if (cached && (opts.offline || (fresh && !opts.refresh))) return { table: withFallback(cached) };

    let note: string;
    if (opts.offline) note = 'offline';
    else {
        try {
            const res = await fetch(PRICING_URL, { signal: AbortSignal.timeout(5000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const table = parsePricingPage(await res.text(), new Date().toISOString());
            if (!table) throw new Error('pricing page format not recognized');
            fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
            fs.writeFileSync(cacheFile, JSON.stringify(table));
            return { table: withFallback(table) };
        } catch (e) {
            note = (e as Error).message;
        }
    }
    return { table: cached ? withFallback(cached) : BUNDLED, note };
}

export function priceFor(table: PriceTable, model: string, fast: boolean, overrides: Record<string, number[]> = {}): Price | undefined {
    const key = fast ? `${model}-fast` : model;
    const own = overrides[key];
    if (own?.length === 5) return own as unknown as Price;
    return fast ? table.fast[model] : table.models[model];
}
