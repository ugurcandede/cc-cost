import os from 'node:os';
import path from 'node:path';
import { namedAccounts, planText, type NamedAccount } from './accounts.ts';
import { accountsOf } from './aggregate.ts';
import { configFile, isBetaPlan, PLAN_NAMES, PLANS, type Config } from './config.ts';
import { beta, paint } from './format.ts';
import { fill, L, LANGS, setLang } from './i18n.ts';
import { claudeDirs, defaultMachine, findClaudeDirs, tilde, validMachine } from './paths.ts';
import { Cancelled, checklist, input, select, track, type Choice } from './prompt.ts';
import { probe, remoteProblem, sshHint } from './remote.ts';
import {
    claudeSettingsFiles, dataFolderIn, hookInstalled, installHook, installSchedule, isEphemeral, removeHook, removeSchedule,
    SCHEDULE_TIME, scheduleInstalled, syncFolders, type Runner, type SyncFolder,
} from './setup.ts';
import { loadAll, loadOwn } from './snapshot.ts';
import type { Settings } from './sync.ts';

// The questions `setup` and `config` ask in a terminal. Each question prints a bold heading above its
// menu or text box and, once answered, leaves that heading with a ✓ and the answer in its place.

export interface Wizard {
    config: Config;
    settings: Settings;
    out: (text: string) => void;
    save: (next: Config) => void; // writes config.json; config and settings then reflect it
    dataDir: (next: Config) => string; // the data folder a config reads, pulled from its server when it has one
}

const S = () => L().setup;
const validTimezone = (tz: string) => {
    try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
};

// ---------- the building blocks

function answered(w: Wizard, head: string, answer: string) {
    w.out(`${head}  ${paint('green', '✓')} ${answer}`);
}

async function choose<T>(w: Wizard, head: string, intro: string[], choices: Choice<T>[], initial: number): Promise<Choice<T>> {
    w.out('');
    const c = await select([head, ...intro.map((l) => paint('dim', l))], S().keys, choices, initial);
    answered(w, head, c.label);
    return c;
}

export async function confirm(w: Wizard, head: string, intro: string[] = [], initial = true): Promise<boolean> {
    return (await choose(w, head, intro, [{ label: S().yes, value: true }, { label: S().no, value: false }], initial ? 0 : 1)).value;
}

// Free text with a default: Enter keeps the current value, and check() returns a complaint or nothing
async function askText(w: Wizard, head: string, intro: string[], question: string, current: string, check: (v: string) => string | undefined) {
    const scratch = track();
    let answer = current;
    try {
        w.out('');
        w.out(head);
        for (const l of intro) w.out(paint('dim', l));
        for (;;) {
            const typed = await input(question);
            if (!typed) break;
            const complaint = check(typed);
            if (!complaint) {
                answer = typed;
                break;
            }
            w.out(paint('yellow', complaint));
        }
    } finally {
        scratch.erase();
    }
    w.out('');
    answered(w, head, answer);
    return answer;
}

// ---------- the questions

async function askLang(w: Wizard, head: string, current: string): Promise<string> {
    const codes = Object.keys(LANGS);
    return (await choose(w, head, [], codes.map((c) => ({ label: LANGS[c]!.langName, value: c })), Math.max(0, codes.indexOf(current)))).value;
}

async function askClaudeDirs(w: Wizard, head: string, found: string[], configured: string[]): Promise<string[]> {
    w.out('');
    const picked = await checklist([head, paint('dim', S().claudeIntro)], S().checkKeys,
        found.map((d) => ({ label: tilde(d), value: d, on: configured.includes(d) })));
    answered(w, head, picked.map((c) => c.label).join(', '));
    return picked.map((c) => c.value);
}

// How the data location reads in a menu or summary
const whereText = (c: Config) => (c.remote ? `SSH  ${c.remote}` : c.syncDir ? tilde(c.syncDir) : S().thisMachine);

// Where the data goes: a synced folder, another folder, an SSH server or this machine only.
// Picking one clears the others, so the config never holds two places.
async function askWhere(w: Wizard, head: string, next: Config, folders: SyncFolder[]) {
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
        answered(w, head, whereText(next));
    };
    w.out('');
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
            w.out(`${head}  ${paint('dim', '› ' + c.label)}`);
            answer = v.kind === 'other' ? await askFolder(w) : await askRemote(w);
        } finally {
            scratch.erase();
        }
        if (answer) return set(v.kind === 'other' ? { syncDir: answer } : { remote: answer });
        initial = choices.indexOf(c);
    }
}

// A full folder path; empty goes back to the menu. A relative answer is almost always a slip ("yes", "n").
async function askFolder(w: Wizard): Promise<string | undefined> {
    for (;;) {
        const answer = await input(S().askPath);
        if (!answer) return undefined;
        const dir = answer.replace(/^~(?=$|[\\/])/, os.homedir());
        if (path.isAbsolute(dir)) return path.resolve(dir);
        w.out(paint('yellow', fill(S().notAPath, { answer })));
    }
}

// user@host:folder, tried at once; empty goes back to the menu
async function askRemote(w: Wizard): Promise<string | undefined> {
    for (;;) {
        const remote = await input(S().askRemote);
        if (!remote) return undefined;
        const problem = remoteProblem(remote);
        if (problem) {
            w.out(paint('yellow', fill(problem === 'port' ? S().remotePort : S().remoteInvalid, { remote })));
            continue;
        }
        for (;;) {
            w.out(paint('dim', fill(S().connecting, { remote })));
            try {
                probe(remote);
                w.out(paint('green', '✓ ') + fill(S().connected, { remote }));
                return remote;
            } catch (e) {
                const reason = (e as Error).message;
                w.out(paint('red', '✗ ') + fill(S().connectFailed, { reason }));
                const hint = sshHint(reason, remote);
                if (hint) w.out(paint('dim', '  ' + hint));
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

// ---------- accounts

type AccountChoice = NonNullable<Config['accounts']>[string];

// The accounts behind the folders, named as given here or on another machine
function accountsIn(w: Wizard, dirs: string[], machine = w.settings.machine, syncDir = w.settings.syncDir): NamedAccount[] {
    return namedAccounts(dirs, machine, w.config.accounts, accountsOf(loadAll(syncDir)));
}

// Name, then plan. The plan found in the login is preselected; Team seats, sponsored ones and other
// prices are the user's to say, since the login does not tell.
async function askAccount(w: Wizard, head: string, a: NamedAccount, current: AccountChoice | undefined): Promise<AccountChoice> {
    // A Team guess is beta, and so is what was found for a folder other than ~/.claude, whose login file
    // is expected inside it (not checked on a real setup yet)
    const unsure = isBetaPlan(a.plan) || path.resolve(a.dir) !== path.resolve(os.homedir(), '.claude');
    const found = (a.plan ? PLAN_NAMES[a.plan] ?? a.plan : S().noPlanFound) + (unsure ? '  ' + beta() : '');
    const name = await askText(w, head, [fill(S().accountIntro, { plan: found })], fill(S().askName, { current: a.name }), a.name, () => undefined);
    type Pick = { plan?: string; custom?: true };
    const choices: Choice<Pick>[] = [
        ...Object.keys(PLANS).map((p) => ({
            label: PLAN_NAMES[p] ?? p,
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
        w.out('');
        const c = await select([planHead], S().keys, choices, initial);
        if (!c.value.custom) {
            answered(w, planHead, c.label + (isBetaPlan(c.value.plan) ? '  ' + beta() : ''));
            return { name, plan: c.value.plan };
        }
        // An own price keeps the plan it is a price of, for the label
        const scratch = track();
        let price: number | undefined;
        try {
            w.out(`${planHead}  ${paint('dim', '› ' + c.label)}`);
            for (;;) {
                const typed = (await input(S().askPrice)).replace(/^\$/, '').replace(',', '.');
                if (!typed) break;
                if (/^\d+(\.\d+)?$/.test(typed)) {
                    price = Number(typed);
                    break;
                }
                w.out(paint('yellow', fill(S().badPrice, { value: typed })));
            }
        } finally {
            scratch.erase();
        }
        if (price !== undefined) {
            const chosen = { name, plan, price };
            answered(w, planHead, planText(chosen));
            return chosen;
        }
    }
}

// Rows synced before accounts were told apart: one of the accounts, or none ("(unknown)")
async function askUnassigned(w: Wizard, head: string, days: number, accounts: { id: string; name: string }[], current?: string) {
    const choices: Choice<string>[] = [
        ...accounts.map((a) => ({ label: a.name, value: a.id })),
        { label: S().keepUnknown, detail: S().keepUnknownDetail, value: '' },
    ];
    const at = choices.findIndex((c) => c.value === (current ?? ''));
    return (await choose(w, head, [fill(S().unassignedIntro, { n: days })], choices, at < 0 ? choices.length - 1 : at)).value || undefined;
}

// Days in this machine's own snapshot without an account
const unassignedDays = (w: Wizard, syncDir: string, machine: string) =>
    new Set(loadOwn(syncDir, machine, w.settings.timezone).rows.filter((r) => !r.ac).map((r) => r.d)).size;

// ---------- setup

export interface SetupFlags {
    lang?: string;
    syncDir?: string;
    schedule: boolean;
    hook: boolean;
}

// Asks the questions and saves; installs the schedule and hook. Returns false when cancelled.
export async function setup(w: Wizard, runner: Runner, flags: SetupFlags, interactive: boolean, version: string): Promise<boolean> {
    w.out(paint('bold', fill(S().title, { version })));
    const next: Config = { ...w.config };
    const folders = syncFolders();
    const foundClaude = [...new Set([...claudeDirs(next.claudeDirs), ...findClaudeDirs()])];

    // [n/total] counts the questions this run asks. One account step per Claude folder found, corrected
    // once the folders are picked and the accounts behind them are known.
    let total = [!flags.lang, !flags.syncDir, foundClaude.length > 1, flags.schedule, flags.hook].filter(Boolean).length + Math.max(1, foundClaude.length);
    let step = 0;
    const heading = (title: string) => paint('bold', `[${++step}/${total}] ${title}`);

    let wantSchedule = flags.schedule;
    let wantHook = flags.hook;
    try {
        // Language first, so everything after it is in that language
        if (flags.lang) next.lang = flags.lang;
        else if (interactive) next.lang = await askLang(w, heading(S().stepLang), next.lang ?? 'en');
        else next.lang ??= 'en';
        setLang(next.lang);

        if (flags.syncDir) {
            next.syncDir = path.resolve(flags.syncDir);
            delete next.remote; // the flag names the place, as the question would
        } else if (interactive) await askWhere(w, heading(S().stepWhere), next, folders);
        // without questions: keep the current place, else the first synced folder found
        else if (!next.syncDir && !next.remote && folders[0]) next.syncDir = dataFolderIn(folders[0].path);

        if (foundClaude.length > 1) {
            const configured = next.claudeDirs?.length ? next.claudeDirs : foundClaude;
            next.claudeDirs = interactive ? await askClaudeDirs(w, heading(S().stepClaude), foundClaude, configured) : configured;
        }

        if (interactive) {
            const machine = next.machine ?? defaultMachine();
            const syncDir = w.dataDir(next);
            const accounts = accountsIn(w, claudeDirs(next.claudeDirs), machine, syncDir);
            const days = accounts.length ? unassignedDays(w, syncDir, machine) : 0;
            total += accounts.length - Math.max(1, foundClaude.length) + (days ? 1 : 0);
            next.accounts = { ...next.accounts };
            for (const a of accounts) next.accounts[a.id] = await askAccount(w, heading(fill(S().stepAccount, { folder: tilde(a.dir) })), a, next.accounts[a.id]);
            if (days) {
                const owner = await askUnassigned(w, heading(S().stepUnassigned), days, accounts.map((a) => ({ id: a.id, name: next.accounts![a.id]!.name! })), next.unassigned);
                if (owner) next.unassigned = owner;
                else delete next.unassigned;
            }
        }

        // Hook files depend on the Claude folders just chosen
        const hookFiles = claudeSettingsFiles(claudeDirs(next.claudeDirs));
        if (wantSchedule && interactive) wantSchedule = await confirm(w, heading(fill(S().stepSchedule, { time: SCHEDULE_TIME })), [S().scheduleIntro]);
        if (wantHook && interactive) wantHook = await confirm(w, heading(S().stepHook), [fill(S().hookIntro, { file: hookFiles.map(tilde).join(', ') })]);

        w.out('');
        w.save(next);
        w.out(paint('green', '✓ ') + fill(S().saved, { file: configFile() }));
        if ((wantSchedule || wantHook) && isEphemeral(runner)) w.out(S().npx);
        else {
            if (wantSchedule) {
                const r = installSchedule(runner);
                w.out(r.ok ? paint('green', '✓ ') + fill(S().scheduled, { what: r.what }) : paint('red', '✗ ') + fill(S().scheduleFailed, { reason: r.what }));
            }
            if (wantHook) for (const file of hookFiles) w.out(paint('green', '✓ ') + fill(installHook(runner, file) ? S().hookAdded : S().hookKept, { file }));
        }
        return true;
    } catch (e) {
        if (!(e instanceof Cancelled)) throw e;
        w.out('\n' + S().cancelled);
        return false;
    }
}

// setup --remove: shows what it will take away and asks first in a terminal
export async function removeAutomation(w: Wizard, interactive: boolean) {
    const hooks = claudeSettingsFiles(w.settings.claudeDirs).filter(hookInstalled);
    const schedule = scheduleInstalled();
    if (!schedule && !hooks.length) return w.out(S().nothingToRemove);
    if (interactive) {
        const items = [...(schedule ? [S().scheduleItem] : []), ...hooks.map((f) => fill(S().hookItem, { file: tilde(f) }))];
        try {
            if (!(await confirm(w, paint('bold', S().removeTitle), items.map((i) => '· ' + i)))) return w.out(S().keptAll);
        } catch (e) {
            if (!(e instanceof Cancelled)) throw e;
            return w.out(S().keptAll);
        }
    }
    for (const what of [removeSchedule(), ...hooks.filter(removeHook)]) if (what) w.out(paint('green', '✓ ') + fill(S().removed, { what }));
}

// ---------- cc-cost config in a terminal: pick a setting, answer its question, saved at once

export async function settingsMenu(w: Wizard) {
    let at = 0;
    for (;;) {
        const M = L().settingsMenu;
        const { config, settings } = w;
        const items: Choice<string>[] = [
            { label: M.lang, detail: LANGS[settings.lang]?.langName ?? settings.lang, value: 'lang' },
            { label: M.where, detail: whereText(config), value: 'where' },
            { label: M.claude, detail: settings.claudeDirs.map(tilde).join(', ') || '–', value: 'claude' },
            { label: M.accounts, detail: accountsIn(w, settings.claudeDirs).map((a) => a.name).join(', ') || '–', value: 'accounts' },
            { label: M.machine, detail: settings.machine, value: 'machine' },
            { label: M.timezone, detail: settings.timezone, value: 'timezone' },
            { label: M.anonymize, detail: config.anonymizeProjects ? S().yes : S().no, value: 'anonymize' },
            { label: M.done, value: 'done' },
        ];
        let item: Choice<string>;
        try {
            w.out('');
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
            if (item.value === 'lang') next.lang = await askLang(w, head, settings.lang);
            else if (item.value === 'where') await askWhere(w, head, next, syncFolders());
            else if (item.value === 'claude') {
                const found = [...new Set([...claudeDirs(next.claudeDirs), ...findClaudeDirs()])];
                next.claudeDirs = await askClaudeDirs(w, head, found, settings.claudeDirs);
            } else if (item.value === 'accounts') {
                if (!(await editAccounts(w, head, next))) continue;
            } else if (item.value === 'machine')
                next.machine = await askText(w, head, [M.machineNote], fill(M.askMachine, { current: settings.machine }), settings.machine,
                    (name) => (validMachine(name) ? undefined : fill(L().configCheck.machine, { value: name })));
            else if (item.value === 'timezone')
                next.timezone = await askText(w, head, [], fill(M.askTimezone, { current: settings.timezone }), settings.timezone,
                    (tz) => (validTimezone(tz) ? undefined : fill(M.badTimezone, { tz })));
            else if (item.value === 'anonymize') next.anonymizeProjects = await confirm(w, head, [M.anonymizeIntro], !!config.anonymizeProjects);
        } catch (e) {
            if (!(e instanceof Cancelled)) throw e;
            continue;
        }
        w.save(next);
    }
}

// A list of the accounts and the rows without one; pick one, answer, and the change lands in `next`.
// Returns false when the user went back without picking.
async function editAccounts(w: Wizard, head: string, next: Config): Promise<boolean> {
    const M = L().settingsMenu;
    const accounts = accountsIn(w, w.settings.claudeDirs);
    const days = unassignedDays(w, w.settings.syncDir, w.settings.machine);
    const given = (a: NamedAccount) => w.config.accounts?.[a.id] ?? { plan: a.plan };
    w.out('');
    const pick = await select([head], S().keys, [
        ...accounts.map((a) => ({ label: a.name, detail: planText(given(a)) + '  ' + tilde(a.dir), value: a.id })),
        ...(days ? [{ label: M.unassigned, detail: accounts.find((a) => a.id === w.config.unassigned)?.name ?? S().keepUnknown, value: '' }] : []),
        { label: M.back, value: 'back' },
    ]);
    if (pick.value === 'back') return false;
    next.accounts = { ...next.accounts };
    if (pick.value) next.accounts[pick.value] = await askAccount(w, paint('bold', pick.label), accounts.find((a) => a.id === pick.value)!, next.accounts[pick.value]);
    else {
        const owner = await askUnassigned(w, paint('bold', M.unassigned), days, accounts, next.unassigned);
        if (owner) next.unassigned = owner;
        else delete next.unassigned;
    }
    return true;
}
