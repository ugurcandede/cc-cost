import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from './tmp.ts';
import { freePort, serveWhileOpen } from '../src/serve.ts';

test('serve: the folder and nothing outside it, until no page reports itself open', async () => {
    const dir = tempDir('cc-cost-serve-');
    fs.writeFileSync(path.join(dir, 'dashboard.html'), '<p>hi</p>');
    fs.mkdirSync(path.join(dir, 'machines'));
    fs.writeFileSync(path.join(dir, 'machines', 'index.json'), '["pc"]');
    const port = await freePort();
    const stopped = serveWhileOpen(dir, port, { graceMs: 500, idleMs: 300 });
    const req = (p: string, method = 'GET') => fetch(`http://127.0.0.1:${port}/${p}`, { method });
    assert.equal(await (await req('')).text(), '<p>hi</p>', 'the root is the dashboard');
    const index = await req('machines/index.json');
    assert.equal(index.headers.get('content-type'), 'application/json');
    assert.equal(index.headers.get('cache-control'), 'no-store');
    assert.equal((await req('../package.json')).status, 404);
    assert.equal((await req('nope.json')).status, 404);
    assert.equal((await req('%E0%A4%A')).status, 404, 'a malformed path is answered, not fatal');
    assert.equal((await req('alive', 'POST')).status, 204);
    await stopped;
    await assert.rejects(req(''), 'the server is gone once the page stops reporting in');
});
