// Sample transcripts for the demo: 30 days of made-up Claude Code usage, the same every run (seeded), with
// enough variety for every report and dashboard panel: several projects and models, subagents, skills, an
// MCP server, cache tiers, thinking, web searches, fast mode, long contexts, rate-limit hits.
//   node transcripts.cjs <claude dir> <profile>   profiles: personal | work-pc | work-mac
const fs = require('fs');
const path = require('path');

const [dir, profile] = process.argv.slice(2);
if (!dir || !profile) throw new Error('usage: transcripts.cjs <claude dir> <profile>');

// A small deterministic generator, so the numbers and screenshots are reproducible
let seed = { personal: 11, 'work-pc': 23, 'work-mac': 37 }[profile] ?? 1;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// What each profile works on: projects with their weight, models with theirs, how busy
const PROFILES = {
    personal: {
        projects: [['api-server', 5], ['web-app', 3], ['infra', 1]],
        models: [['claude-opus-5', 6], ['claude-sonnet-5', 3], ['claude-fable-5-1', 1]],
        sessionsPerDay: [1, 3], callsPerSession: [8, 40], fast: 0.08, limits: 2,
    },
    'work-pc': {
        projects: [['mobile-app', 4], ['data-pipeline', 2]],
        models: [['claude-sonnet-5', 7], ['claude-opus-5', 2], ['claude-haiku-4-5', 1]],
        sessionsPerDay: [1, 2], callsPerSession: [6, 30], fast: 0, limits: 3,
    },
    'work-mac': {
        projects: [['docs-site', 3], ['mobile-app', 2]],
        models: [['claude-haiku-4-5', 5], ['claude-sonnet-5', 4]],
        sessionsPerDay: [0, 2], callsPerSession: [5, 25], fast: 0, limits: 1,
    },
};
const P = PROFILES[profile];
if (!P) throw new Error('unknown profile ' + profile);
const weighted = (pairs) => {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let r = rnd() * total;
    for (const [v, w] of pairs) if ((r -= w) < 0) return v;
    return pairs[pairs.length - 1][0];
};

const DAY = 864e5;
const now = Date.now();
const lines = {}; // file -> lines
const add = (file, obj) => (lines[file] ??= []).push(JSON.stringify(obj));
let seq = 0;
const limits = [];

for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
    const day = new Date(now - daysAgo * DAY);
    const weekend = [0, 6].includes(day.getDay());
    const sessions = weekend ? Math.round(between(...P.sessionsPerDay) / 3) : between(...P.sessionsPerDay);
    for (let s = 0; s < sessions; s++) {
        const project = weighted(P.projects);
        // shaped like Claude Code's session ids, so the first 8 characters read as one
        const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[between(0, 15)]).join('');
        const session = `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`;
        const file = path.join(dir, 'projects', `-work-${project}`, `${session}.jsonl`);
        const calls = between(...P.callsPerSession);
        // a long session now and then: the context grows past 200K
        const long = rnd() < 0.15;
        let context = between(8_000, 40_000);
        const start = new Date(day); start.setHours(between(8, 19), between(0, 59), 0, 0);
        const model = weighted(P.models);
        const agent = rnd() < 0.25 ? pick(['Explore', 'Plan', 'general-purpose']) : undefined;
        const skill = rnd() < 0.2 ? pick(['commit', 'review', 'deploy']) : undefined;
        const mcp = rnd() < 0.15 ? 'github' : undefined;
        for (let i = 0; i < calls; i++) {
            const ts = new Date(start.getTime() + i * between(20, 180) * 1000);
            context += between(1_000, long ? 25_000 : 6_000);
            const fresh = between(200, 2_000); // new input this turn, written to the cache
            const output = between(150, 2_500);
            const id = `m-${profile}-${++seq}`;
            const usage = {
                input_tokens: between(10, 300),
                output_tokens: output,
                cache_read_input_tokens: context,
                cache_creation_input_tokens: fresh,
                cache_creation: { ephemeral_5m_input_tokens: Math.round(fresh * 0.2), ephemeral_1h_input_tokens: Math.round(fresh * 0.8) },
                output_tokens_details: { thinking_tokens: rnd() < 0.5 ? Math.round(output * rnd() * 0.6) : 0 },
                ...(rnd() < 0.04 && { server_tool_use: { web_search_requests: between(1, 3) } }),
                ...(rnd() < P.fast && model === 'claude-opus-5' && { speed: 'fast' }),
            };
            const call = {
                type: 'assistant', requestId: 'req-' + id, timestamp: ts.toISOString(), sessionId: session, cwd: `/work/${project}`,
                effort: pick(['medium', 'high', 'high', 'xhigh']), entrypoint: 'cli',
                ...(agent && i % 3 === 1 && { isSidechain: true, attributionAgent: agent }),
                ...(skill && i % 4 === 2 && { attributionSkill: skill }),
                ...(mcp && i % 5 === 3 && { attributionMcpServer: mcp }),
                message: { id, model, usage },
            };
            add(file, call);
            // streaming writes the same message again with more output: the duplicate the scan must fold
            if (i === 0) add(file, { ...call, message: { ...call.message, usage: { ...usage, output_tokens: 10 } } });
        }
        if (limits.length < P.limits && rnd() < 0.12) {
            const ts = new Date(start.getTime() + calls * 90 * 1000);
            limits.push({ file, line: { timestamp: ts.toISOString(), quotaLimits: { rateLimitType: 'five_hour', status: 'rejected', resetsAt: Math.floor(ts.getTime() / 1000) + 3600 } } });
        }
    }
}
for (const l of limits) add(l.file, l.line);
for (const [file, ls] of Object.entries(lines)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, ls.join('\n') + '\n');
}
console.log(`${profile}: ${Object.keys(lines).length} transcripts, ${seq} calls, ${limits.length} limit hits`);
