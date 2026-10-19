import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

// Serves the data folder on localhost for the dashboard: a browser reads the files next to a page only
// over HTTP, never from a file:// page. The server runs in its own process, so the command returns at
// once; the page reports itself alive every few seconds (POST alive), and the server stops once no page
// has done so for a while, or when none opened at all.

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.json': 'application/json' };

export interface ServeOptions {
    graceMs?: number; // how long to wait for the first page
    idleMs?: number; // how long after the last sign of life to stop
}

// Resolves once the server has stopped
export function serveWhileOpen(root: string, port: number, opts: ServeOptions = {}): Promise<void> {
    const { graceMs = 20_000, idleMs = 15_000 } = opts;
    const base = path.resolve(root);
    let last = Date.now(), seen = false;
    const server = http.createServer((req, res) => {
        let rel: string;
        try {
            rel = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname).replace(/^\/+/, '') || 'dashboard.html';
        } catch {
            res.writeHead(404).end(); // a malformed path is nothing here, and must not take the server down
            return;
        }
        if (req.method === 'POST' && rel === 'alive') {
            last = Date.now();
            seen = true;
            res.writeHead(204).end();
            return;
        }
        const file = path.resolve(base, rel);
        const inside = file.startsWith(base + path.sep);
        fs.readFile(file, (err, data) => {
            if (!inside || err) {
                res.writeHead(404).end();
                return;
            }
            res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
            res.end(data);
        });
    });
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => {
            const timer = setInterval(() => {
                if (Date.now() - last < (seen ? idleMs : graceMs)) return;
                clearInterval(timer);
                server.close(() => resolve());
                server.closeAllConnections();
            }, 1000);
        });
    });
}

// A port nothing listens on right now, for the server process to take
export function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const { port } = s.address() as { port: number };
            s.close(() => resolve(port));
        });
    });
}

// Starts the server as a detached copy of this program (see the CC_COST_SERVE check in cli.ts), waits
// until it answers, and returns its address. With `remove`, the server deletes the folder when it stops.
export async function serveDetached(script: string, root: string, remove: boolean): Promise<string> {
    const port = await freePort();
    spawn(process.execPath, [script], {
        detached: true, stdio: 'ignore', windowsHide: true,
        env: { ...process.env, CC_COST_SERVE: root, CC_COST_SERVE_PORT: String(port), CC_COST_SERVE_REMOVE: remove ? '1' : '' },
    }).unref();
    for (let i = 0; i < 30; i++) {
        if (await listening(port)) break;
        await new Promise((r) => setTimeout(r, 100));
    }
    return `http://127.0.0.1:${port}/`;
}

const listening = (port: number) =>
    new Promise<boolean>((resolve) => {
        const c = net.connect(port, '127.0.0.1');
        c.on('connect', () => {
            c.end();
            resolve(true);
        });
        c.on('error', () => resolve(false));
    });
