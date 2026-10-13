#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { detectAccount, type Detected } from './accounts.ts';
import { accountLabel, accountsOf, applyFilter, applyHourFilter, hourFilterable, priceRows, type Filter } from './aggregate.ts';
import { CONFIG_KEYS, configFile, isBetaPlan, loadConfig, PLAN_NAMES, planPrice, PLANS, saveConfig, type Config } from './config.ts';
import { writeDashboard } from './dashboard.ts';
import { beta, paint, setColor, table } from './format.ts';
import { fill, L, lang, LANGS, setLang } from './i18n.ts';
import { claudeDirs, configDir, defaultMachine, findClaudeDirs, parseDirs, retentionDays } from './paths.ts';
import { loadPrices } from './pricing.ts';
import {
    blocksReport, dimensionJson, dimensionReport, DIMENSIONS, insights, limitsInRange, periodJson, periodReport, PERIODS,
    planReport, renderCsv, renderTable, summary, summaryJson, type Dimension, type Period, type Report,
} from './reports.ts';
import { probe, remoteParts, remoteProblem, sshFailure } from './remote.ts';
import { Cancelled, checklist, input, select, track, type Choice } from './prompt.ts';
import { localClock } from './scan.ts';
import { UNKNOWN } from './types.ts';
import {
    claudeSettingsFiles, currentRunner, dataFolderIn, hookInstalled, installHook, installSchedule, isEphemeral, removeHook,
    removeSchedule, SCHEDULE_TIME, scheduleInstalled, syncFolders, type SyncFolder,
} from './setup.ts';
import { loadAll, loadOwn } from './snapshot.ts';
import { installMethod, isNewer, latestVersion, updateCommand } from './update.ts';
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

let config: Config = loadConfig();
const resolveSettings = (): Settings => ({
    syncDir: path.resolve(opt['sync-dir'] ?? process.env.CC_COST_DIR ?? config.syncDir ?? path.join(configDir(), 'data')),
    machine: config.machine ?? defaultMachine(),
    lang: opt.lang ?? config.lang ?? 'en',
    timezone: opt.tz ?? config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    planPrice: PLANS[config.plan ?? 'max5x'] ?? 100,
    anonymize: !!config.anonymizeProjects,
    pricing: config.pricing ?? {},
    claudeDirs: claudeDirs(config.claudeDirs),
    remote: opt.offline ? undefined : config.remote || undefined,
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

function openFile(file: string) {
    const [cmd, args] =
        process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', file]]
        : process.platform === 'darwin' ? ['open', [file]]
        : ['xdg-open', [file]];
    // No browser opener (a server, SSH): the path printed alongside is enough, so ignore the failure.
    spawn(cmd, args as string[], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

const pricesCache = () => path.join(configDir(), 'pricing-cache.json');
const updateCache = () => path.join(configDir(), 'update-check.json');

async function data(verbose: boolean) {
    if (!opt['no-sync']) {
        const r = await sync(settings);
        if (r.remoteError) console.error(fill(L().remoteFailed, { remote: settings.remote!, reason: r.remoteError }) + sshHint(r.remoteError, settings.remote!, '\n  '));
        else if (verbose && settings.remote) out(fill(L().remoteSynced, { remote: settings.remote }));
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
        accounts: Object.fromEntries([...new Set(d.rows.map((r) => r.account))].map((id) => {
            const a = d.accounts.get(id);
            // usage from before accounts falls back to the plan setting, as in the plan report
            const plan = a?.plan ?? (id === UNKNOWN ? config.plan : undefined);
            const name = a?.label ?? d.rows.find((r) => r.account === id)!.accountName;
            return [name, {
                plan: plan === 'free' ? L().setup.sponsored : plan && (PLAN_NAMES[plan] ?? plan),
                price: planPrice(plan, a?.price),
                ...(isBetaPlan(plan) && a?.price === undefined && { beta: true }),
            }];
        })),
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

async function footer(d: Data) {
    if (d.prices.note) out(fill(L().pricesFallback, { reason: d.prices.note, source: d.prices.table.source, date: d.prices.table.date.slice(0, 10) }));
    if (d.unknown.size) out(fill(L().unknownModels, { list: [...d.unknown].join(', ') }));
    // At most one registry check a day, and never in machine-readable or offline output
    if (opt.json || opt.csv || opt.offline || opt.quiet) return;
    const latest = await latestVersion(pkg.name, updateCache());
    if (latest && isNewer(latest, pkg.version)) out('\n' + paint('yellow', fill(L().update.available, { latest, current: pkg.version })));
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

// Print a table report as a table, CSV or JSON
function emit(report: Report, json: unknown, empty: boolean) {
    if (opt.json) return out(JSON.stringify(json, null, 2));
    if (opt.csv) return out(renderCsv(report));
    out(empty ? L().noData : renderTable(report));
}

const matchesAny = (wanted: string[] | undefined) => (v: string) => !wanted?.length || wanted.some((w) => v.toLowerCase().includes(w.toLowerCase()));
// Limit events kept by the machine and account filters
const limitMatch = (f: Filter) => (l: { machine: string; accountName: string }) => matchesAny(f.machine)(l.machine) && matchesAny(f.account)(l.accountName);

// A path under the home folder, shown from ~
function tilde(p: string): string {
    const rel = path.relative(path.resolve(os.homedir()), p);
    return !rel ? '~' : rel.startsWith('..') || path.isAbsolute(rel) ? p : path.join('~', rel);
}

// Menus need a terminal on both ends; --yes, CI and pipes take the defaults instead
const interactiveTerminal = () => !opt.yes && !!process.stdin.isTTY && !!process.stdout.isTTY;

// What to check after an ssh failure, in plain words; empty for one ssh's message already explains
function sshHint(message: string, remote: string, before: string): string {
    const kind = sshFailure(message);
    const parts = remoteParts(remote);
    if (!kind || !parts) return '';
    const H = L().sshHint;
    const text = kind === 'auth' ? (parts.user ? fill(H.authUser, { user: parts.user }) : H.auth) : fill(H[kind], { known: parts.known });
    return before + text;
}

const ok = (text: string) => out(paint('green', '✓ ') + text);
const bad = (text: string) => out(paint('red', '✗ ') + text);

// ---------- questions, shared by setup and the settings menu. Each takes the bold line shown above its
// options, and when answered leaves that line with a ✓ and the answer in place of the menu.

const S = () => L().setup;
const answered = (head: string, answer: string) => out(`${head}  ${paint('green', '✓')} ${answer}`);

async function choose<T>(head: string, intro: string[], choices: Choice<T>[], initial: number): Promise<Choice<T>> {
    out('');
    const c = await select([head, ...intro.map((l) => paint('dim', l))], S().keys, choices, initial);
    answered(head, c.label);
    return c;
}

const yesNo = async (head: string, intro: string[], initial = true) =>
    (await choose(head, intro, [{ label: S().yes, value: true }, { label: S().no, value: false }], initial ? 0 : 1)).value;

async function askLang(head: string, current: string): Promise<string> {
    const codes = Object.keys(LANGS);
    return (await choose(head, [], codes.map((c) => ({ label: LANGS[c]!.langName, value: c })), Math.max(0, codes.indexOf(current)))).value;
}

async function askClaudeDirs(head: string, found: string[], configured: string[]): Promise<string[]> {
    out('');
    const picked = await checklist([head, paint('dim', S().claudeIntro)], S().checkKeys,
        found.map((d) => ({ label: tilde(d), value: d, on: configured.includes(d) })));
    answered(head, picked.map((c) => c.label).join(', '));
    return picked.map((c) => c.value);
}

// ---------- accounts

type AccountChoice = NonNullable<Config['accounts']>[string];
const planText = (a: AccountChoice | undefined) =>
    !a?.plan && a?.price === undefined
        ? '–'
        : a.plan === 'free'
          ? S().sponsored
          : [a.plan && (PLAN_NAMES[a.plan] ?? a.plan) + (isBetaPlan(a.plan) && a.price === undefined ? ' ' + beta() : ''), a.price !== undefined && '$' + a.price]
                .filter(Boolean)
                .join(' · ');

// The Claude accounts behind the given folders, as the login in each says, with the names already given
// to them here or on another machine
function accountsIn(dirs: string[], machine: string, syncDir: string) {
    const known = accountsOf(loadAll(syncDir));
    const seen = new Map<string, Detected & { dir: string; name: string }>();
    for (const dir of dirs) {
        const a = detectAccount(dir, machine);
        if (!seen.has(a.id)) seen.set(a.id, { ...a, dir, name: config.accounts?.[a.id]?.name ?? known.get(a.id)?.name ?? accountLabel(a.id, { folder: a.folder }) });
    }
    return [...seen.values()];
}

// Name, then plan. The plan found in the login is preselected; Team seats, sponsored ones and other
// prices are the user's to say, since the login does not tell.
async function askAccount(head: string, a: Detected & { dir: string; name: string }, current: AccountChoice | undefined): Promise<AccountChoice> {
    // A Team guess is beta, and so is what was found for a folder other than ~/.claude, whose login file
    // is expected inside it (not checked on a real setup yet)
    const unsure = isBetaPlan(a.plan) || path.resolve(a.dir) !== path.resolve(os.homedir(), '.claude');
    const found = (a.plan ? PLAN_NAMES[a.plan] ?? a.plan : S().noPlanFound) + (unsure ? '  ' + beta() : '');
    const name = await askText(head, [fill(S().accountIntro, { plan: found })], fill(S().askName, { current: a.name }), a.name, () => undefined);
    type Pick = { plan?: string; custom?: true };
    const choices: Choice<Pick>[] = [
        ...['pro', 'max5x', 'max20x', 'teamPremium', 'teamStandard'].map((p) => ({
            label: PLAN_NAMES[p]!,
            detail: fill(S().perMonth, { price: '$' + PLANS[p] }) + (isBetaPlan(p) ? '  ' + beta() : '') + (p === a.plan ? '  ·  ' + S().detected : ''),
            value: { plan: p },
        })),
        { label: S().sponsored, detail: S().sponsoredDetail, value: { plan: 'free' } },
        { label: S().customPrice, detail: S().customPriceDetail, value: { custom: true } },
    ];
    const plan = current?.plan ?? a.plan;
    const initial = current?.price !== undefined ? choices.length - 1 : Math.max(0, choices.findIndex((c) => c.value.plan === plan));
    const planHead = paint('bold', fill(S().accountPlan, { name }));
    for (;;) {
        out('');
        const c = await select([planHead], S().keys, choices, initial);
        if (!c.value.custom) {
            answered(planHead, c.label + (isBetaPlan(c.value.plan) ? '  ' + beta() : ''));
            return { name, plan: c.value.plan };
        }
        // An own price keeps the plan it is a price of, for the label
        const scratch = track();
        let price: number | undefined;
        try {
            out(`${planHead}  ${paint('dim', '› ' + c.label)}`);
            for (;;) {
                const typed = (await input(S().askPrice)).replace(/^\$/, '').replace(',', '.');
                if (!typed) break;
                if (/^\d+(\.\d+)?$/.test(typed)) {
                    price = Number(typed);
                    break;
                }
                out(paint('yellow', fill(S().badPrice, { value: typed })));
            }
        } finally {
            scratch.erase();
        }
        if (price !== undefined) {
            const chosen = { name, plan, price };
            answered(planHead, planText(chosen));
            return chosen;
        }
    }
}

// Rows synced before accounts were told apart: one of the accounts, or none ("(unknown)")
async function askUnassigned(head: string, days: number, accounts: { id: string; name: string }[], current?: string): Promise<string | undefined> {
    const choices: Choice<string>[] = [
        ...accounts.map((a) => ({ label: a.name, value: a.id })),
        { label: S().keepUnknown, detail: S().keepUnknownDetail, value: '' },
    ];
    const at = choices.findIndex((c) => c.value === (current ?? ''));
    return (await choose(head, [fill(S().unassignedIntro, { n: days })], choices, at < 0 ? choices.length - 1 : at)).value || undefined;
}

// Days in this machine's own snapshot without an account
const unassignedDays = (syncDir: string, machine: string) =>
    new Set(loadOwn(syncDir, machine, settings.timezone).rows.filter((r) => !r.ac).map((r) => r.d)).size;

const localSyncDir = (c: Config) => path.resolve(c.syncDir ?? path.join(configDir(), 'data'));

// How the data location reads in a menu or summary
const whereText = (c: Config) => (c.remote ? `SSH  ${c.remote}` : c.syncDir ? tilde(c.syncDir) : S().thisMachine);

// Where the data goes: a synced folder, another folder, an SSH server or this machine only.
// Picking one clears the others, so the config never holds two places.
async function askWhere(head: string, next: Config, folders: SyncFolder[]) {
    type Where = { kind: 'folder'; path: string } | { kind: 'remote'; remote: string } | { kind: 'other' | 'ssh' | 'local' };
    // Syncthing's config locations are not checked against a real install yet: beta
    const choices: Choice<Where>[] = folders.map((f) => ({
        label: f.name,
        detail: tilde(dataFolderIn(f.path)) + (f.name === 'Syncthing' ? '  ' + beta() : ''),
        value: { kind: 'folder', path: dataFolderIn(f.path) },
    }));
    if (next.syncDir && !choices.some((c) => c.value.kind === 'folder' && c.value.path === next.syncDir))
        choices.unshift({ label: S().currentFolder, detail: tilde(next.syncDir), value: { kind: 'folder', path: next.syncDir } });
    if (next.remote) choices.unshift({ label: 'SSH', detail: next.remote, value: { kind: 'remote', remote: next.remote } });
    choices.push(
        { label: S().otherFolder, detail: S().otherFolderDetail, value: { kind: 'other' } },
        { label: S().sshServer, detail: S().sshServerDetail, value: { kind: 'ssh' } },
        { label: S().thisMachine, value: { kind: 'local' } },
    );
    // The current setting, else the first synced folder found, else this machine only
    let initial = choices.findIndex((c) => (c.value.kind === 'folder' && c.value.path === next.syncDir) || (c.value.kind === 'remote' && !next.syncDir));
    if (initial < 0) initial = folders.length ? 0 : choices.length - 1;
    const set = (where: { syncDir?: string; remote?: string }) => {
        delete next.syncDir;
        delete next.remote;
        Object.assign(next, where);
        answered(head, whereText(next));
    };
    out('');
    for (;;) {
        const c = await select([head, paint('dim', S().whereIntro)], S().keys, choices, initial);
        const v = c.value;
        if (v.kind === 'folder') return set({ syncDir: v.path });
        if (v.kind === 'remote') return set({ remote: v.remote });
        if (v.kind === 'local') return set({});
        // The typed exchange stays under the question's heading and is wiped once it ends either way
        const scratch = track();
        let answer: string | undefined;
        try {
            out(`${head}  ${paint('dim', '› ' + c.label)}`);
            answer = v.kind === 'other' ? await askFolder() : await askRemote();
        } finally {
            scratch.erase();
        }
        if (answer) return set(v.kind === 'other' ? { syncDir: answer } : { remote: answer });
        initial = choices.indexOf(c);
    }
}

// A full folder path; empty goes back to the menu. A relative answer is almost always a slip ("yes", "n").
async function askFolder(): Promise<string | undefined> {
    for (;;) {
        const answer = await input(S().askPath);
        if (!answer) return undefined;
        const dir = answer.replace(/^~(?=$|[\\/])/, os.homedir());
        if (path.isAbsolute(dir)) return path.resolve(dir);
        out(paint('yellow', fill(S().notAPath, { answer })));
    }
}

// user@host:folder, tried at once; empty goes back to the menu
async function askRemote(): Promise<string | undefined> {
    for (;;) {
        const remote = await input(S().askRemote);
        if (!remote) return undefined;
        const problem = remoteProblem(remote);
        if (problem) {
            out(paint('yellow', fill(problem === 'port' ? S().remotePort : S().remoteInvalid, { remote })));
            continue;
        }
        for (;;) {
            out(paint('dim', fill(S().connecting, { remote })));
            try {
                probe(remote);
                ok(fill(S().connected, { remote }));
                return remote;
            } catch (e) {
                bad(fill(S().connectFailed, { reason: (e as Error).message }));
                const hint = sshHint((e as Error).message, remote, '');
                if (hint) out(paint('dim', '  ' + hint));
            }
            const then = await select([], S().keys, [
                { label: S().retry, value: 'retry' },
                { label: S().saveAnyway, value: 'save' },
                { label: S().back, value: 'back' },
            ]);
            if (then.value === 'save') return remote;
            if (then.value === 'back') break;
        }
    }
}

// Free text with a default: Enter keeps the current value, and check() returns a complaint or nothing
async function askText(head: string, intro: string[], question: string, current: string, check: (v: string) => string | undefined): Promise<string> {
    const scratch = track();
    let answer = current;
    try {
        out('');
        out(head);
        for (const l of intro) out(paint('dim', l));
        for (;;) {
            const typed = await input(question);
            if (!typed) break;
            const complaint = check(typed);
            if (!complaint) {
                answer = typed;
                break;
            }
            out(paint('yellow', complaint));
        }
    } finally {
        scratch.erase();
    }
    out('');
    answered(head, answer);
    return answer;
}

// ---------- setup

async function setup() {
    const runner = currentRunner();
    const interactive = interactiveTerminal();
    if (opt.remove) return removeAutomation(interactive);
    out(paint('bold', fill(S().title, { version: pkg.version })));
    const next: Config = { ...config };
    const folders = syncFolders();
    const foundClaude = [...new Set([...claudeDirs(next.claudeDirs), ...findClaudeDirs()])];

    // [n/total] counts only the questions this run asks; the account steps are counted for every folder
    // found until the user picks the folders, then for the picked ones
    let total = [!opt.lang, !opt['sync-dir'], foundClaude.length > 1, !opt['no-schedule'], !opt['no-hook']].filter(Boolean).length + Math.max(1, foundClaude.length);
    let step = 0;
    const heading = (title: string) => paint('bold', `[${++step}/${total}] ${title}`);

    let wantSchedule = !opt['no-schedule'];
    let wantHook = !opt['no-hook'];
    try {
        // Language first, so everything after it is in that language
        if (opt.lang) next.lang = opt.lang;
        else if (interactive) next.lang = await askLang(heading(S().stepLang), next.lang ?? 'en');
        else next.lang ??= 'en';
        setLang(next.lang);

        if (opt['sync-dir']) next.syncDir = path.resolve(opt['sync-dir']);
        else if (interactive) await askWhere(heading(S().stepWhere), next, folders);
        // without questions: keep the current place, else the first synced folder found
        else if (!next.syncDir && !next.remote && folders[0]) next.syncDir = dataFolderIn(folders[0].path);

        if (foundClaude.length > 1) {
            const configured = next.claudeDirs?.length ? next.claudeDirs : foundClaude;
            next.claudeDirs = interactive ? await askClaudeDirs(heading(S().stepClaude), foundClaude, configured) : configured;
        }

        if (interactive) {
            const machine = next.machine ?? defaultMachine();
            const syncDir = localSyncDir(next);
            const accounts = accountsIn(claudeDirs(next.claudeDirs), machine, syncDir);
            const days = unassignedDays(syncDir, machine);
            total += accounts.length - Math.max(1, foundClaude.length) + (days && accounts.length ? 1 : 0);
            next.accounts = { ...next.accounts };
            for (const a of accounts) next.accounts[a.id] = await askAccount(heading(fill(S().stepAccount, { folder: tilde(a.dir) })), a, next.accounts[a.id]);
            if (days && accounts.length) {
                const owner = await askUnassigned(heading(S().stepUnassigned), days, accounts.map((a) => ({ id: a.id, name: next.accounts![a.id]!.name! })), next.unassigned);
                if (owner) next.unassigned = owner;
                else delete next.unassigned;
            }
        }

        // Hook files depend on the Claude folders just chosen
        const hookFiles = claudeSettingsFiles(claudeDirs(next.claudeDirs));
        if (wantSchedule && interactive) wantSchedule = await yesNo(heading(fill(S().stepSchedule, { time: SCHEDULE_TIME })), [S().scheduleIntro]);
        if (wantHook && interactive) wantHook = await yesNo(heading(S().stepHook), [fill(S().hookIntro, { file: hookFiles.map(tilde).join(', ') })]);

        out('');
        saveConfig(next);
        config = next;
        settings = resolveSettings();
        ok(fill(S().saved, { file: configFile() }));
        if ((wantSchedule || wantHook) && isEphemeral(runner)) out(S().npx);
        else {
            if (wantSchedule) {
                const r = installSchedule(runner);
                if (r.ok) ok(fill(S().scheduled, { what: r.what }));
                else bad(fill(S().scheduleFailed, { reason: r.what }));
            }
            if (wantHook) for (const file of hookFiles) ok(fill(installHook(runner, file) ? S().hookAdded : S().hookKept, { file }));
        }
    } catch (e) {
        if (!(e instanceof Cancelled)) throw e;
        return out('\n' + S().cancelled);
    }
    out('\n' + S().firstSync);
    const d = await data(true);
    const file = dashboard(d);
    out('\n' + (d.rows.length ? summary(d.rows) : L().noData));
    out('\n' + fill(L().dashboard, { file }));
    if (!interactive) return;
    try {
        if (await yesNo(paint('bold', S().openDashboard), [])) openFile(file);
    } catch (e) {
        if (!(e instanceof Cancelled)) throw e;
    }
}

// setup --remove: shows what it will take away and asks first in a terminal
async function removeAutomation(interactive: boolean) {
    const hooks = claudeSettingsFiles(settings.claudeDirs).filter(hookInstalled);
    const schedule = scheduleInstalled();
    if (!schedule && !hooks.length) return out(S().nothingToRemove);
    if (interactive) {
        const items = [...(schedule ? [S().scheduleItem] : []), ...hooks.map((f) => fill(S().hookItem, { file: tilde(f) }))];
        try {
            if (!(await yesNo(paint('bold', S().removeTitle), items.map((i) => '· ' + i)))) return out(S().keptAll);
        } catch (e) {
            if (!(e instanceof Cancelled)) throw e;
            return out(S().keptAll);
        }
    }
    const removed = [removeSchedule(), ...hooks.filter(removeHook)].filter(Boolean);
    for (const w of removed) ok(fill(S().removed, { what: w! }));
}

// ---------- cc-cost config in a terminal: pick a setting, answer its question, saved at once

async function settingsMenu() {
    let at = 0;
    for (;;) {
        const M = L().settingsMenu;
        const items: Choice<string>[] = [
            { label: M.lang, detail: LANGS[settings.lang]?.langName ?? settings.lang, value: 'lang' },
            { label: M.where, detail: whereText(config), value: 'where' },
            { label: M.claude, detail: settings.claudeDirs.map(tilde).join(', ') || '–', value: 'claude' },
            { label: M.accounts, detail: accountsIn(settings.claudeDirs, settings.machine, settings.syncDir).map((a) => a.name).join(', ') || '–', value: 'accounts' },
            { label: M.machine, detail: settings.machine, value: 'machine' },
            { label: M.timezone, detail: settings.timezone, value: 'timezone' },
            { label: M.anonymize, detail: config.anonymizeProjects ? S().yes : S().no, value: 'anonymize' },
            { label: M.done, value: 'done' },
        ];
        let item: Choice<string>;
        try {
            out('');
            item = await select([paint('bold', fill(M.title, { file: tilde(configFile()) }))], S().keys, items, at);
        } catch (e) {
            if (e instanceof Cancelled) return;
            throw e;
        }
        if (item.value === 'done') return;
        at = items.indexOf(item);
        const head = paint('bold', item.label);
        const next: Config = { ...config };
        try {
            if (item.value === 'lang') next.lang = await askLang(head, settings.lang);
            else if (item.value === 'where') await askWhere(head, next, syncFolders());
            else if (item.value === 'claude') {
                const found = [...new Set([...claudeDirs(next.claudeDirs), ...findClaudeDirs()])];
                next.claudeDirs = await askClaudeDirs(head, found, settings.claudeDirs);
            } else if (item.value === 'accounts') {
                // A list of the accounts and the rows without one; pick, answer, back to this list
                const accounts = accountsIn(settings.claudeDirs, settings.machine, settings.syncDir);
                const days = unassignedDays(settings.syncDir, settings.machine);
                out('');
                const pick = await select([head], S().keys, [
                    ...accounts.map((a) => ({ label: a.name, detail: planText(config.accounts?.[a.id] ?? { plan: a.plan }) + '  ' + tilde(a.dir), value: a.id })),
                    ...(days ? [{ label: M.unassigned, detail: config.unassigned ? (accounts.find((a) => a.id === config.unassigned)?.name ?? '') : S().keepUnknown, value: '' }] : []),
                    { label: M.back, value: 'back' },
                ]);
                if (pick.value === 'back') continue;
                next.accounts = { ...next.accounts };
                if (pick.value) next.accounts[pick.value] = await askAccount(paint('bold', pick.label), accounts.find((a) => a.id === pick.value)!, next.accounts[pick.value]);
                else {
                    const owner = await askUnassigned(paint('bold', M.unassigned), days, accounts.map((a) => ({ id: a.id, name: a.name })), next.unassigned);
                    if (owner) next.unassigned = owner;
                    else delete next.unassigned;
                }
            }
            else if (item.value === 'machine')
                next.machine = await askText(head, [M.machineNote], fill(M.askMachine, { current: settings.machine }), settings.machine, () => undefined);
            else if (item.value === 'timezone')
                next.timezone = await askText(head, [], fill(M.askTimezone, { current: settings.timezone }), settings.timezone, (tz) => {
                    try {
                        new Intl.DateTimeFormat('en', { timeZone: tz });
                        return undefined;
                    } catch {
                        return fill(M.badTimezone, { tz });
                    }
                });
            else if (item.value === 'anonymize') next.anonymizeProjects = await yesNo(head, [M.anonymizeIntro], !!config.anonymizeProjects);
        } catch (e) {
            if (!(e instanceof Cancelled)) throw e;
            continue;
        }
        saveConfig(next);
        config = next;
        settings = resolveSettings();
        setLang(settings.lang);
    }
}

async function status() {
    const St = L().status;
    const snaps = loadAll(settings.syncDir);
    const prices = await loadPrices(pricesCache(), { offline: true });
    // each account with the plan given to it here, else the one in its login
    const accounts = accountsIn(settings.claudeDirs, settings.machine, settings.syncDir).map((a) => ({
        name: a.name,
        given: config.accounts?.[a.id] ?? { plan: a.plan },
    }));
    const info = {
        version: pkg.version,
        config: configFile(),
        syncDir: settings.syncDir,
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
        [St.syncDir, info.syncDir],
        [St.remote, info.remote || St.none],
        [St.machine, info.machine],
        [St.machines, info.machines.length ? info.machines.map((m) => fill(St.machineLine, { name: m.name, updated: when(m.updated), days: m.days })).join('\n' + ' '.repeat(0)) : St.none],
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
        const limits = limitsInRange(d.limits, settings.timezone, f.since, f.until, limitMatch(f));
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
            const report = blocksReport(hours, limits, { timezone: settings.timezone, limit });
            emit(report, report.rows.map((r) => Object.fromEntries(report.cols.map((c, i) => [c.title, r[i]]))), !hours.length);
        } else {
            const hours = hourFilterable(f) ? applyHourFilter(d.hours, f) : undefined;
            const r = insights({ rows, hours, limits, table: d.prices.table, timezone: settings.timezone });
            out(opt.json ? JSON.stringify(r.json, null, 2) : rows.length ? r.text : L().noData);
        }
        if (!opt.json && !opt.csv) await footer(d);
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
    if (cmd === 'update') return update();
    if (cmd === 'config') {
        if (rest[0] === 'set') {
            const [key, value = ''] = rest.slice(1);
            if (!CONFIG_KEYS.includes(key as (typeof CONFIG_KEYS)[number]))
                fail(fill(L().configUnknownKey, { key: String(key), keys: CONFIG_KEYS.join(', ') }));
            const problem = key === 'remote' && value ? remoteProblem(value) : undefined;
            if (problem) fail(fill(problem === 'port' ? L().setup.remotePort : L().setup.remoteInvalid, { remote: value }));
            const next: Record<string, unknown> = { ...config };
            next[key!] = key === 'anonymizeProjects' ? value === 'true' : key === 'syncDir' ? path.resolve(value) : key === 'claudeDirs' ? parseDirs(value) : value;
            saveConfig(next as Config);
            return out(fill(L().configSet, { key: key!, value: String(next[key!]) }));
        }
        if (interactiveTerminal() && !opt.json) return settingsMenu();
        out(fill(L().configFile, { file: configFile() }));
        return out(JSON.stringify({ ...settings, languages: Object.keys(LANGS) }, null, 2));
    }
    fail(fill(L().unknownCommand, { cmd }));
}

await main();
