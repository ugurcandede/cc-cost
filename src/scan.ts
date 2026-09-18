import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { normModel } from './pricing.ts';
import { CTX_BOUNDS, T, T_LEN, UNKNOWN, type HourRow, type LimitEvent, type Row, type SessionMeta } from './types.ts';

export interface ScanResult {
    rows: Row[];
    hourly: HourRow[];
    sessions: Record<string, SessionMeta>;
    limits: LimitEvent[];
    files: number;
    duplicates: number;
}

// The subset of a transcript line we read. Everything else, including message content, is ignored.
interface Usage {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
    output_tokens_details?: { thinking_tokens?: number };
    server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number };
    speed?: string;
}

interface Call {
    ts: string;
    session: string;
    cwd: string;
    model: string;
    usage: Usage;
    agent?: string;
    skill?: string;
    mcp?: string;
    effort?: string;
    entrypoint?: string;
    background: boolean;
}

const zeros = () => new Array<number>(T_LEN).fill(0);

// Snapshots are synced JSON; keep absent dimensions out of them instead of writing nulls.
function defined<O extends object>(o: O): O {
    for (const k of Object.keys(o) as (keyof O)[]) if (o[k] === undefined) delete o[k];
    return o;
}

// The git repository a working directory belongs to, so a session that cd's into src/foo still
// counts for its repo. Missing directories (deleted since) resolve through their nearest existing
// parent; worktrees resolve to their main repository. Falls back to the directory itself.
export function projectRoot(cwd: string): string {
    // Walking up a relative path (or a Windows path read on macOS/Linux) would search wherever cc-cost runs from
    if (!path.isAbsolute(cwd)) return cwd;
    const home = os.homedir();
    for (let dir = cwd; ; ) {
        // a dotfiles repo in $HOME must not claim every project under it
        if (dir !== home || dir === cwd) {
            const git = path.join(dir, '.git');
            try {
                if (fs.statSync(git).isDirectory()) return dir;
                const gitdir = fs.readFileSync(git, 'utf8').match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
                if (!gitdir) return dir;
                const [main, worktree] = path.resolve(dir, gitdir).split(/[\\/]\.git[\\/]worktrees[\\/]/);
                return worktree ? main! : dir;
            } catch {
                // no .git here, or the directory no longer exists
            }
        }
        const up = path.dirname(dir);
        if (up === dir) return cwd;
        dir = up;
    }
}

function listJsonl(dir: string, out: string[]) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) listJsonl(p, out);
        else if (e.name.endsWith('.jsonl')) out.push(p);
    }
}

// ISO timestamp -> local date and hour in the given IANA zone
export function localClock(timezone: string) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    return (iso: string) => {
        const p: Record<string, string> = {};
        for (const part of fmt.formatToParts(new Date(iso))) p[part.type] = part.value;
        return { d: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour), min: Number(p.minute) };
    };
}

function addUsage(t: number[], u: Usage) {
    const cc = u.cache_creation ?? {};
    // Older transcripts only have the combined counter; treat it as the 5m tier.
    const w5 = cc.ephemeral_5m_input_tokens ?? (cc.ephemeral_1h_input_tokens ? 0 : u.cache_creation_input_tokens ?? 0);
    const w1 = cc.ephemeral_1h_input_tokens ?? 0;
    const input = u.input_tokens ?? 0, read = u.cache_read_input_tokens ?? 0;
    t[T.input]! += input;
    t[T.write5m]! += w5;
    t[T.write1h]! += w1;
    t[T.read]! += read;
    t[T.output]! += u.output_tokens ?? 0;
    t[T.calls]! += 1;
    t[T.thinking]! += u.output_tokens_details?.thinking_tokens ?? 0;
    t[T.webSearch]! += u.server_tool_use?.web_search_requests ?? 0;
    t[T.webFetch]! += u.server_tool_use?.web_fetch_requests ?? 0;
    const context = input + w5 + w1 + read;
    t[T.maxContext] = Math.max(t[T.maxContext]!, context);
    const bucket = CTX_BOUNDS.findIndex((b) => context < b);
    t[T.ctx50k + (bucket < 0 ? CTX_BOUNDS.length : bucket)]! += 1;
}

export async function scan(dirs: string[], opts: { timezone: string; anonymize: boolean }): Promise<ScanResult> {
    const files: string[] = [];
    for (const dir of dirs) listJsonl(path.join(dir, 'projects'), files);

    const calls = new Map<string, Call>();
    const limits = new Map<string, LimitEvent>();
    let duplicates = 0;

    for (const file of files) {
        const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
        for await (const line of rl) {
            if (!line.includes('"usage"') && !line.includes('"quotaLimits"')) continue;
            let d;
            try {
                d = JSON.parse(line);
            } catch {
                continue; // a line cut off by a crash or a concurrent write
            }
            const q = d.quotaLimits;
            if (q && d.timestamp) {
                // Retries inside one limit period share resetsAt; keep the first hit of each period.
                const key = `${q.rateLimitType}|${q.status}|${q.resetsAt ?? d.timestamp}`;
                const seen = limits.get(key);
                if (!seen || d.timestamp < seen.ts)
                    limits.set(key, { ts: d.timestamp, type: String(q.rateLimitType), status: String(q.status), ...(typeof q.resetsAt === 'number' && { resetsAt: q.resetsAt }) });
            }

            const msg = d.message;
            if (d.type !== 'assistant' || !msg?.usage || !msg.model || msg.model === '<synthetic>' || !d.timestamp) continue;

            // Resume and compaction rewrite the same message into several files; streaming writes one
            // line per content block with output_tokens still growing. Keep the most complete copy.
            const key = `${msg.id}|${d.requestId}`;
            const prev = calls.get(key);
            if (prev) duplicates++;
            if (prev && (prev.usage.output_tokens ?? 0) >= (msg.usage.output_tokens ?? 0)) continue;
            calls.set(key, {
                ts: d.timestamp,
                session: d.sessionId ?? '',
                cwd: d.cwd ?? '',
                model: msg.model,
                usage: msg.usage,
                agent: d.isSidechain ? d.attributionAgent || 'subagent' : undefined,
                skill: d.attributionSkill,
                mcp: d.attributionMcpServer,
                effort: d.effort,
                entrypoint: d.entrypoint,
                background: d.sessionKind === 'bg',
            });
        }
    }

    const at = localClock(opts.timezone);
    const projects = new Map<string, string>();
    const project = (cwd: string) => {
        let name = projects.get(cwd);
        if (name === undefined) {
            name = (cwd && projectRoot(cwd).split(/[\\/]/).filter(Boolean).pop()) || UNKNOWN;
            if (opts.anonymize) name = 'p-' + createHash('sha256').update(name).digest('hex').slice(0, 8);
            projects.set(cwd, name);
        }
        return name;
    };

    const rows = new Map<string, Row>(), hourly = new Map<string, HourRow>();
    const sessions: Record<string, SessionMeta> = {};
    for (const c of calls.values()) {
        const { d, h } = at(c.ts);
        const m = normModel(c.model), f = c.usage.speed === 'fast' ? (1 as const) : undefined, p = project(c.cwd);
        const bg = c.background ? (1 as const) : undefined;
        const rowKey = [d, p, c.session, m, f, c.agent, c.skill, c.mcp, c.effort, c.entrypoint, bg].join('\0');
        let row = rows.get(rowKey);
        if (!row) {
            row = defined({ d, p, s: c.session, m, f, a: c.agent, k: c.skill, x: c.mcp, e: c.effort, ep: c.entrypoint, bg, t: zeros() });
            rows.set(rowKey, row);
        }
        addUsage(row.t, c.usage);

        const hourKey = `${d}|${h}|${m}|${f}`;
        let hr = hourly.get(hourKey);
        if (!hr) hourly.set(hourKey, (hr = defined({ d, h, m, f, t: zeros() })));
        addUsage(hr.t, c.usage);

        const s = (sessions[c.session] ??= { p, first: c.ts, last: c.ts });
        if (c.ts < s.first) s.first = c.ts;
        if (c.ts > s.last) s.last = c.ts;
    }

    return { rows: [...rows.values()], hourly: [...hourly.values()], sessions, limits: [...limits.values()], files: files.length, duplicates };
}
