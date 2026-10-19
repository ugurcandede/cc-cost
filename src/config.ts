import fs from 'node:fs';
import path from 'node:path';
import { configDir } from './paths.ts';
import type { AccountMeta } from './types.ts';

export { isBetaPlan, PLAN_NAMES, planPrice, PLANS } from './plans.ts';

export interface Config {
    syncDir?: string; // folder shared between machines (Dropbox, iCloud, OneDrive, ...)
    machine?: string; // display name for this machine; defaults to the hostname
    lang?: string;
    timezone?: string; // IANA zone used to split days; defaults to the system zone
    plan?: string; // key of PLANS, for usage synced before accounts were told apart; accounts carry their own
    anonymizeProjects?: boolean;
    pricing?: Record<string, number[]>; // cc-cost 1.x price overrides; copied into pricing.json in the data folder on the next sync
    remote?: string; // user@host:path of a server reached over ssh; the data lives there, not on this machine
    claudeDirs?: string[]; // Claude Code data folders, one per account; replaces the defaults and CLAUDE_CONFIG_DIR
    accounts?: Record<string, Omit<AccountMeta, 'folder'>>; // name, plan and price per account id
    unassigned?: string; // account id for rows synced before accounts were told apart
}

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
