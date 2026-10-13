// Renders the demo's colored terminal output as HTML pages, to screenshot them in a browser for the docs.
//   node scripts/demo/termshot.cjs   writes term-<name>.html into scripts/demo/out and serves them on 127.0.0.1:8767
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const here = __dirname;
const out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const shim = path.join(here, "..", "..", "test", "fake-tty.mjs");
const demo = path.join(here, 'demo.sh');
const SHOTS = {
    summary: ['demo-pc', '--no-sync'],
    plan: ['demo-pc', 'plan', '--no-sync'],
    insights: ['demo-pc', 'insights', '--no-sync'],
    projects: ['demo-pc', 'projects', '--no-sync', '--last', '30'],
};

const COLORS = { 31: '#f87171', 32: '#4ade80', 33: '#fbbf24', 36: '#67e8f9' };
function ansiToHtml(text) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let bold = false, dim = false, color = '';
    let out = '', open = false;
    const reopen = () => {
        if (open) out += '</span>';
        const style = [bold && 'font-weight:600', dim && 'opacity:.55', color && `color:${color}`].filter(Boolean).join(';');
        open = !!style;
        if (open) out += `<span style="${style}">`;
    };
    for (const part of text.split(/(\x1b\[[\d;]*m)/)) {
        const m = /^\x1b\[([\d;]*)m$/.exec(part);
        if (!m) { out += esc(part); continue; }
        for (const code of (m[1] || '0').split(';').map(Number)) {
            if (code === 0) { bold = dim = false; color = ''; }
            else if (code === 1) bold = true;
            else if (code === 2) dim = true;
            else if (code === 22) bold = dim = false;
            else if (code === 39) color = '';
            else if (COLORS[code]) color = COLORS[code];
        }
        reopen();
    }
    if (open) out += '</span>';
    return out;
}

for (const [name, args] of Object.entries(SHOTS)) {
    if (!args) continue;
    const r = spawnSync('bash', [demo, ...args], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--import=${require('url').pathToFileURL(shim).href}` } });
    const body = ansiToHtml(r.stdout.replace(/\s+$/, ''));
    const cmd = 'cc-cost ' + args.slice(1).filter((a) => a !== '--no-sync').join(' ');
    fs.writeFileSync(path.join(out, `term-${name}.html`), `<!doctype html><meta charset="utf-8"><title>${cmd}</title>
<style>body{margin:0;background:#0d0d0d;color:#e6e6e2;font:13px/1.45 "Cascadia Mono","JetBrains Mono",Consolas,monospace}
.win{display:inline-block;background:#161615;border:1px solid #2c2c2a;border-radius:10px;padding:14px 22px 20px;margin:16px}
.bar{display:flex;gap:7px;margin:0 0 14px}.bar i{width:11px;height:11px;border-radius:50%;background:#3a3a38}
.bar i:nth-child(1){background:#ff5f57}.bar i:nth-child(2){background:#febc2e}.bar i:nth-child(3){background:#28c840}
pre{margin:0;white-space:pre}.p{color:#898781}</style>
<div class="win" id="win"><div class="bar"><i></i><i></i><i></i></div><pre><span class="p">$</span> ${cmd.trimEnd()}
${body}</pre></div>`);
    console.log(name, r.status, r.stdout.length);
}
http.createServer((q, r) => {
    const f = path.join(out, q.url.replace(/^\//, '').split('?')[0] || 'term-summary.html');
    if (!f.startsWith(out) || !fs.existsSync(f)) { r.statusCode = 404; return r.end('no'); }
    r.setHeader('content-type', 'text/html; charset=utf-8');
    r.setHeader('cache-control', 'no-store');
    r.end(fs.readFileSync(f));
}).listen(8767, '127.0.0.1', () => console.log('serving http://127.0.0.1:8767/term-plan.html'));
