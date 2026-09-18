import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';

// Temporary folders for a test file, removed when the file's tests finish.
const dirs: string[] = [];
after(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

export function tempDir(prefix = 'cc-cost-'): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    dirs.push(dir);
    return dir;
}
