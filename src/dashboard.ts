import fs from 'node:fs';
import { agentOf, contextTokens, groupBy, modelLabel, type MachineLimit, type PricedRow } from './aggregate.ts';
import { LANGS, type Dict } from './i18n.ts';
import { localClock } from './scan.ts';
import { T, UNKNOWN } from './types.ts';

// Chart colors by model, fixed so a model keeps its color whatever the filter.
// Append new models at the end; inserting shifts every color after it. Unlisted models get slot 8.
export const ORDER = ['claude-opus-5', 'claude-fable-5-1', 'claude-fable-5', 'claude-sonnet-5',
    'claude-haiku-4-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-opus-5-fast'];

const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// JSON inside <script>: keep "</script>" in a project name from closing the tag
const js = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export interface DashboardMeta {
    lang: string;
    timezone: string;
    planPrice: number;
    updated: string; // ISO
    machines: number;
    first: string;
    last: string;
    prices: string;
    version: string; // cc-cost's own; this and the links come from package.json
    repo: string;
    npm: string;
    site: string;
}

// Header icons. GitHub mark from Octicons (MIT), npm mark from Simple Icons (CC0).
const ICON = {
    logo: `<svg viewBox="0 0 120 120" aria-hidden="true"><rect width="120" height="120" rx="28" fill="#D97757"/><path fill="#fff" d="M40 24H80Q86 24 86 30V96L81.67 91L77.33 96L73 91L68.67 96L64.33 91L60 96L55.67 91L51.33 96L47 91L42.67 96L38.33 91L34 96V30Q34 24 40 24Z"/><rect x="42" y="62" width="8" height="18" rx="2" fill="#D97757"/><rect x="56" y="50" width="8" height="30" rx="2" fill="#D97757"/><rect x="70" y="36" width="8" height="44" rx="2" fill="#D97757"/></svg>`,
    github: `<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`,
    npm: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/></svg>`,
};

// Strings repeat across thousands of rows; store each once and refer to it by index.
function dictionary() {
    const values: string[] = [], index = new Map<string, number>();
    return {
        values,
        id(v: string) {
            let i = index.get(v);
            if (i === undefined) index.set(v, (i = values.push(v) - 1));
            return i;
        },
    };
}

// Row layout shared with the page script below (R.* indices)
function encode(rows: PricedRow[], limits: MachineLimit[], timezone: string) {
    const dates = dictionary(), machines = dictionary(), models = dictionary(), projects = dictionary(), sessions = dictionary();
    const agents = dictionary(), skills = dictionary(), mcps = dictionary();
    const key = (r: PricedRow) => [r.d, r.machine, modelLabel(r), r.p, r.s, agentOf(r), r.k ?? '', r.x ?? ''].join('\0');
    const encoded = [...groupBy(rows, key)].map(([k, t]) => {
        const [d, machine, model, p, s, a, sk, x] = k.split('\0') as string[];
        const n = (i: number) => t.t[i] ?? 0;
        return [
            dates.id(d!), machines.id(machine!), models.id(model!), projects.id(p!), sessions.id(s!), agents.id(a!), skills.id(sk!), mcps.id(x!),
            n(T.calls), r4(t.cost), r4(t.c[0]), r4(t.c[1]), r4(t.c[2]), r4(t.c[3]), r4(t.c[4]),
            contextTokens(t.t), n(T.read), n(T.output), n(T.maxContext), n(T.ctx50k), n(T.ctx200k), n(T.ctx500k), n(T.ctxOver500k),
        ];
    });
    const clock = localClock(timezone);
    const hits = limits.filter((l) => l.status === 'rejected').map((l) => {
        const k = clock(l.ts);
        return [k.d, `${String(k.h).padStart(2, '0')}:${String(k.min).padStart(2, '0')}`, l.machine, l.type];
    });
    return {
        dates: dates.values, machines: machines.values, models: models.values, projects: projects.values, sessions: sessions.values,
        agents: agents.values, skills: skills.values, mcps: mcps.values, rows: encoded, hits,
    };
}

export function writeDashboard(d: { rows: PricedRow[]; limits: MachineLimit[] }, meta: DashboardMeta, file: string): string {
    const D: Dict['dash'] = (LANGS[meta.lang] ?? LANGS.en!).dash;
    // Server-side text for the chosen language; the page swaps it when the language changes
    const text = (key: keyof Dict['dash']) => `data-t="${key}">${esc(String(D[key]))}`;
    const strings = Object.fromEntries(Object.entries(LANGS).map(([k, v]) => [k, v.dash]));

    const html = `<!doctype html>
<html lang="${esc(meta.lang)}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>cc-cost</title>
<style>
:root{
  color-scheme:light;
  --plane:#f9f9f7; --surface:#fcfcfb;
  --ink:#0b0b0b; --ink-2:#52514e; --muted:#898781;
  --grid:#e1e0d9; --axis:#c3c2b7; --ring:rgba(11,11,11,.10);
  --hue-1:#2a78d6;--hue-2:#eb6834;--hue-3:#1baf7a;--hue-4:#eda100;
  --hue-5:#e87ba4;--hue-6:#008300;--hue-7:#4a3aa7;--hue-8:#e34948;
}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){
  color-scheme:dark;
  --plane:#0d0d0d; --surface:#1a1a19;
  --ink:#fff; --ink-2:#c3c2b7; --muted:#898781;
  --grid:#2c2c2a; --axis:#383835; --ring:rgba(255,255,255,.10);
  --hue-1:#3987e5;--hue-2:#d95926;--hue-3:#199e70;--hue-4:#c98500;
  --hue-5:#d55181;--hue-6:#008300;--hue-7:#9085e9;--hue-8:#e66767;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--plane);color:var(--ink);
  font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:32px 16px 64px}
.wrap{max-width:1080px;margin:0 auto}
.site{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;
  padding:0 0 16px;margin:0 0 20px;border-bottom:1px solid var(--grid)}
.logo{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none}
.logo svg{width:32px;height:32px}
.logo b{font-size:20px;font-weight:700;letter-spacing:-.01em}
.logo small{color:var(--muted);font-size:12px;font-weight:500}
.links{display:flex;align-items:center;gap:4px}
.links a{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;color:var(--ink-2)}
.links a:hover{background:var(--surface);color:var(--ink)}
.links a:focus-visible{outline:2px solid var(--ink);outline-offset:1px}
.links a svg{width:18px;height:18px}
.links .langs{margin-left:8px}
h1{font-size:15px;font-weight:600;margin:0 0 2px}
.sub{color:var(--muted);font-size:13px;margin:0 0 24px}
.foot{color:var(--muted);font-size:12px;text-align:center;margin:24px 0 0}
.foot a{color:inherit}
.langs{display:flex;gap:4px}
.langs button{font:inherit;font-size:12px;padding:3px 9px;border-radius:6px;border:1px solid var(--ring);
  background:var(--surface);color:var(--ink-2);cursor:pointer}
.langs button[aria-pressed="true"]{background:var(--ink);color:var(--surface);border-color:var(--ink)}

.filters{display:flex;gap:6px;align-items:center;margin:0 0 12px;flex-wrap:wrap}
.filters.last{margin-bottom:24px}
.filters button{font:inherit;font-size:13px;padding:6px 14px;border-radius:999px;
  border:1px solid var(--ring);background:var(--surface);color:var(--ink-2);cursor:pointer}
.filters button:hover{background:var(--plane)}
.filters button[aria-pressed="true"]{background:var(--ink);color:var(--surface);border-color:var(--ink);font-weight:600}
.fsep{width:1px;height:22px;background:var(--grid);margin:0 6px}
.range{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:13px}
.range input,.filters select{font:inherit;font-size:13px;color:var(--ink-2);background:var(--surface);
  border:1px solid var(--ring);border-radius:8px;padding:5px 9px;max-width:220px}
.range input:focus,.filters select:focus{outline:2px solid var(--ink);outline-offset:1px}
.range[data-on="1"] input,.filters select.on{color:var(--ink);border-color:var(--ink);font-weight:600}
.flabel{color:var(--muted);font-size:12px}
.reset{display:none}
.range[data-on="1"] ~ .reset{display:inline-block}

.card{background:var(--surface);border:1px solid var(--ring);border-radius:10px;padding:20px 22px;margin:0 0 16px;min-width:0}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin:0 0 16px}
.grid2 .card{margin:0}
.hero-label{color:var(--muted);font-size:13px;margin:0 0 6px}
.hero{font-size:52px;font-weight:600;letter-spacing:-.02em;line-height:1.05;margin:0}
.hero-note{color:var(--ink-2);font-size:13px;margin:8px 0 0}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin:22px 0 0;
  padding:20px 0 0;border-top:1px solid var(--grid)}
.tile-l{color:var(--muted);font-size:12px;margin:0 0 4px}
.tile-v{font-size:22px;font-weight:600;margin:0}
.tile-n{color:var(--muted);font-size:12px;margin:3px 0 0}

h2{font-size:13px;font-weight:600;margin:0 0 2px}
h2 + .scroll,h2 + div{margin-top:14px}
.h2sub{color:var(--muted);font-size:12px;margin:0 0 16px}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin:14px 0 0}
.legend span{display:inline-flex;align-items:center;gap:6px;color:var(--ink-2);font-size:12px}
.sw{width:10px;height:10px;border-radius:2px;flex:none}

.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-weight:500;color:var(--muted);font-size:12px;
  padding:0 10px 8px 0;border-bottom:1px solid var(--grid);white-space:nowrap}
td{padding:8px 10px 8px 0;border-bottom:1px solid var(--grid);font-variant-numeric:tabular-nums}
td:first-child,th:first-child{font-variant-numeric:normal}
tr:last-child td{border-bottom:0}
.num{text-align:right;white-space:nowrap}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.key{display:inline-flex;align-items:center;gap:8px}

#tip{position:fixed;pointer-events:none;opacity:0;transition:opacity .1s;z-index:9;
  background:var(--surface);border:1px solid var(--ring);border-radius:8px;padding:10px 12px;
  box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:150px}
#tip .d{color:var(--muted);font-size:12px;margin:0 0 6px}
#tip .r{display:flex;align-items:center;gap:8px;justify-content:space-between;margin:3px 0}
#tip .n{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
#tip .m{color:var(--ink-2);font-size:12px;display:inline-flex;align-items:center;gap:6px}
#tip .k{width:12px;height:2px;border-radius:1px;flex:none}
svg{display:block;width:100%;height:auto;overflow:visible}
.band:focus{outline:2px solid var(--ink);outline-offset:1px}
.empty{color:var(--muted);font-size:13px;padding:12px 0}
</style></head><body>
<div class="wrap">
<header class="site">
  <a class="logo" href="${esc(meta.repo)}" target="_blank" rel="noopener">${ICON.logo}<b>cc-cost</b><small>v${esc(meta.version)}</small></a>
  <nav class="links">
    <a href="${esc(meta.repo)}" target="_blank" rel="noopener" title="GitHub" aria-label="GitHub">${ICON.github}</a>
    <a href="${esc(meta.npm)}" target="_blank" rel="noopener" title="npm" aria-label="npm">${ICON.npm}</a>
    <a href="${esc(meta.site)}" target="_blank" rel="noopener" title="${esc(D.website)}" aria-label="${esc(D.website)}" data-t-title="website" data-t-aria="website">${ICON.globe}</a>
    <div class="langs" role="group" aria-label="${esc(D.language)}" data-t-aria="language">
      ${Object.keys(LANGS).map((l) => `<button data-lang="${l}">${l.toUpperCase()}</button>`).join('')}
    </div>
  </nav>
</header>
<h1 ${text('title')}</h1>
<p class="sub" id="note"></p>

<div class="filters" role="group" aria-label="${esc(D.timeRange)}" data-t-aria="timeRange">
  <button data-days="1" ${text('today')}</button>
  <button data-days="7" ${text('last7')}</button>
  <button data-days="30" aria-pressed="true" ${text('last30')}</button>
  <button data-days="90" ${text('last90')}</button>
  <button data-days="0" ${text('all')}</button>
  <span class="fsep"></span>
  <span class="range" id="range">
    <input type="date" id="from" aria-label="${esc(D.from)}" data-t-aria="from">
    <span aria-hidden="true">&rarr;</span>
    <input type="date" id="to" aria-label="${esc(D.to)}" data-t-aria="to">
  </span>
  <button class="reset" id="reset" ${text('clear')}</button>
</div>
<div class="filters last">
  <select id="fMachine" aria-label="${esc(D.machine)}" data-t-aria="machine"></select>
  <select id="fProject" aria-label="${esc(D.project)}" data-t-aria="project"></select>
  <select id="fModel" aria-label="${esc(D.model)}" data-t-aria="model"></select>
  <span class="fsep"></span>
  <label class="flabel" for="groupBy" ${text('groupBy')}</label>
  <select id="groupBy">
    <option value="model" ${text('byModelOpt')}</option>
    <option value="project" ${text('byProjectOpt')}</option>
    <option value="machine" ${text('byMachineOpt')}</option>
  </select>
</div>

<div class="card">
  <p class="hero-label" id="heroLabel"></p>
  <p class="hero" id="hero">$0</p>
  <p class="hero-note" ${text('heroNote')}</p>
  <div class="tiles">
    <div><p class="tile-l" ${text('dailyAvg')}</p><p class="tile-v" id="tAvg">&ndash;</p><p class="tile-n" id="tAvgN"></p></div>
    <div><p class="tile-l" id="tMultL"></p><p class="tile-v" id="tMult">&ndash;</p><p class="tile-n" id="tMultN"></p></div>
    <div><p class="tile-l" ${text('apiCalls')}</p><p class="tile-v" id="tCalls">&ndash;</p><p class="tile-n" id="tCallsN"></p></div>
    <div><p class="tile-l" ${text('cacheHit')}</p><p class="tile-v" id="tHit">&ndash;</p><p class="tile-n" ${text('cacheHitNote')}</p></div>
    <div><p class="tile-l" ${text('avgContext')}</p><p class="tile-v" id="tCtx">&ndash;</p><p class="tile-n" ${text('avgContextNote')}</p></div>
    <div><p class="tile-l" ${text('machines')}</p><p class="tile-v" id="tHosts">&ndash;</p><p class="tile-n" id="tHostsN"></p></div>
  </div>
</div>

<div class="card">
  <h2 ${text('dailyCost')}</h2>
  <p class="h2sub" ${text('dailyCostSub')}</p>
  <div id="chart"></div>
  <div class="legend" id="legend"></div>
</div>

<div class="grid2">
  <div class="card">
    <h2 ${text('whereCost')}</h2>
    <p class="h2sub" ${text('whereCostSub')}</p>
    <div id="items"></div>
  </div>
  <div class="card">
    <h2 ${text('contextTitle')}</h2>
    <p class="h2sub" ${text('contextSub')}</p>
    <div id="buckets"></div>
  </div>
</div>

<div class="grid2">
  <div class="card"><h2 ${text('byModel')}</h2><div class="scroll"><table><thead><tr id="hModels"></tr></thead><tbody id="tModels"></tbody></table></div></div>
  <div class="card"><h2 ${text('byProject')}</h2><div class="scroll"><table><thead><tr id="hProjects"></tr></thead><tbody id="tProjects"></tbody></table></div></div>
</div>

<div class="card">
  <h2 ${text('sessions')}</h2>
  <p class="h2sub" ${text('sessionsSub')}</p>
  <div class="scroll"><table><thead><tr id="hSessions"></tr></thead><tbody id="tSessions"></tbody></table></div>
</div>

<div class="grid2">
  <div class="card"><h2 ${text('agents')}</h2><div class="scroll"><table><thead><tr id="hAgents"></tr></thead><tbody id="tAgents"></tbody></table></div></div>
  <div class="card"><h2 ${text('skills')}</h2><div class="scroll"><table><thead><tr id="hSkills"></tr></thead><tbody id="tSkills"></tbody></table></div></div>
  <div class="card"><h2 ${text('mcp')}</h2><div class="scroll"><table><thead><tr id="hMcp"></tr></thead><tbody id="tMcp"></tbody></table></div></div>
</div>

<div class="grid2">
  <div class="card"><h2 ${text('byMachine')}</h2><div class="scroll"><table><thead><tr id="hMachines"></tr></thead><tbody id="tMachines"></tbody></table></div></div>
  <div class="card"><h2 ${text('limits')}</h2><div id="limits"></div></div>
</div>
<p class="foot"><span id="footText"></span> · <a href="${esc(meta.repo)}" target="_blank" rel="noopener">GitHub</a></p>
</div>
<div id="tip" role="status" aria-live="polite"></div>

<script>
const DATA = ${js(encode(d.rows, d.limits, meta.timezone))};
const META = ${js(meta)};
const STRINGS = ${js(strings)};
const ORDER = ${js(ORDER)};
const UNKNOWN = ${js(UNKNOWN)};
// Row layout, same order as encode() in dashboard.ts
const R = { d: 0, machine: 1, model: 2, project: 3, session: 4, agent: 5, skill: 6, mcp: 7, calls: 8, cost: 9,
  ci: 10, cw: 11, cr: 12, co: 13, cx: 14, ctx: 15, read: 16, out: 17, maxCtx: 18, b0: 19 };
const ROWS = DATA.rows.map(r => ({
  d: DATA.dates[r[R.d]], machine: DATA.machines[r[R.machine]], model: DATA.models[r[R.model]], project: DATA.projects[r[R.project]],
  session: DATA.sessions[r[R.session]], agent: DATA.agents[r[R.agent]], skill: DATA.skills[r[R.skill]], mcp: DATA.mcps[r[R.mcp]],
  calls: r[R.calls], c: r[R.cost], ci: r[R.ci], cw: r[R.cw], cr: r[R.cr], co: r[R.co], cx: r[R.cx],
  ctx: r[R.ctx], read: r[R.read], out: r[R.out], maxCtx: r[R.maxCtx], b: r.slice(R.b0, R.b0 + 4)
}));

let lang = META.lang;
try { const saved = localStorage.getItem('cc-cost-lang'); if (saved && STRINGS[saved]) lang = saved; } catch (e) {}
let L = STRINGS[lang] || STRINGS.en;

const fill = (s, v) => s.replace(/\\{(\\w+)\\}/g, (_, k) => v[k] ?? '{' + k + '}');
const $ = (n) => '$' + (n >= 100 ? n.toFixed(0) : n.toFixed(2));
const $$ = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Same separators as $ in every language: '.' as thousands separator next to '$' reads as decimals
const NF = new Intl.NumberFormat('en-US');
const tok = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));
const pct = (a, b) => (b ? a / b * 100 : 0).toFixed(1) + '%';
const DAY = 86400000;
// Calendar day in the zone the snapshots were split by
const iso = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: META.timezone });
const hue = (i) => 'var(--hue-' + i + ')';
const modelHue = (m) => hue(ORDER.indexOf(m) < 0 ? 8 : ORDER.indexOf(m) + 1);

const ALL = [...new Set(ROWS.map(r => r.d))].sort();
const MIN = ALL[0] || iso(Date.now()), MAX = ALL[ALL.length - 1] || iso(Date.now());

let days = 30;        // preset: 1 = today, 0 = all
let custom = null;    // {from, to}; overrides the preset while set
const sel = { machine: '', project: '', model: '' };
let groupBy = 'model';

// Calendar days: "last 7 days" means the last 7 calendar days, not the last 7 days with data
function bounds() {
  if (custom) return custom;
  if (!days) return { from: MIN, to: MAX };
  return { from: iso(Date.now() - (days - 1) * DAY), to: iso(Date.now()) };
}

function slice() {
  const b = bounds();
  return ROWS.filter(r => r.d >= b.from && r.d <= b.to &&
    (!sel.machine || r.machine === sel.machine) && (!sel.project || r.project === sel.project) && (!sel.model || r.model === sel.model));
}

// The plan multiple is per calendar month, so divide by calendar days, not active days
// (that would assume you work every day and inflate it). Clip the window to where data exists
// so empty edges don't pull the ratio down.
function calendarSpan(dates) {
  if (!dates.length) return 1;
  const b = bounds();
  const from = Math.max(Date.parse(b.from), Date.parse(dates[0]));
  const to = Math.min(Date.parse(b.to), Date.parse(dates[dates.length - 1]));
  return Math.max(1, Math.round((to - from) / DAY) + 1);
}

function rangeLabel(dates) {
  if (custom) return custom.from + ' → ' + custom.to;
  if (!days) return fill(L.allRecords, { n: dates.length });
  return days === 1 ? L.today : fill(L.lastDays, { n: days });
}

function sumBy(rs, key) {
  const m = new Map();
  for (const r of rs) {
    const k = key(r);
    const a = m.get(k) || { c: 0, calls: 0, ctx: 0, days: new Set(), machines: new Set(), project: r.project };
    a.c += r.c; a.calls += r.calls; a.ctx += r.ctx;
    a.days.add(r.d); a.machines.add(r.machine);
    m.set(k, a);
  }
  return [...m].sort((x, y) => y[1].c - x[1].c);
}

// Series for the stacked chart. Models keep their fixed colors; projects and machines take the
// first seven colors by cost in the current selection, the rest fold into "other".
const OTHER = '__cc-cost-other__';
function series(rs) {
  if (groupBy === 'model') {
    const present = new Set(rs.map(r => r.model));
    const list = [...ORDER.filter(m => present.has(m)), ...[...present].filter(m => !ORDER.includes(m)).sort()];
    return { key: r => r.model, list, hue: modelHue, label: m => m };
  }
  const key = groupBy === 'project' ? (r => r.project) : (r => r.machine);
  const ranked = sumBy(rs, key).map(e => e[0]);
  const top = ranked.slice(0, 7);
  const list = ranked.length > 7 ? [...top, OTHER] : top;
  return { key: r => top.includes(key(r)) ? key(r) : OTHER, list, hue: k => hue(k === OTHER ? 8 : top.indexOf(k) + 1), label: k => k === OTHER ? L.other : k };
}

function fillSelect(id, values, all, current) {
  const s = document.getElementById(id);
  s.textContent = '';
  s.append(new Option(all, ''));
  for (const v of [...values].sort()) s.append(new Option(v, v, false, v === current));
  s.classList.toggle('on', !!current);
}

function applyText() {
  document.documentElement.lang = lang;
  for (const e of document.querySelectorAll('[data-t]')) e.textContent = L[e.dataset.t];
  for (const e of document.querySelectorAll('[data-t-aria]')) e.setAttribute('aria-label', L[e.dataset.tAria]);
  for (const e of document.querySelectorAll('[data-t-title]')) e.title = L[e.dataset.tTitle];
  for (const b of document.querySelectorAll('[data-lang]')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
  const updated = new Date(META.updated).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', { timeZone: META.timezone });
  document.getElementById('note').textContent = fill(L.note, { updated, machines: META.machines, min: META.first || '–', max: META.last || '–', prices: META.prices });
  document.getElementById('footText').textContent = fill(L.footer, { version: META.version });
  fillSelect('fMachine', DATA.machines, L.allMachines, sel.machine);
  fillSelect('fProject', DATA.projects, L.allProjects, sel.project);
  fillSelect('fModel', DATA.models, L.allModels, sel.model);
}

function render() {
  const rs = slice();
  const total = rs.reduce((a, r) => a + r.c, 0);
  const dates = [...new Set(rs.map(r => r.d))].sort();
  const calls = rs.reduce((a, r) => a + r.calls, 0);
  const ctx = rs.reduce((a, r) => a + r.ctx, 0);
  const read = rs.reduce((a, r) => a + r.read, 0);
  const hosts = [...new Set(rs.map(r => r.machine))];

  document.getElementById('heroLabel').textContent = rangeLabel(dates);
  document.getElementById('hero').textContent = $$(total);
  const active = dates.length;
  const span = calendarSpan(dates);
  document.getElementById('tAvg').textContent = active ? $$(total / active) : '–';
  document.getElementById('tAvgN').textContent = fill(L.activeDays, { n: active });
  document.getElementById('tMultL').textContent = fill(L.planMultiple, { price: '$' + META.planPrice });
  document.getElementById('tMult').textContent = active ? (total / (META.planPrice * span / 30)).toFixed(1) + '×' : '–';
  document.getElementById('tMultN').textContent = active ? fill(L.normalized, { n: span }) : '';
  document.getElementById('tCalls').textContent = NF.format(calls);
  document.getElementById('tCallsN').textContent = fill(L.perCall, { cost: $$(total / (calls || 1)) });
  document.getElementById('tHit').textContent = ctx ? pct(read, ctx) : '–';
  document.getElementById('tCtx').textContent = calls ? tok(ctx / calls) : '–';
  document.getElementById('tHosts').textContent = hosts.length;
  document.getElementById('tHostsN').textContent = hosts.join(', ');

  const s = series(rs);
  drawDaily(rs, dates, s);
  drawItems(rs);
  drawBuckets(rs);
  const legend = document.getElementById('legend');
  legend.textContent = '';
  for (const k of s.list) {
    const e = document.createElement('span');
    const sw = document.createElement('i'); sw.className = 'sw'; sw.style.background = s.hue(k);
    e.append(sw, document.createTextNode(s.label(k)));
    legend.append(e);
  }

  const cols = [[L.cost, 'num'], [L.share, 'num'], [L.calls, 'num'], [L.avgCtx, 'num']];
  const nums = (g) => [$$(g.c), pct(g.c, total), NF.format(g.calls), g.calls ? tok(g.ctx / g.calls) : '–'];
  table('Models', [[L.model], ...cols], sumBy(rs, r => r.model).map(([k, g]) => [swatch(k, modelHue(k)), ...nums(g)]));
  table('Projects', [[L.project], ...cols], sumBy(rs, r => r.project).map(([k, g]) => [k, ...nums(g)]));
  table('Machines', [[L.machine], ...cols], sumBy(rs, r => r.machine).map(([k, g]) => [k, ...nums(g)]));
  table('Sessions', [[L.session], [L.project], [L.machine], [L.first], [L.last], [L.calls, 'num'], [L.avgCtx, 'num'], [L.cost, 'num']],
    sumBy(rs.filter(r => r.session !== UNKNOWN), r => r.session).slice(0, 15).map(([k, g]) => {
      const d = [...g.days].sort();
      return [mono(k.slice(0, 8)), g.project, [...g.machines].join(', '), d[0], d[d.length - 1], NF.format(g.calls), tok(g.ctx / (g.calls || 1)), $$(g.c)];
    }));
  const small = [[L.cost, 'num'], [L.share, 'num'], [L.calls, 'num']];
  const smallRow = (label, g) => [label, $$(g.c), pct(g.c, total), NF.format(g.calls)];
  table('Agents', [[L.agentCol], ...small], sumBy(rs, r => r.agent).map(([k, g]) => smallRow(k === 'main' ? L.main : k, g)));
  table('Skills', [[L.skillCol], ...small], sumBy(rs.filter(r => r.skill), r => r.skill).slice(0, 10).map(([k, g]) => smallRow(k, g)));
  table('Mcp', [[L.mcpCol], ...small], sumBy(rs.filter(r => r.mcp), r => r.mcp).slice(0, 10).map(([k, g]) => smallRow(k, g)));
  drawLimits();
}

function swatch(text, color) {
  const k = document.createElement('span'); k.className = 'key';
  const sw = document.createElement('i'); sw.className = 'sw'; sw.style.background = color;
  k.append(sw, document.createTextNode(text));
  return k;
}
function mono(text) { const s = document.createElement('span'); s.className = 'mono'; s.textContent = text; return s; }

function table(id, head, rows) {
  const h = document.getElementById('h' + id); h.textContent = '';
  for (const [t, cls] of head) { const th = document.createElement('th'); th.textContent = t; if (cls) th.className = cls; h.append(th); }
  const b = document.getElementById('t' + id); b.textContent = '';
  if (!rows.length) {
    const tr = document.createElement('tr'), td = document.createElement('td');
    td.colSpan = head.length; td.className = 'empty'; td.textContent = '–'; tr.append(td); b.append(tr);
    return;
  }
  for (const row of rows) {
    const tr = document.createElement('tr');
    row.forEach((v, i) => {
      const td = document.createElement('td');
      if (head[i][1]) td.className = head[i][1];
      if (v instanceof Node) td.append(v); else td.textContent = v;
      tr.append(td);
    });
    b.append(tr);
  }
}

function emptyNote() {
  const p = document.createElement('p'); p.className = 'empty';
  p.textContent = fill(L.empty, { min: MIN, max: MAX });
  return p;
}

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (t, a) => { const e = document.createElementNS(SVGNS, t); for (const k in a) e.setAttribute(k, a[k]); return e; };

function drawDaily(rs, dates, s) {
  const host = document.getElementById('chart');
  host.textContent = '';
  if (!dates.length) { host.append(emptyNote()); return; }

  const W = 1000, H = 260, ml = 52, mr = 8, mt = 12, mb = 28;
  const pw = W - ml - mr, ph = H - mt - mb;
  const byDate = {};
  for (const r of rs) { const k = s.key(r); (byDate[r.d] ??= {})[k] = (byDate[r.d][k] || 0) + r.c; }
  const max = Math.max(...dates.map(d => Object.values(byDate[d]).reduce((a, b) => a + b, 0)), 0.01);

  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  const step = mag * (max / mag > 5 ? 2 : 1);
  const top = Math.ceil(max / step) * step;
  const y = (v) => mt + ph - (v / top) * ph;

  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': L.chartLabel });
  for (let v = 0; v <= top + 1e-9; v += step) {
    svg.append(el('line', { x1: ml, x2: W - mr, y1: y(v), y2: y(v), stroke: 'var(--grid)', 'stroke-width': 1 }));
    const t = el('text', { x: ml - 10, y: y(v) + 4, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 11,
      style: 'font-variant-numeric:tabular-nums' });
    t.textContent = $(v); svg.append(t);
  }
  svg.append(el('line', { x1: ml, x2: W - mr, y1: y(0), y2: y(0), stroke: 'var(--axis)', 'stroke-width': 1 }));

  const band = pw / dates.length;
  const bw = Math.min(24, Math.max(3, band - 4));
  const every = Math.ceil(dates.length / 12);

  dates.forEach((d, i) => {
    const cx = ml + band * i + band / 2;
    let acc = 0;
    const stack = s.list.filter(k => byDate[d][k] > 0);
    stack.forEach((k, j) => {
      const v = byDate[d][k];
      const y0 = y(acc), y1 = y(acc + v);
      const gap = j < stack.length - 1 ? 2 : 0;
      const h = Math.max(1, y0 - y1 - gap);
      const isTop = j === stack.length - 1;
      const r = Math.min(4, h, bw / 2);
      const x = cx - bw / 2, yy = y1 + (isTop ? 0 : gap);
      const p = isTop
        ? 'M' + x + ',' + (yy + h) + 'V' + (yy + r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + (-r) +
          'h' + (bw - 2 * r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r + 'V' + (yy + h) + 'Z'
        : 'M' + x + ',' + yy + 'h' + bw + 'v' + h + 'h' + (-bw) + 'Z';
      svg.append(el('path', { d: p, fill: s.hue(k) }));
      acc += v;
    });

    if (i % every === 0) {
      const t = el('text', { x: cx, y: H - 8, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 11 });
      t.textContent = d.slice(5).replace('-', '.'); svg.append(t);
    }

    const hit = el('rect', { x: ml + band * i, y: mt, width: band, height: ph, fill: 'transparent', class: 'band', tabindex: 0 });
    const show = (ev) => {
      const b = hit.getBoundingClientRect();
      tip(ev ? ev.clientX : b.x + b.width / 2, ev ? ev.clientY : b.y + 20, d, byDate[d], stack, s);
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('focus', () => show(null));
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('blur', hide);
    svg.append(hit);
  });
  host.append(svg);
}

const TIP = document.getElementById('tip');
function tip(x, y, date, vals, keys, s) {
  TIP.textContent = '';
  const h = document.createElement('p'); h.className = 'd'; h.textContent = date; TIP.append(h);
  let sum = 0;
  for (const k of [...keys].reverse()) {
    const row = document.createElement('div'); row.className = 'r';
    const lab = document.createElement('span'); lab.className = 'm';
    const sw = document.createElement('i'); sw.className = 'k'; sw.style.background = s.hue(k);
    lab.append(sw, document.createTextNode(s.label(k)));
    const n = document.createElement('span'); n.className = 'n'; n.textContent = $$(vals[k]);
    row.append(lab, n); TIP.append(row); sum += vals[k];
  }
  if (keys.length > 1) {
    const row = document.createElement('div'); row.className = 'r';
    row.style.cssText = 'border-top:1px solid var(--grid);margin-top:6px;padding-top:6px';
    const lab = document.createElement('span'); lab.className = 'm'; lab.textContent = L.total;
    const n = document.createElement('span'); n.className = 'n'; n.textContent = $$(sum);
    row.append(lab, n); TIP.append(row);
  }
  TIP.style.opacity = 1;
  const w = TIP.offsetWidth, hh = TIP.offsetHeight;
  TIP.style.left = Math.min(window.innerWidth - w - 12, Math.max(12, x + 14)) + 'px';
  TIP.style.top = Math.max(12, Math.min(window.innerHeight - hh - 12, y - hh / 2)) + 'px';
}
const hide = () => { TIP.style.opacity = 0; };

// Horizontal bars with a value label; used by the cost-by-type and context charts
function bars(hostId, items, label, fmt) {
  const host = document.getElementById(hostId);
  host.textContent = '';
  const total = items.reduce((a, i) => a + i[1], 0);
  if (!total) { host.append(emptyNote()); return; }
  const max = Math.max(...items.map(i => i[1]), 0.01);
  const W = 1000, rowH = 44, ml = 190, mr = 230;
  const svg = el('svg', { viewBox: '0 0 ' + W + ' ' + items.length * rowH, role: 'img', 'aria-label': label });
  items.forEach(([name, v], i) => {
    const cy = i * rowH + rowH / 2, bh = 22, w = Math.max(1, (v / max) * (W - ml - mr));
    const t = el('text', { x: ml - 12, y: cy + 5, 'text-anchor': 'end', fill: 'var(--ink-2)', 'font-size': 18 });
    t.textContent = name; svg.append(t);
    const r = Math.min(4, bh / 2, w);
    svg.append(el('path', {
      d: 'M' + ml + ',' + (cy - bh / 2) + 'h' + (w - r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r +
        'v' + (bh - 2 * r) + 'a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + r + 'H' + ml + 'Z',
      fill: hue(1)
    }));
    const val = el('text', { x: ml + w + 10, y: cy + 5, fill: 'var(--ink)', 'font-size': 18, 'font-weight': 600,
      style: 'font-variant-numeric:tabular-nums' });
    val.textContent = fmt(v) + '  ·  ' + (v / total * 100).toFixed(0) + '%';
    svg.append(val);
  });
  host.append(svg);
}

function drawItems(rs) {
  bars('items', [
    [L.cacheRead, rs.reduce((a, r) => a + r.cr, 0)],
    [L.cacheWrite, rs.reduce((a, r) => a + r.cw, 0)],
    [L.output, rs.reduce((a, r) => a + r.co, 0)],
    [L.input, rs.reduce((a, r) => a + r.ci, 0)],
    [L.web, rs.reduce((a, r) => a + r.cx, 0)]
  ].filter(i => i[1] > 0).sort((a, b) => b[1] - a[1]), L.itemsLabel, $$);
}

function drawBuckets(rs) {
  const b = [0, 0, 0, 0];
  for (const r of rs) for (let i = 0; i < 4; i++) b[i] += r.b[i] || 0;
  bars('buckets', L.buckets.map((name, i) => [name, b[i]]), L.contextTitle, (v) => NF.format(v));
}

function drawLimits() {
  const host = document.getElementById('limits');
  host.textContent = '';
  const b = bounds();
  const hits = DATA.hits.filter(h => h[0] >= b.from && h[0] <= b.to && (!sel.machine || h[2] === sel.machine));
  if (!hits.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = L.limitsNone; host.append(p); return; }
  const t = document.createElement('table');
  for (const h of hits.slice(-10).reverse()) {
    const tr = document.createElement('tr');
    for (const v of [h[0] + ' ' + h[1], h[2], h[3]]) { const td = document.createElement('td'); td.textContent = v; tr.append(td); }
    t.append(tr);
  }
  host.append(t);
}

const FROM = document.getElementById('from'), TO = document.getElementById('to');
const RANGE = document.getElementById('range');
// The date boxes are deliberately unbounded: a range without data shows the empty state,
// which says where the records start.

// With a preset active the boxes show the range it resolves to, but the preset stays selected.
function syncInputs() {
  if (custom) {
    // never clip a custom range: what the boxes show is what is applied
    FROM.value = custom.from; TO.value = custom.to;
  } else {
    const b = bounds();
    FROM.value = b.from < MIN ? MIN : b.from;
    TO.value = b.to > MAX ? MAX : b.to;
  }
  RANGE.dataset.on = custom ? '1' : '0';
  for (const o of document.querySelectorAll('.filters button[data-days]')) {
    if (!custom && +o.dataset.days === days) o.setAttribute('aria-pressed', 'true');
    else o.removeAttribute('aria-pressed');
  }
}

for (const b of document.querySelectorAll('.filters button[data-days]')) {
  b.addEventListener('click', () => { days = +b.dataset.days; custom = null; syncInputs(); render(); });
}
for (const i of [FROM, TO]) {
  i.addEventListener('change', () => {
    if (!FROM.value || !TO.value) return;
    // a reversed range is swapped rather than coming out empty
    if (FROM.value > TO.value) { const t = FROM.value; FROM.value = TO.value; TO.value = t; }
    custom = { from: FROM.value, to: TO.value };
    syncInputs(); render();
  });
}
document.getElementById('reset').addEventListener('click', () => { custom = null; days = 30; syncInputs(); render(); });

for (const [id, key] of [['fMachine', 'machine'], ['fProject', 'project'], ['fModel', 'model']]) {
  const s = document.getElementById(id);
  s.addEventListener('change', () => { sel[key] = s.value; s.classList.toggle('on', !!s.value); render(); });
}
document.getElementById('groupBy').addEventListener('change', (e) => { groupBy = e.target.value; render(); });
for (const b of document.querySelectorAll('[data-lang]')) {
  b.addEventListener('click', () => {
    lang = b.dataset.lang; L = STRINGS[lang];
    try { localStorage.setItem('cc-cost-lang', lang); } catch (e) {}
    applyText(); render();
  });
}

addEventListener('resize', render);
applyText();
syncInputs();
render();
</script></body></html>`;
    fs.writeFileSync(file, html);
    return file;
}
