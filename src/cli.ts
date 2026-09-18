#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { applyFilter, applyHourFilter, hourFilterable, priceRows, type Filter } from './aggregate.ts';
import { CONFIG_KEYS, configFile, loadConfig, PLANS, saveConfig, type Config } from './config.ts';
import { writeDashboard } from './dashboard.ts';
import { paint, setColor, table } from './format.ts';
import { fill, L, lang, LANGS, setLang } from './i18n.ts';
import { claudeDirs, configDir, defaultMachine, retentionDays } from './paths.ts';
import { loadPrices } from './pricing.ts';
import {
    blocksReport, dimensionJson, dimensionReport, DIMENSIONS, insights, limitsInRange, periodJson, periodReport, PERIODS,
    planReport, renderCsv, renderTable, summary, summaryJson, type Dimension, type Period, type Report,
} from './reports.ts';
import { localClock } from './scan.ts';
import {
    claudeSettingsFile, currentRunner, dataFolderIn, hookInstalled, installHook, installSchedule, isEphemeral, removeHook,
    removeSchedule, SCHEDULE_TIME, scheduleInstalled, syncFolders,
} from './setup.ts';
import { loadAll } from './snapshot.ts';
import { dashboardPath, sync, type Settings } from './sync.ts';

// Name, version and project page come from package.json only
const pkg = createRequire(import.meta.url)('../package.json') as { name: string; version: string; homepage: string; author: { url: string } };
const REPO = pkg.homepage.replace(/#.*$/, '');
const NPM = `https://www.npmjs.com/package/${pkg.name}`;

const { values: opt, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        since: { type: 'string' },
        until: { type: 'string' },
        last: { type: 'string' },
        machine: { type: 'string', multiple: true },
        project: { type: 'string', multiple: true },
        model: { type: 'string', multiple: true },
        session: { type: 'string', multiple: true },
        agent: { type: 'string', multiple: true },
        skill: { type: 'string', multiple: true },
        mcp: { type: 'string', multiple: true },
        json: { type: 'boolean' },
        csv: { type: 'boolean' },
        breakdown: { type: 'boolean' },
        limit: { type: 'string' },
        lang: { type: 'string' },
        tz: { type: 'string' },
        'no-color': { type: 'boolean' },
        'no-sync': { type: 'boolean' },
        offline: { type: 'boolean' },
        quiet: { type: 'boolean' },
        location: { type: 'boolean' },
        refresh: { type: 'boolean' },
        'sync-dir': { type: 'string' },
        yes: { type: 'boolean', short: 'y' },
        'no-schedule': { type: 'boolean' },
        'no-hook': { type: 'boolean' },
        remove: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
    },
});

let config: Config = loadConfig();
const resolveSettings = (): Settings => ({
    syncDir: path.resolve(opt['sync-dir'] ?? process.env.CC_COST_DIR ?? config.syncDir ?? path.join(configDir(), 'data')),
    machine: config.machine ?? defaultMachine(),
    lang: opt.lang ?? config.lang ?? 'en',
    timezone: opt.tz ?? config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    planPrice: PLANS[config.plan ?? 'max5x'] ?? 100,
    anonymize: !!config.anonymizeProjects,
    pricing: config.pricing ?? {},
});
let settings = resolveSettings();
setLang(settings.lang);
setColor(!opt['no-color']);

const out = (text: string) => {
    if (!opt.quiet) console.log(text);
};
function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

const list = (v: string[] | undefined) => v?.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
function date(flag: string, v: string | undefined) {
    if (v !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(fill(L().badDate, { flag, value: v }));
    return v;
}
function count(flag: string, v: string | undefined) {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) fail(fill(L().badNumber, { flag, value: v }));
    return n;
}
const localDay = (daysAgo: number) => localClock(settings.timezone)(new Date(Date.now() - daysAgo * 864e5).toISOString()).d;

function filter(): Filter {
    const last = count('--last', opt.last);
    return {
        since: last ? localDay(last - 1) : date('--since', opt.since),
        until: date('--until', opt.until),
        machine: list(opt.machine),
        project: list(opt.project),
        model: list(opt.model),
        session: list(opt.session),
        agent: list(opt.agent),
        skill: list(opt.skill),
        mcp: list(opt.mcp),
    };
}

function openFile(file: string) {
    const [cmd, args] =
        process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', file]]
        : process.platform === 'darwin' ? ['open', [file]]
        : ['xdg-open', [file]];
    // No browser opener (a server, SSH): the path printed alongside is enough, so ignore the failure.
    spawn(cmd, args as string[], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

const pricesCache = () => path.join(configDir(), 'pricing-cache.json');

async function data(verbose: boolean) {
    if (!opt['no-sync']) {
        const r = await sync(settings);
        if (verbose) {
            out(fill(L().scanned, { machine: settings.machine, files: r.scan.files, dupes: r.scan.duplicates }));
            out(fill(L().snapshot, { file: r.file }) + (r.kept ? fill(L().kept, { n: r.kept }) : ''));
        }
    }
    const prices = await loadPrices(pricesCache(), { offline: opt.offline });
    const snaps = loadAll(settings.syncDir);
    return { ...priceRows(snaps, prices.table, settings.pricing), prices, snaps };
}
type Data = Awaited<ReturnType<typeof data>>;

function dashboard(d: Data) {
    const dates = d.rows.map((r) => r.d).sort();
    const t = d.prices.table;
    return writeDashboard(d, {
        lang: settings.lang,
        timezone: settings.timezone,
        planPrice: settings.planPrice,
        updated: new Date().toISOString(),
        machines: d.snaps.length,
        first: dates[0] ?? '',
        last: dates[dates.length - 1] ?? '',
        prices: `${t.source === 'bundled' ? 'bundled' : 'platform.claude.com'} ${t.date.slice(0, 10)}`,
        version: pkg.version,
        repo: REPO,
        npm: NPM,
        site: pkg.author.url,
    }, dashboardPath(settings));
}

function footer(d: Data) {
    if (d.prices.note) out(fill(L().pricesFallback, { reason: d.prices.note, source: d.prices.table.source, date: d.prices.table.date.slice(0, 10) }));
    if (d.unknown.size) out(fill(L().unknownModels, { list: [...d.unknown].join(', ') }));
}

// Print a table report as a table, CSV or JSON
function emit(report: Report, json: unknown, empty: boolean) {
    if (opt.json) return out(JSON.stringify(json, null, 2));
    if (opt.csv) return out(renderCsv(report));
    out(empty ? L().noData : renderTable(report));
}

const machineMatch = (f: Filter) => (m: string) => !f.machine?.length || f.machine.some((w) => m.toLowerCase().includes(w.toLowerCase()));

async function ask(rl: readline.Interface | undefined, question: string): Promise<string> {
    return rl ? (await rl.question(question)).trim() : '';
}
const yes = (answer: string) => answer === '' || /^[yeYE]/.test(answer);

async function setup() {
    const S = L().setup;
    const runner = currentRunner();
    if (opt.remove) {
        const removed = [removeSchedule(), removeHook() ? claudeSettingsFile() : undefined].filter(Boolean);
        return out(removed.length ? removed.map((w) => fill(S.removed, { what: w! })).join('\n') : S.nothingToRemove);
    }
    const interactive = !opt.yes && process.stdin.isTTY;
    const rl = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : undefined;
    try {
        out(paint('bold', fill(S.title, { version: pkg.version })));
        const next: Config = { ...config };

        if (opt['sync-dir']) next.syncDir = path.resolve(opt['sync-dir']);
        else {
            const folders = syncFolders();
            const proposal = next.syncDir ?? (folders[0] && dataFolderIn(folders[0]));
            if (folders.length) out(fill(S.found, { list: folders.join(', ') }));
            let chosen = proposal && yes(await ask(rl, fill(S.usePath, { path: proposal }))) ? proposal : undefined;
            if (!chosen && rl) chosen = (await ask(rl, S.askPath)) || undefined;
            if (chosen) next.syncDir = path.resolve(chosen);
            else out(S.localOnly);
        }
        const langAnswer = opt.lang ?? (await ask(rl, fill(S.lang, { current: next.lang ?? 'en' })));
        if (langAnswer && LANGS[langAnswer]) next.lang = langAnswer;
        const planAnswer = await ask(rl, fill(S.plan, { current: next.plan ?? 'max5x' }));
        if (planAnswer && PLANS[planAnswer]) next.plan = planAnswer;
        next.plan ??= 'max5x';

        saveConfig(next);
        config = next;
        settings = resolveSettings();
        setLang(settings.lang);
        out(fill(L().setup.saved, { file: configFile() }));

        const wantSchedule = !opt['no-schedule'] && yes(await ask(rl, fill(S.schedule, { time: SCHEDULE_TIME })));
        const wantHook = !opt['no-hook'] && yes(await ask(rl, fill(S.hook, { file: claudeSettingsFile() })));
        if ((wantSchedule || wantHook) && isEphemeral(runner)) out(S.npx);
        else {
            if (wantSchedule) {
                const r = installSchedule(runner);
                out(fill(r.ok ? S.scheduled : S.scheduleFailed, r.ok ? { what: r.what } : { reason: r.what }));
            }
            if (wantHook) out(fill(installHook(runner) ? S.hookAdded : S.hookKept, { file: claudeSettingsFile() }));
        }
    } finally {
        rl?.close();
    }
    out('\n' + S.firstSync);
    const d = await data(true);
    out(fill(L().dashboard, { file: dashboard(d) }));
}

async function status() {
    const St = L().status;
    const snaps = loadAll(settings.syncDir);
    const prices = await loadPrices(pricesCache(), { offline: true });
    const info = {
        version: pkg.version,
        config: configFile(),
        syncDir: settings.syncDir,
        machine: settings.machine,
        machines: snaps.map((s) => ({ name: s.machine, updated: s.updated, days: new Set(s.rows.map((r) => r.d)).size })),
        retentionDays: retentionDays(claudeDirs()),
        schedule: scheduleInstalled(),
        hook: hookInstalled(),
        prices: { source: prices.table.source, date: prices.table.date },
    };
    if (opt.json) return out(JSON.stringify(info, null, 2));
    const when = (iso: string) => (iso ? new Date(iso).toLocaleString(lang() === 'tr' ? 'tr-TR' : 'en-US', { timeZone: settings.timezone }) : '–');
    const pairs: [string, string][] = [
        [St.version, info.version],
        [St.config, info.config + (fs.existsSync(info.config) ? '' : ' (–)')],
        [St.syncDir, info.syncDir],
        [St.machine, info.machine],
        [St.machines, info.machines.length ? info.machines.map((m) => fill(St.machineLine, { name: m.name, updated: when(m.updated), days: m.days })).join('\n' + ' '.repeat(0)) : St.none],
        [St.retention, fill(St.retentionValue, { n: info.retentionDays })],
        [St.scheduler, info.schedule ? St.yes : St.no],
        [St.hook, info.hook ? St.yes : St.no],
        [St.prices, `${info.prices.source}, ${info.prices.date.slice(0, 10)}`],
    ];
    const w = Math.max(...pairs.map(([k]) => k.length));
    for (const [k, v] of pairs) out(paint('dim', k.padEnd(w)) + '  ' + v.split('\n').join('\n' + ' '.repeat(w + 2)));
}

async function main() {
    if (opt.help) return out(fill(L().help, { version: pkg.version, url: REPO }));
    if (opt.version) return out(pkg.version);
    const [cmd = '', ...rest] = positionals;
    const tableCommands = [...PERIODS, ...DIMENSIONS, 'plan', 'blocks'] as string[];
    if (opt.csv && !tableCommands.includes(cmd)) fail(L().csvUnsupported);

    if (cmd === '' || cmd === 'sync') {
        const d = await data(cmd === '');
        const file = dashboard(d);
        if (cmd === 'sync') return;
        const rows = applyFilter(d.rows, filter());
        if (opt.json) return out(JSON.stringify(summaryJson(rows), null, 2));
        out('\n' + (rows.length ? summary(rows) : L().noData));
        out('\n' + fill(L().dashboard, { file }));
        return footer(d);
    }

    if (PERIODS.includes(cmd as Period) || DIMENSIONS.includes(cmd as Dimension) || ['insights', 'plan', 'blocks'].includes(cmd)) {
        const d = await data(false);
        const f = filter();
        const rows = applyFilter(d.rows, f);
        const limits = limitsInRange(d.limits, settings.timezone, f.since, f.until, machineMatch(f));
        const limit = count('--limit', opt.limit) ?? (['sessions', 'projects', 'blocks'].includes(cmd) ? 20 : undefined);

        if (PERIODS.includes(cmd as Period)) {
            const p = cmd as Period;
            emit(periodReport(rows, p, { breakdown: opt.breakdown, flat: opt.csv }), periodJson(rows, p, opt.breakdown), !rows.length);
        } else if (DIMENSIONS.includes(cmd as Dimension)) {
            const dim = cmd as Dimension;
            emit(dimensionReport(rows, dim, limit), dimensionJson(rows, dim, limit), !rows.length);
        } else if (cmd === 'plan') {
            const p = planReport(rows, limits, { timezone: settings.timezone, plan: config.plan });
            emit(p.report, p.json, !rows.length);
            if (!opt.json && !opt.csv && rows.length) out('\n' + p.notes.join('\n'));
        } else if (cmd === 'blocks') {
            if (!hourFilterable(f)) console.error(L().hourFilters);
            const hours = applyHourFilter(d.hours, f);
            const report = blocksReport(hours, limits, { timezone: settings.timezone, limit });
            emit(report, report.rows.map((r) => Object.fromEntries(report.cols.map((c, i) => [c.title, r[i]]))), !hours.length);
        } else {
            const hours = hourFilterable(f) ? applyHourFilter(d.hours, f) : undefined;
            const r = insights({ rows, hours, limits, table: d.prices.table, timezone: settings.timezone });
            out(opt.json ? JSON.stringify(r.json, null, 2) : rows.length ? r.text : L().noData);
        }
        if (!opt.json && !opt.csv) footer(d);
        return;
    }

    if (cmd === 'report') {
        const file = dashboard(await data(false));
        out(fill(L().dashboard, { file }));
        if (!opt.location) openFile(file);
        return;
    }
    if (cmd === 'pricing') {
        const { table: t, note } = await loadPrices(pricesCache(), { offline: opt.offline, refresh: opt.refresh });
        if (opt.json) return out(JSON.stringify(t, null, 2));
        const c = L().col;
        const models = Object.entries(t.models).map(([m, p]) => [m, p.join(' / ')]);
        const fast = Object.entries(t.fast).map(([m, p]) => [m + '-fast', p.map((v) => +v.toFixed(4)).join(' / ')]);
        out(table([c.model, c.price], [...models, ...fast], { left: [1] }));
        const date = t.date.slice(0, 10);
        out('\n' + (note ? fill(L().pricesFallback, { reason: note, source: t.source, date }) : fill(L().pricesLive, { source: t.source, date })));
        return;
    }
    if (cmd === 'setup') return setup();
    if (cmd === 'status') return status();
    if (cmd === 'config') {
        if (rest[0] === 'set') {
            const [key, value = ''] = rest.slice(1);
            if (!CONFIG_KEYS.includes(key as (typeof CONFIG_KEYS)[number]))
                fail(fill(L().configUnknownKey, { key: String(key), keys: CONFIG_KEYS.join(', ') }));
            const next: Record<string, unknown> = { ...config };
            next[key!] = key === 'anonymizeProjects' ? value === 'true' : key === 'syncDir' ? path.resolve(value) : value;
            saveConfig(next as Config);
            return out(fill(L().configSet, { key: key!, value: String(next[key!]) }));
        }
        out(fill(L().configFile, { file: configFile() }));
        return out(JSON.stringify({ ...settings, languages: Object.keys(LANGS) }, null, 2));
    }
    fail(fill(L().unknownCommand, { cmd }));
}

await main();
