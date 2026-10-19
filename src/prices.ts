import fs from 'node:fs';
import path from 'node:path';
import { BUNDLED, parsePricingPage, PRICING_URL, storedTable, withFallback, type PriceTable } from './pricing.ts';

// pricing.json in the data folder: the price table read from the live page, refreshed at most once a day
// by whichever machine syncs, and the user's own prices under "overrides". Shared like the snapshots,
// so every machine and the dashboard price with the same table.

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const pricingFile = (syncDir: string) => path.join(syncDir, 'pricing.json');

// The file as it is; written by hand it may hold only the overrides
function read(file: string): Partial<PriceTable> | undefined {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return undefined; // no file yet
    }
}

function write(file: string, table: PriceTable) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(table));
    fs.renameSync(file + '.tmp', file);
}

export interface LoadResult {
    table: PriceTable;
    note?: string; // why live prices weren't used
}

export async function loadPrices(file: string, opts: { offline?: boolean; refresh?: boolean } = {}): Promise<LoadResult> {
    const stored = read(file);
    const whole = !!stored?.models;
    const fresh = whole && Date.now() - Date.parse(stored?.date ?? '') < MAX_AGE_MS;
    if (whole && (opts.offline || (fresh && !opts.refresh))) return { table: storedTable(stored) };

    let note: string;
    if (opts.offline) note = 'offline';
    else {
        try {
            const res = await fetch(PRICING_URL, { signal: AbortSignal.timeout(5000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const live = parsePricingPage(await res.text(), new Date().toISOString());
            if (!live) throw new Error('pricing page format not recognized');
            if (stored?.overrides) live.overrides = stored.overrides;
            write(file, live);
            return { table: withFallback(live) };
        } catch (e) {
            note = (e as Error).message;
        }
    }
    return { table: storedTable(stored), note };
}

// The "pricing" overrides of a cc-cost 1.x config move into pricing.json once; from then on the file is theirs
export function seedOverrides(file: string, overrides: Record<string, number[]>) {
    const stored = read(file);
    if (stored?.overrides) return;
    write(file, { ...BUNDLED, ...stored, overrides });
}
