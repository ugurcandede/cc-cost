import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { tempDir } from './tmp.ts';
import { claudeDirs, parseDirs } from '../src/paths.ts';

// A Claude Code data folder: only folders with a projects/ subfolder count
const claudeDir = () => {
    const dir = tempDir('cc-cost-claude-');
    fs.mkdirSync(path.join(dir, 'projects'));
    return dir;
};

test('parseDirs: comma-separated, trimmed, ~ is the home folder', () => {
    assert.deepEqual(parseDirs(' ~/.claude , ,~/.claude-work'), [path.join(os.homedir(), '.claude'), path.join(os.homedir(), '.claude-work')]);
    assert.deepEqual(parseDirs(''), []);
});

test('claudeDirs: the configured list wins over CLAUDE_CONFIG_DIR', (t) => {
    const [a, b, c] = [claudeDir(), claudeDir(), claudeDir()];
    const saved = process.env.CLAUDE_CONFIG_DIR;
    t.after(() => (saved === undefined ? delete process.env.CLAUDE_CONFIG_DIR : (process.env.CLAUDE_CONFIG_DIR = saved)));
    // A hook from the second account's session inherits its CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = c;
    assert.deepEqual(claudeDirs([a, b]), [a, b]);
    assert.deepEqual(claudeDirs([]), [c]);
    assert.deepEqual(claudeDirs(), [c]);
    assert.deepEqual(claudeDirs([a, path.join(a, 'missing')]), [a], 'folders without projects/ are skipped');
});
