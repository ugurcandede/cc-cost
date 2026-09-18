import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from './tmp.ts';
import { projectRoot, scan } from '../src/scan.ts';
import { T } from '../src/types.ts';

// A fake ~/.claude with one project directory and the given transcript files
function claudeDir(files: Record<string, object[]>): string {
    const root = tempDir('cc-cost-');
    const proj = path.join(root, 'projects', 'Q--Projects-app');
    fs.mkdirSync(path.join(proj, 'sess-1', 'subagents'), { recursive: true });
    for (const [name, lines] of Object.entries(files))
        fs.writeFileSync(path.join(proj, name), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    return root;
}

const call = (id: string, over: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) => ({
    type: 'assistant',
    requestId: 'req-' + id,
    timestamp: '2026-09-10T10:00:00.000Z',
    sessionId: 'sess-1',
    cwd: 'Q:\\Projects\\app',
    ...over,
    message: {
        id: 'msg-' + id,
        model: 'claude-opus-5',
        usage: {
            input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 50,
            cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 50 },
            ...usage,
        },
    },
});

const opts = { timezone: 'Europe/Istanbul', anonymize: false };

test('streaming duplicates keep the line with the most output', async () => {
    const dir = claudeDir({ 'a.jsonl': [call('1', {}, { output_tokens: 5 }), call('1', {}, { output_tokens: 300 }), call('1', {}, { output_tokens: 300 })] });
    const r = await scan([dir], opts);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0]!.t[T.output], 300);
    assert.equal(r.rows[0]!.t[T.calls], 1);
    assert.equal(r.duplicates, 2);
});

test('a message copied into another file by resume counts once', async () => {
    const dir = claudeDir({ 'a.jsonl': [call('1')], 'b.jsonl': [call('1'), call('2')] });
    const r = await scan([dir], opts);
    assert.equal(r.rows[0]!.t[T.calls], 2);
});

test('token counters and cache tiers', async () => {
    const dir = claudeDir({ 'a.jsonl': [call('1', {}, { output_tokens_details: { thinking_tokens: 40 }, server_tool_use: { web_search_requests: 2 } })] });
    const t = (await scan([dir], opts)).rows[0]!.t;
    assert.deepEqual(
        [t[T.input], t[T.write5m], t[T.write1h], t[T.read], t[T.output], t[T.thinking], t[T.webSearch], t[T.maxContext]],
        [10, 0, 50, 1000, 100, 40, 2, 1060],
    );
});

test('legacy combined cache counter counts as the 5m tier', async () => {
    const dir = claudeDir({ 'a.jsonl': [call('1', {}, { cache_creation: undefined, cache_creation_input_tokens: 70 })] });
    const t = (await scan([dir], opts)).rows[0]!.t;
    assert.equal(t[T.write5m], 70);
    assert.equal(t[T.write1h], 0);
});

test('days split at local midnight, not UTC', async () => {
    const dir = claudeDir({ 'a.jsonl': [call('1', { timestamp: '2026-08-28T22:30:00.000Z' })] });
    assert.equal((await scan([dir], opts)).rows[0]!.d, '2026-08-29');
    assert.equal((await scan([dir], { ...opts, timezone: 'UTC' })).rows[0]!.d, '2026-08-28');
});

test('dimensions: project, fast mode, subagent, attribution', async () => {
    const dir = claudeDir({
        'a.jsonl': [
            call('1', {}, { speed: 'fast' }),
            call('2', { isSidechain: true, attributionAgent: 'Explore', attributionSkill: 'code-review', effort: 'xhigh' }),
        ],
    });
    const rows = (await scan([dir], opts)).rows;
    const fast = rows.find((r) => r.f === 1)!;
    const sub = rows.find((r) => r.a === 'Explore')!;
    assert.equal(fast.p, 'app');
    assert.equal(sub.k, 'code-review');
    assert.equal(sub.e, 'xhigh');
    assert.ok(!('a' in fast), 'absent dimensions are not written');
});

test('synthetic messages and non-assistant lines are ignored', async () => {
    const dir = claudeDir({
        'a.jsonl': [call('1', {}, {}), { ...call('2'), message: { ...call('2').message, model: '<synthetic>' } }, { type: 'user', message: { usage: {} } }],
    });
    assert.equal((await scan([dir], opts)).rows[0]!.t[T.calls], 1);
});

test('rate-limit events: one per limit period, at its first hit', async () => {
    const q = { quotaLimits: { rateLimitType: 'five_hour', status: 'rejected', resetsAt: 1788801600 } };
    const dir = claudeDir({
        'a.jsonl': [call('1', { ...q, timestamp: '2026-09-10T10:05:00.000Z' }), call('2', { ...q, timestamp: '2026-09-10T10:01:00.000Z' })],
    });
    assert.deepEqual((await scan([dir], opts)).limits, [{ ts: '2026-09-10T10:01:00.000Z', type: 'five_hour', status: 'rejected', resetsAt: 1788801600 }]);
});

test('anonymized projects are hashed', async () => {
    const dir = claudeDir({ 'a.jsonl': [call('1')] });
    assert.match((await scan([dir], { ...opts, anonymize: true })).rows[0]!.p, /^p-[0-9a-f]{8}$/);
});

test('projects resolve to their git repository', () => {
    const root = tempDir('cc-cost-repos-');
    const repo = path.join(root, 'api');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'core', 'src'), { recursive: true });
    const tree = path.join(root, 'api-feature');
    fs.mkdirSync(tree);
    fs.writeFileSync(path.join(tree, '.git'), `gitdir: ${path.join(repo, '.git', 'worktrees', 'api-feature')}\n`);
    const plain = path.join(root, 'notes');
    fs.mkdirSync(plain);

    assert.equal(projectRoot(repo), repo);
    assert.equal(projectRoot(path.join(repo, 'core', 'src')), repo, 'a subdirectory the session cd-ed into');
    assert.equal(projectRoot(path.join(repo, 'deleted', 'dir')), repo, 'a directory removed since');
    assert.equal(projectRoot(tree), repo, 'a worktree');
    assert.equal(projectRoot(plain), plain, 'not a repository');
    // must not walk up from wherever the test runs, which may itself be a repository
    assert.equal(projectRoot(path.join('relative', 'app')), path.join('relative', 'app'), 'a path that is not absolute');
});
