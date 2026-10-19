import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fill, L } from './i18n.ts';

// A server reached with the system's ssh and scp, written one of two ways:
//   user@host:path                       scp's own syntax, port 22
//   ssh://user@host:port/path            a URL, for another port; scp:// is the same
// The path is relative to the remote home folder; in a URL, "//" after the port starts an absolute one
// (ssh://pi@host:2222//srv/cc-cost). In the scp form only the first ":" separates host and path, so a
// second one means a port typed into the path (pi@host:2222:cc-cost): refused, see remoteProblem.
export interface Remote {
    host: string; // [user@]host, IPv6 in brackets
    port?: number;
    dir: string;
}

export function parseRemote(remote: string): Remote | undefined {
    const text = remote.trim();
    const url = /^(?:ssh|scp):\/\/((?:[^@/\s]+@)?(?:\[[^\]\s]+\]|[^:/\s]+))(?::(\d+))?(?:\/(.*))?$/.exec(text);
    if (url) {
        const port = url[2] ? Number(url[2]) : undefined;
        if (port !== undefined && (port < 1 || port > 65535)) return undefined;
        const p = url[3] ?? '';
        return { host: url[1]!, port, dir: p.startsWith('/') ? p.replace(/\/+$/, '') || '/' : home(p) };
    }
    if (/^[a-z]+:\/\//i.test(text)) return undefined; // another scheme
    const m = /^([^:\s]+):([^:]*)$/.exec(text);
    return m ? { host: m[1]!, dir: home(m[2]!) } : undefined;
}
// "~/x", "x/" and "" all mean a folder in the home folder
const home = (p: string) => p.replace(/^~\/?/, '').replace(/\/+$/, '') || '.';

// Why a remote was refused: a port typed into the scp form, or neither form at all
export function remoteProblem(remote: string): 'port' | 'form' | undefined {
    const text = remote.trim();
    if (parseRemote(text)) return undefined;
    return !/^[a-z]+:\/\//i.test(text) && /^[^:\s]+:.*:/.test(text) ? 'port' : 'form';
}

// Quoted for the remote POSIX shell
export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// Never prompt: the schedule and the hook have no one to answer a password or host-key question.
// A new server's host key is recorded on first contact; a key that changes later is still refused.
const SSH_OPTS = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10'];

// ssh takes the port as -p and an IPv6 host without brackets; scp takes -P and keeps the brackets
const sshArgs = (r: Remote) => [...SSH_OPTS, ...(r.port ? ['-p', String(r.port)] : []), r.host.replace(/[[\]]/g, '')];
const scpArgs = (r: Remote) => [...SSH_OPTS, ...(r.port ? ['-P', String(r.port)] : [])];

// What ssh said, less the notice about the host key it just recorded. Not LogLevel=ERROR: that would also
// hide why a connection ended, which ssh says at its default level ("Connection closed by ...").
const said = (stderr: string) => stderr.split('\n').filter((l) => !/^Warning: Permanently added/.test(l)).join('\n').trim();

function run(cmd: string, args: string[], input?: Buffer) {
    const r = spawnSync(cmd, args, { input, encoding: 'utf8', timeout: 60_000 });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(said(r.stderr) || `${cmd} exited with ${r.status}`);
}

function parsed(remote: string): Remote {
    const r = parseRemote(remote);
    if (!r) throw new Error(`not user@host:path or ssh://user@host:port/path: ${remote}`);
    return r;
}

// The data lives on the server. A command works on a mirror of the server's folder in a temporary
// folder: pulled before the first read, the changed files pushed at the end, and removed on exit.
export interface Mirror {
    dir: string;
    push(): string[]; // uploads what changed since the pull or the last push; returns those files
    close(): void;
}

export function openMirror(remote: string): Mirror {
    const r = parsed(remote);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cost-'));
    try {
        // the folder and machines/ exist from the first use on, so the glob below always has something to copy
        run('ssh', [...sshArgs(r), `mkdir -p ${shQuote(r.dir + '/machines')}`]);
        run('scp', [...scpArgs(r), '-rq', `${r.host}:${r.dir}/*`, dir]);
    } catch (e) {
        fs.rmSync(dir, { recursive: true, force: true }); // nothing to keep from a pull that failed
        throw e;
    }
    let before = contents(dir);
    return {
        dir,
        push() {
            const now = contents(dir);
            const changed = [...now].filter(([f, data]) => !before.get(f)?.equals(data)).map(([f]) => f);
            upload(r, dir, changed);
            before = now;
            return changed;
        },
        close() {
            fs.rmSync(dir, { recursive: true, force: true });
        },
    };
}

// Every file under a folder, by its path relative to it with forward slashes
function contents(root: string, rel = ''): Map<string, Buffer> {
    const out = new Map<string, Buffer>();
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) for (const [k, v] of contents(root, p)) out.set(k, v);
        else out.set(p, fs.readFileSync(path.join(root, rel, e.name)));
    }
    return out;
}

// One scp for all the files into a staging folder on the server, then one ssh to move each into place:
// a move is atomic there, so a machine or browser reading at that moment never gets half a file.
function upload(r: Remote, local: string, files: string[]) {
    if (!files.length) return;
    const stage = `${r.dir}/.incoming-${Date.now().toString(36)}`;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cost-push-'));
    try {
        for (const f of files) {
            fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
            fs.copyFileSync(path.join(local, f), path.join(tmp, f));
        }
        run('scp', [...scpArgs(r), '-rq', tmp, `${r.host}:${stage}`]);
        const dirOf = (p: string) => p.replace(/\/[^/]*$/, '');
        const moves = files.map((f) => `mkdir -p ${shQuote(dirOf(`${r.dir}/${f}`))} && mv -f ${shQuote(`${stage}/${f}`)} ${shQuote(`${r.dir}/${f}`)}`);
        run('ssh', [...sshArgs(r), [...moves, `rm -rf ${shQuote(stage)}`].join(' && ')]);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

// Logs in and runs nothing, so setup can tell at once whether the server works without a password.
export function probe(remote: string) {
    run('ssh', [...sshArgs(parsed(remote)), 'true']);
}

// The usual ssh failures, told apart by ssh's own message, so cc-cost can say what to check
export type SshFailure = 'auth' | 'refused' | 'resolve' | 'hostkey' | 'timeout';
export function sshFailure(message: string): SshFailure | undefined {
    if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(message)) return 'hostkey';
    if (/Permission denied/i.test(message)) return 'auth';
    // "closed by": the port answers but nothing speaks SSH there, e.g. a proxy in front of a stopped server
    if (/Connection refused|Connection closed by|kex_exchange_identification/i.test(message)) return 'refused';
    if (/Could not resolve hostname|Name or service not known|nodename nor servname/i.test(message)) return 'resolve';
    if (/timed out|ETIMEDOUT/i.test(message)) return 'timeout';
    return undefined;
}

// The user written before "@" (none means ssh's default), and the name known_hosts files the server under
export function remoteParts(remote: string): { user?: string; known: string } | undefined {
    const r = parseRemote(remote);
    if (!r) return undefined;
    const at = r.host.lastIndexOf('@');
    const name = r.host.slice(at + 1).replace(/[[\]]/g, '');
    return { user: at > 0 ? r.host.slice(0, at) : undefined, known: r.port && r.port !== 22 ? `[${name}]:${r.port}` : name };
}

// What to check after an ssh failure, in plain words; empty when ssh's own message is all there is
export function sshHint(message: string, remote: string): string {
    const kind = sshFailure(message);
    const parts = remoteParts(remote);
    if (!kind || !parts) return '';
    const H = L().sshHint;
    return kind === 'auth' ? (parts.user ? fill(H.authUser, { user: parts.user }) : H.auth) : fill(H[kind], { known: parts.known });
}
