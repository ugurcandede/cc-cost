import fs from 'node:fs';
import path from 'node:path';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface UpdateCache {
    checked: string; // ISO
    latest: string;
}

// x.y.z comparison; a pre-release (x.y.z-beta) never counts as newer than its release
export function isNewer(candidate: string, current: string): boolean {
    const parse = (v: string) => {
        const [core, pre] = v.split('-');
        return { n: (core ?? '').split('.').map((x) => Number(x) || 0), pre: !!pre };
    };
    const a = parse(candidate), b = parse(current);
    for (let i = 0; i < 3; i++) if ((a.n[i] ?? 0) !== (b.n[i] ?? 0)) return (a.n[i] ?? 0) > (b.n[i] ?? 0);
    return !a.pre && b.pre;
}

// Latest published version, asked of the registry at most once a day unless `force`.
export async function latestVersion(name: string, cacheFile: string, opts: { offline?: boolean; force?: boolean } = {}): Promise<string | undefined> {
    let cached: UpdateCache | undefined;
    try {
        cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch {
        // first check
    }
    const fresh = cached && Date.now() - Date.parse(cached.checked) < MAX_AGE_MS;
    if (opts.offline || (fresh && !opts.force)) return cached?.latest;
    try {
        const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}/latest`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const latest = String(((await res.json()) as { version?: string }).version ?? '');
        if (!latest) throw new Error('no version');
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify({ checked: new Date().toISOString(), latest } satisfies UpdateCache));
        return latest;
    } catch {
        if (opts.force) throw new Error('registry unreachable');
        return cached?.latest; // offline or registry down: say nothing new
    }
}

export type InstallMethod = 'npm' | 'yarn' | 'pnpm' | 'ephemeral' | 'unknown';

// How this copy was installed, read from where its script lives
export function installMethod(script: string): InstallMethod {
    if (/[\\/](_npx|dlx(-\d+)?)[\\/]/.test(script)) return 'ephemeral';
    if (!/[\\/]node_modules[\\/]@ugurcandede[\\/]cc-cost[\\/]/.test(script)) return 'unknown'; // e.g. a git checkout
    if (/[\\/]pnpm[\\/]/i.test(script)) return 'pnpm';
    if (/[\\/]yarn[\\/](data[\\/])?global[\\/]/i.test(script)) return 'yarn';
    return 'npm';
}

export const updateCommand: Record<'npm' | 'yarn' | 'pnpm', (pkg: string) => string[]> = {
    npm: (pkg) => ['npm', 'i', '-g', `${pkg}@latest`],
    yarn: (pkg) => ['yarn', 'global', 'add', `${pkg}@latest`],
    pnpm: (pkg) => ['pnpm', 'add', '-g', `${pkg}@latest`],
};
