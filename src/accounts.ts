import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { accountLabel } from './aggregate.ts';
import { isBetaPlan, PLAN_NAMES, type Config } from './config.ts';
import { beta } from './format.ts';
import { L } from './i18n.ts';

// Which Claude account a Claude Code folder is logged in to, and on which plan. Claude Code keeps the
// login in .claude.json: inside the folder when CLAUDE_CONFIG_DIR points at it, next to it (~/.claude.json)
// for the default ~/.claude. Only a hash of the account's ids and the plan leave this file: never the
// e-mail address or the name, which sit right beside them.

export interface Detected {
    id: string; // "a" + hash of the account and organization ids, the same on every machine
    plan?: string; // key of PLANS, or a guess for Team (see planOf)
    folder: string; // the folder's own name, a fallback label: ".claude-work"
}

interface OAuthAccount {
    accountUuid?: string;
    organizationUuid?: string;
    organizationType?: string;
    organizationRateLimitTier?: string;
    userRateLimitTier?: string;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 10);

function loginFile(dir: string): string | undefined {
    const candidates = [path.join(dir, '.claude.json')];
    if (path.resolve(dir) === path.resolve(os.homedir(), '.claude')) candidates.push(path.join(os.homedir(), '.claude.json'));
    return candidates.find((f) => fs.existsSync(f));
}

export function detectAccount(dir: string, machine: string): Detected {
    const folder = path.basename(path.resolve(dir));
    let o: OAuthAccount | undefined;
    try {
        const file = loginFile(dir);
        if (file) o = JSON.parse(fs.readFileSync(file, 'utf8')).oauthAccount;
    } catch {
        // unreadable or half-written: fall back to the folder
    }
    // Without a login (an API key, or never signed in) the folder stands for the account. Nothing tells
    // whether ".claude" on two machines is one account, so it is not merged across machines.
    if (!o?.accountUuid) return { id: 'd' + hash(`${machine}|${folder}`), folder };
    return { id: 'a' + hash(`${o.accountUuid}|${o.organizationUuid ?? ''}`), plan: planOf(o), folder };
}

// Max and Pro are named outright. Team only says "Team"; a seat with Max 5x-level limits is most likely
// Premium, and the user confirms either way, since the price (or a sponsored seat) is not in the file.
export function planOf(o: OAuthAccount): string | undefined {
    const tier = `${o.organizationRateLimitTier ?? ''} ${o.userRateLimitTier ?? ''}`;
    switch (o.organizationType) {
        case 'claude_max':
            return /20x/.test(tier) ? 'max20x' : 'max5x';
        case 'claude_pro':
            return 'pro';
        case 'claude_team':
            return /max_(5|20)x/.test(o.userRateLimitTier ?? '') ? 'teamPremium' : 'teamStandard';
        default:
            return undefined;
    }
}

// An account with the name reports show it under: given here, else given on another machine (known), else
// the folder's. One entry per account, even when two folders are logged in to the same one.
export interface NamedAccount extends Detected {
    dir: string;
    name: string;
}
export function namedAccounts(dirs: string[], machine: string, given: Config['accounts'], known: Map<string, { name?: string }>): NamedAccount[] {
    const seen = new Map<string, NamedAccount>();
    for (const dir of dirs) {
        const a = detectAccount(dir, machine);
        if (!seen.has(a.id)) seen.set(a.id, { ...a, dir, name: given?.[a.id]?.name ?? known.get(a.id)?.name ?? accountLabel(a.id, { folder: a.folder }) });
    }
    return [...seen.values()];
}

// How an account's plan reads: "Max 5x", "Team Premium beta", "Sponsored / free", "Team Premium · $100"
export function planText(a: { plan?: string; price?: number } | undefined): string {
    if (!a?.plan && a?.price === undefined) return '–';
    if (a.plan === 'free') return L().setup.sponsored;
    const name = a.plan && (PLAN_NAMES[a.plan] ?? a.plan) + (isBetaPlan(a.plan) && a.price === undefined ? ' ' + beta() : '');
    return [name, a.price !== undefined && '$' + a.price].filter(Boolean).join(' · ');
}
