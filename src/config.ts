import fs from 'node:fs';
import path from 'node:path';
import { configDir } from './paths.ts';
import type { AccountMeta } from './types.ts';

export interface Config {
    syncDir?: string; // folder shared between machines (Dropbox, iCloud, OneDrive, ...)
    machine?: string; // display name for this machine; defaults to the hostname
    lang?: string;
    timezone?: string; // IANA zone used to split days; defaults to the system zone
    plan?: string; // key of PLANS, for the plan-value multiple
    anonymizeProjects?: boolean;
    pricing?: Record<string, number[]>; // per-model overrides, same layout as PRICES
    remote?: string; // user@host:path of a server reached over ssh
    claudeDirs?: string[]; // Claude Code data folders, one per account; replaces the defaults and CLAUDE_CONFIG_DIR
    accounts?: Record<string, Omit<AccountMeta, 'folder'>>; // name, plan and price per account id
    unassigned?: string; // account id for rows synced before accounts were told apart
}

// Monthly subscription price in USD. Team prices are per seat, billed monthly; an annual or negotiated
// price goes into the account's own price.
export const PLANS: Record<string, number> = { pro: 20, max5x: 100, max20x: 200, teamStandard: 25, teamPremium: 125 };

// $ a month for an account: its own price, its plan's, 0 for a sponsored seat, or unknown
export const planPrice = (plan?: string, price?: number): number | undefined =>
    price ?? (plan === 'free' ? 0 : plan ? PLANS[plan] : undefined);

export const CONFIG_KEYS = ['syncDir', 'machine', 'lang', 'timezone', 'plan', 'anonymizeProjects', 'claudeDirs', 'remote'] as const;

export const configFile = () => path.join(configDir(), 'config.json');

export function loadConfig(): Config {
    const file = configFile();
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

export function saveConfig(config: Config) {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2) + '\n');
}
