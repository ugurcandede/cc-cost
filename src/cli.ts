#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { namedAccounts, planText } from './accounts.ts';
import { accountsOf, applyFilter, applyHourFilter, hourFilterable, localClock, matches, priceRows, type Filter } from './aggregate.ts';
import { CONFIG_KEYS, configFile, loadConfig, planPrice, PLANS, saveConfig, type Config } from './config.ts';
import { writeDashboard } from './dashboard.ts';
import { paint, setColor, table } from './format.ts';
import { fill, L, lang, LANGS, setLang } from './i18n.ts';
import { claudeDirs, configDir, defaultMachine, defaultSyncDir, parseDirs, retentionDays, validMachine } from './paths.ts';
import { loadPrices, pricingFile, seedOverrides } from './prices.ts';
import { Cancelled } from './prompt.ts';
import { openMirror, remoteProblem, sshHint, type Mirror } from './remote.ts';
import {
    blocksReport, dimensionJson, dimensionReport, DIMENSIONS, insights, limitsInRange, periodJson, periodReport, PERIODS,
    planReport, renderCsv, renderTable, summary, summaryJson, type Dimension, type Period, type Report,
} from './reports.ts';
import { serveDetached, serveWhileOpen } from './serve.ts';
import { claudeSettingsFiles, currentRunner, hookInstalled, scheduleInstalled } from './setup.ts';
import { loadAll } from './snapshot.ts';
import { dashboardPath, sync, type Settings } from './sync.ts';
import { installMethod, isNewer, latestVersion, updateCommand } from './update.ts';
import { confirm, removeAutomation, settingsMenu, setup, type Wizard } from './wizard.ts';

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
        account: { type: 'string', multiple: true },
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

// Settings come from, in order: flag, environment, config file, default. A folder given for this run
// takes the place of the server.
let config: Config = loadConfig();
const resolveSettings = (): Settings => ({
    syncDir: path.resolve(opt['sync-dir'] ?? process.env.CC_COST_DIR ?? config.syncDir ?? defaultSyncDir()),
    machine: config.machine ?? defaultMachine(),
    lang: opt.lang ?? config.lang ?? 'en',
    timezone: opt.tz ?? config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    anonymize: !!config.anonymizeProjects,
    plan: config.plan,
    claudeDirs: claudeDirs(config.claudeDirs),
    remote: opt['sync-dir'] || process.env.CC_COST_DIR ? undefined : config.remote || undefined,
    accounts: config.accounts,
    unassigned: config.unassigned,
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
// Menus need a terminal on both ends; --yes, CI and pipes take the defaults instead
const interactive = !opt.yes && !!process.stdin.isTTY && !!process.stdout.isTTY;

// With a server, the data folder is a mirror of the server's: pulled before the first read, pushed after
// the command, removed on exit. Nothing of the data stays on this machine.
let mirror: Mirror | undefined;
let mirrorOf: string | undefined; // the server it came from
// The mirror of a server, pulled now unless the open one is its. When the server can't be reached the
// command stops, or with `soft` says so and goes on without.
function mirrorFor(remote: string, soft: boolean): Mirror | undefined {
    if (mirror && mirrorOf === remote) return mirror;
    mirror?.close();
    mirror = undefined;
    try {
        mirror = openMirror(remote);
        mirrorOf = remote;
    } catch (e) {
        const reason = (e as Error).message;
        const hint = sshHint(reason, remote);
        const message = fill(L().remoteFailed, { remote, reason }) + (hint ? '\n  ' + hint : '');
        if (!soft) fail(message);
        console.error(message);
    }
    return mirror;
}
function ensureData(soft = false) {
    if (!settings.remote) return;
    const m = mirrorFor(settings.remote, soft);
    if (m) settings.syncDir = m.dir;
}
function pushMirror(verbose: boolean) {
    if (!mirror || mirrorOf !== settings.remote) return;
    mirror.push();
    if (verbose) out(fill(L().remoteSynced, { remote: settings.remote! }));
}
process.on('exit', () => mirror?.close());
process.on('SIGINT', () => process.exit(130));

// What the interactive questions read and write; saving refreshes the settings and the language
const wizard: Wizard = {
    get config() {
        return config;
    },
    get settings() {
        return settings;
    },
    out,
    save(next) {
        saveConfig(next);
        config = next;
        settings = resolveSettings();
        setLang(settings.lang);
        // a mirror of another server is of no use now; the new one is pulled on the next read
        if (mirror && mirrorOf !== settings.remote) {
            mirror.close();
            mirror = undefined;
        } else if (mirror) settings.syncDir = mirror.dir;
    },
    // The data a config would read, for the questions about accounts: its server's mirror, pulled now
    // (this machine's own folder when the server can't be reached), else its folder
    dataDir(next) {
        const m = next.remote ? mirrorFor(next.remote, true) : undefined;
        return m ? m.dir : path.resolve(next.syncDir ?? defaultSyncDir());
    },
};

// ---------- flags

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
        account: list(opt.account),
        project: list(opt.project),
        model: list(opt.model),
        session: list(opt.session),
        agent: list(opt.agent),
        skill: list(opt.skill),
        mcp: list(opt.mcp),
    };
}
// Limit events kept by the machine and account filters
const limitMatch = (f: Filter) => (l: { machine: string; accountName: string }) => matches(f.machine, l.machine) && matches(f.account, l.accountName);

// ---------- data

const updateCache = () => path.join(configDir(), 'update-check.json');

// The page in the data folder; every machine writes it only when its copy is newer
const dashboard = () => writeDashboard(dashboardPath(settings), { version: pkg.version, repo: REPO, npm: NPM, site: pkg.author.url });
const dashboardWhere = () => (settings.remote ? `${settings.remote}/dashboard.html` : dashboardPath(settings));

async function data(verbose: boolean) {
    ensureData();
    // what a cc-cost 1.x left: its price overrides go into pricing.json, its price cache in the config folder goes
    if (config.pricing) seedOverrides(pricingFile(settings.syncDir), config.pricing);
    fs.rmSync(path.join(configDir(), 'pricing-cache.json'), { force: true });
    if (!opt['no-sync']) {
        if (!settings.claudeDirs.length) console.error(L().noClaudeDirs);
        const r = await sync(settings);
        if (verbose) {
            out(fill(L().scanned, { machine: settings.machine, files: r.scan.files, dupes: r.scan.duplicates }));
            // the mirror is temporary: name the file where it stays
            const file = settings.remote ? `${settings.remote}/${path.relative(settings.syncDir, r.file).replace(/\\/g, '/')}` : r.file;
            out(fill(L().snapshot, { file }) + (r.kept ? fill(L().kept, { n: r.kept }) : ''));
        }
    }
    const prices = await loadPrices(pricingFile(settings.syncDir), { offline: opt.offline });
    dashboard();
    const snaps = loadAll(settings.syncDir);
    return { ...priceRows(snaps, prices.table), prices, snaps };
}
type Data = Awaited<ReturnType<typeof data>>;

async function footer(d: Data) {
    if (d.prices.note) out(fill(L().pricesFallback, { reason: d.prices.note, source: d.prices.table.source, date: d.prices.table.date.slice(0, 10) }));
    if (d.unknown.size) out(fill(L().unknownModels, { list: [...d.unknown].join(', ') }));
    // Before setup has run: a nudge, once the first numbers are on screen
    if (!fs.existsSync(configFile()) && !opt.json && !opt.csv) out('\n' + paint('dim', L().setupHint));
    // At most one registry check a day, and never in machine-readable or offline output
    if (opt.json || opt.csv || opt.offline || opt.quiet) return;
    const latest = await latestVersion(pkg.name, updateCache());
    if (latest && isNewer(latest, pkg.version)) out('\n' + paint('yellow', fill(L().update.available, { latest, current: pkg.version })));
}

function openInBrowser(url: string) {
    const [cmd, args] =
        process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
        : process.platform === 'darwin' ? ['open', [url]]
        : ['xdg-open', [url]];
    // No browser opener (a server, SSH): the address printed alongside is enough, so ignore the failure.
    spawn(cmd, args as string[], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

// Opens the dashboard from a server left running in its own process while the page is open. A mirror
// is handed over to it, which removes it when it stops.
async function showDashboard() {
    pushMirror(false);
    const own = !!mirror && settings.syncDir === mirror.dir;
    if (own) mirror = undefined; // handed over: the server removes it when it stops
    const url = await serveDetached(currentRunner().script, settings.syncDir, own);
    out(fill(L().serving, { url }));
    openInBrowser(url);
}

// Print a table report as a table, CSV or JSON
function emit(report: Report, json: unknown, empty: boolean) {
    if (opt.json) return out(JSON.stringify(json, null, 2));
    if (opt.csv) return out(renderCsv(report));
    out(empty ? L().noData : renderTable(report));
}

// ---------- commands

async function report() {
    const d = await data(false);
    const f = filter();
    const rows = applyFilter(d.rows, f);
    const limits = limitsInRange(d.limits, settings.timezone, f.since, f.until, limitMatch(f));
    const cmd = positionals[0]!;
    const limit = count('--limit', opt.limit) ?? (['sessions', 'projects', 'blocks'].includes(cmd) ? 20 : undefined);

    if (PERIODS.includes(cmd as Period)) {
        const p = cmd as Period;
        emit(periodReport(rows, p, { breakdown: opt.breakdown, flat: opt.csv }), periodJson(rows, p, opt.breakdown), !rows.length);
    } else if (DIMENSIONS.includes(cmd as Dimension)) {
        const dim = cmd as Dimension;
        emit(dimensionReport(rows, dim, limit), dimensionJson(rows, dim, limit), !rows.length);
    } else if (cmd === 'plan') {
        const p = planReport(rows, limits, { timezone: settings.timezone, plan: config.plan, accounts: d.accounts });
        emit(p.report, p.json, !rows.length);
        // The account table follows the monthly one in the terminal; JSON carries both, CSV the monthly one
        if (!opt.json && !opt.csv && rows.length) out('\n' + renderTable(p.accountsReport) + '\n\n' + p.notes.join('\n'));
    } else if (cmd === 'blocks') {
        if (!hourFilterable(f)) console.error(L().hourFilters);
        const hours = applyHourFilter(d.hours, f);
        const r = blocksReport(hours, limits, { timezone: settings.timezone, limit });
        emit(r, r.rows.map((row) => Object.fromEntries(r.cols.map((c, i) => [c.title, row[i]]))), !hours.length);
    } else {
        const hours = hourFilterable(f) ? applyHourFilter(d.hours, f) : undefined;
        const r = insights({ rows, hours, limits, table: d.prices.table, timezone: settings.timezone });
        out(opt.json ? JSON.stringify(r.json, null, 2) : rows.length ? r.text : L().noData);
    }
    if (!opt.json && !opt.csv) await footer(d);
}

async function update() {
    const U = L().update;
    const script = currentRunner().script;
    const method = installMethod(script);
    if (method === 'ephemeral') return out(fill(U.ephemeral, { pkg: pkg.name }));
    if (method === 'unknown') return out(fill(U.manual, { path: script }));
    let latest: string | undefined;
    try {
        latest = await latestVersion(pkg.name, updateCache(), { force: true });
    } catch {
        fail(U.checkFailed);
    }
    if (!latest || !isNewer(latest, pkg.version)) return out(fill(U.upToDate, { current: pkg.version }));
    const command = updateCommand[method](pkg.name).join(' ');
    out(fill(U.running, { latest, command }));
    // a fixed command line, no user input; the shell finds npm.cmd / yarn.cmd on Windows
    const res = spawnSync(command, { stdio: 'inherit', shell: true });
    if (res.status !== 0) fail(fill(U.failed, { code: String(res.status), command }));
    out(fill(U.done, { latest }));
}

async function runSetup() {
    const runner = currentRunner();
    if (opt.remove) return removeAutomation(wizard, interactive);
    const flags = { lang: opt.lang, syncDir: opt['sync-dir'], schedule: !opt['no-schedule'], hook: !opt['no-hook'] };
    if (!(await setup(wizard, runner, flags, interactive, pkg.version))) return;
    out('\n' + L().setup.firstSync);
    const d = await data(true);
    pushMirror(true);
    out('\n' + (d.rows.length ? summary(d.rows) : L().noData));
    out('\n' + fill(L().dashboard, { file: dashboardWhere() }));
    if (!interactive) return;
    try {
        if (await confirm(wizard, paint('bold', L().setup.openDashboard))) await showDashboard();
    } catch (e) {
        if (!(e instanceof Cancelled)) throw e;
    }
}

async function status() {
    const St = L().status;
    ensureData(true); // a status is wanted most when the server is down
    const snaps = loadAll(settings.syncDir);
    const prices = await loadPrices(pricingFile(settings.syncDir), { offline: true });
    // each account with the plan given to it here, else the one in its login
    const accounts = namedAccounts(settings.claudeDirs, settings.machine, config.accounts, accountsOf(snaps)).map((a) => ({
        name: a.name,
        given: config.accounts?.[a.id] ?? { plan: a.plan },
    }));
    const info = {
        version: pkg.version,
        config: configFile(),
        syncDir: settings.remote ? '' : settings.syncDir,
        remote: config.remote || '',
        machine: settings.machine,
        machines: snaps.map((s) => ({ name: s.machine, updated: s.updated, days: new Set(s.rows.map((r) => r.d)).size })),
        claudeDirs: settings.claudeDirs,
        accounts: accounts.map(({ name, given }) => ({ name, plan: given.plan ?? null, price: planPrice(given.plan, given.price) ?? null })),
        retentionDays: retentionDays(settings.claudeDirs),
        schedule: scheduleInstalled(),
        hook: claudeSettingsFiles(settings.claudeDirs).every(hookInstalled),
        prices: { source: prices.table.source, date: prices.table.date },
    };
    if (opt.json) return out(JSON.stringify(info, null, 2));
    const when = (iso: string) => (iso ? new Date(iso).toLocaleString(lang() === 'tr' ? 'tr-TR' : 'en-US', { timeZone: settings.timezone }) : '–');
    const mark = (on: boolean) => (on ? paint('green', '✓ ') + St.yes : paint('red', '✗ ') + St.no);
    const pairs: [string, string][] = [
        [St.version, info.version],
        [St.config, info.config + (fs.existsSync(info.config) ? '' : ' (–)')],
        [St.syncDir, info.syncDir || '–'],
        [St.remote, info.remote || St.none],
        [St.machine, info.machine],
        [St.machines, info.machines.map((m) => fill(St.machineLine, { name: m.name, updated: when(m.updated), days: m.days })).join('\n') || St.none],
        [St.claudeDirs, info.claudeDirs.join('\n') || St.none],
        [St.accounts, accounts.map(({ name, given }) => `${name}: ${planText(given)}`).join('\n') || St.none],
        [St.retention, fill(St.retentionValue, { n: info.retentionDays })],
        [St.scheduler, mark(info.schedule)],
        [St.hook, mark(info.hook)],
        [St.prices, `${info.prices.source}, ${info.prices.date.slice(0, 10)}`],
    ];
    const w = Math.max(...pairs.map(([k]) => k.length));
    for (const [k, v] of pairs) out(paint('dim', k.padEnd(w)) + '  ' + v.split('\n').join('\n' + ' '.repeat(w + 2)));
}

async function pricing() {
    ensureData();
    const { table: t, note } = await loadPrices(pricingFile(settings.syncDir), { offline: opt.offline, refresh: opt.refresh });
    if (opt.json) return out(JSON.stringify(t, null, 2));
    const c = L().col;
    const models = Object.entries(t.models).map(([m, p]) => [m, p.join(' / ')]);
    const fast = Object.entries(t.fast).map(([m, p]) => [m + '-fast', p.map((v) => +v.toFixed(4)).join(' / ')]);
    out(table([c.model, c.price], [...models, ...fast], { left: [1] }));
    const date = t.date.slice(0, 10);
    out('\n' + (note ? fill(L().pricesFallback, { reason: note, source: t.source, date }) : fill(L().pricesLive, { source: t.source, date })));
}

// config set <key> <value>: the keys with a free value; accounts and unassigned are set in the menu
function configSet(key: string | undefined, value: string) {
    if (!CONFIG_KEYS.includes(key as (typeof CONFIG_KEYS)[number]))
        fail(fill(L().configUnknownKey, { key: String(key), keys: CONFIG_KEYS.join(', ') }));
    const C = L().configCheck;
    const next: Record<string, unknown> = { ...config };
    switch (key) {
        case 'lang':
            if (!LANGS[value]) fail(fill(C.lang, { value, list: Object.keys(LANGS).join(', ') }));
            next[key] = value;
            break;
        case 'plan':
            if (!PLANS[value]) fail(fill(C.plan, { value, list: Object.keys(PLANS).join(', ') }));
            next[key] = value;
            break;
        case 'timezone':
            try {
                new Intl.DateTimeFormat('en', { timeZone: value });
            } catch {
                fail(fill(C.timezone, { value }));
            }
            next[key] = value;
            break;
        case 'remote': {
            const problem = value ? remoteProblem(value) : undefined;
            if (problem) fail(fill(problem === 'port' ? L().setup.remotePort : L().setup.remoteInvalid, { remote: value }));
            next[key] = value;
            break;
        }
        case 'machine':
            if (!validMachine(value)) fail(fill(C.machine, { value }));
            next[key] = value;
            break;
        case 'anonymizeProjects':
            next[key] = value === 'true';
            break;
        case 'syncDir':
            next[key] = path.resolve(value);
            break;
        case 'claudeDirs':
            next[key] = parseDirs(value);
            break;
        default:
            next[key!] = value;
    }
    saveConfig(next as Config);
    out(fill(L().configSet, { key: key!, value: String(next[key!]) }));
}

async function main() {
    // the server process behind `report`, started by serveDetached()
    if (process.env.CC_COST_SERVE) {
        await serveWhileOpen(process.env.CC_COST_SERVE, Number(process.env.CC_COST_SERVE_PORT));
        if (process.env.CC_COST_SERVE_REMOVE) fs.rmSync(process.env.CC_COST_SERVE, { recursive: true, force: true });
        return;
    }
    if (opt.help) return out(fill(L().help, { version: pkg.version, url: REPO }));
    if (opt.version) return out(pkg.version);
    const [cmd = '', ...rest] = positionals;
    const tableCommands = [...PERIODS, ...DIMENSIONS, 'plan', 'blocks'] as string[];
    if (opt.csv && !tableCommands.includes(cmd)) fail(L().csvUnsupported);

    if (cmd === '' || cmd === 'sync') {
        const d = await data(cmd === '');
        pushMirror(cmd === '');
        if (cmd === 'sync') return;
        const rows = applyFilter(d.rows, filter());
        if (opt.json) return out(JSON.stringify(summaryJson(rows), null, 2));
        out('\n' + (rows.length ? summary(rows) : L().noData));
        out('\n' + fill(L().dashboard, { file: dashboardWhere() }));
        return footer(d);
    }
    if (tableCommands.includes(cmd) || cmd === 'insights') return report();
    if (cmd === 'report') {
        await data(false);
        if (opt.location) return out(fill(L().dashboard, { file: dashboardWhere() }));
        return showDashboard();
    }
    if (cmd === 'pricing') return pricing();
    if (cmd === 'setup') return runSetup();
    if (cmd === 'status') return status();
    if (cmd === 'update') return update();
    if (cmd === 'config') {
        if (rest[0] === 'set') return configSet(rest[1], rest[2] ?? '');
        if (interactive && !opt.json) {
            ensureData(true); // the names given to accounts on other machines; the menu works without them
            return settingsMenu(wizard);
        }
        out(fill(L().configFile, { file: configFile() }));
        return out(JSON.stringify({ ...settings, languages: Object.keys(LANGS) }, null, 2));
    }
    fail(fill(L().unknownCommand, { cmd }));
}

await main();
pushMirror(false);
