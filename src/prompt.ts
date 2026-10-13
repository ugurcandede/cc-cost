import readline from 'node:readline';
import readlinePromises from 'node:readline/promises';
import { stripVTControlCharacters } from 'node:util';
import { paint } from './format.ts';

// Setup's questions: arrow-key menus drawn in raw mode, and free text typed on its own "> " line.

export interface Choice<T> {
    label: string;
    detail?: string; // dimmed, after the label
    value: T;
}

// The user pressed q, Esc or Ctrl+C
export class Cancelled extends Error {}

// stdin keeps the process alive only while a question waits; once answered, cc-cost may exit
const stdin = process.stdin;
const stdout = process.stdout;

// Rows a frame takes, counting lines the terminal wraps, so the redraw moves up exactly that far
const rows = (lines: string[]) =>
    lines.reduce((n, l) => n + Math.max(1, Math.ceil(stripVTControlCharacters(l).length / (stdout.columns || 80))), 0);

// Draws render() and redraws it after every key until onKey returns a result.
function keyLoop<T>(render: () => string[], onKey: (str: string | undefined, key: readline.Key) => { done: T } | 'redraw' | undefined): Promise<T> {
    return new Promise((resolve, reject) => {
        let drawn = 0;
        const erase = () => {
            if (drawn) stdout.write(`\x1b[${drawn}A\r\x1b[0J`);
            drawn = 0;
        };
        const draw = () => {
            erase();
            const lines = render();
            stdout.write(lines.join('\n') + '\n');
            drawn = rows(lines);
        };
        // stdin closed while the menu waits: no key will ever come
        const ended = () => {
            finish();
            reject(new Cancelled());
        };
        const finish = () => {
            stdin.off('end', ended);
            stdin.off('keypress', listener);
            stdin.setRawMode(false);
            stdin.pause();
            stdin.unref();
            erase();
            stdout.write('\x1b[?25h');
        };
        const listener = (str: string | undefined, key: readline.Key | undefined) => {
            if (!key) return;
            if ((key.ctrl && key.name === 'c') || key.name === 'escape' || key.name === 'q') {
                finish();
                return reject(new Cancelled());
            }
            const r = onKey(str, key);
            if (r === 'redraw') draw();
            else if (r) {
                finish();
                resolve(r.done);
            }
        };
        readline.emitKeypressEvents(stdin);
        stdin.ref();
        stdin.setRawMode(true);
        stdin.resume();
        stdout.write('\x1b[?25l');
        stdin.on('keypress', listener);
        stdin.once('end', ended);
        draw();
    });
}

const row = (on: boolean, text: string) => (on ? paint(['bold', 'cyan'], '> ') + paint('bold', text) : '  ' + text);
const withDetail = (label: string, detail: string | undefined, pad: number) => (detail ? label.padEnd(pad) + '  ' + paint('dim', detail) : label);

// One of several choices: ↑↓ or 1-9, then Enter
export function select<T>(head: string[], hint: string, choices: Choice<T>[], initial = 0): Promise<Choice<T>> {
    let at = Math.min(Math.max(initial, 0), choices.length - 1);
    const pad = Math.max(...choices.map((c) => c.label.length));
    return keyLoop(
        () => [
            ...head,
            paint('dim', hint),
            ...choices.map((c, i) => row(i === at, `${paint('dim', `${i + 1}.`)} ${withDetail(c.label, c.detail, pad)}`)),
        ],
        (str, key) => {
            if (key.name === 'up') at = (at - 1 + choices.length) % choices.length;
            else if (key.name === 'down') at = (at + 1) % choices.length;
            else if (key.name === 'return' || key.name === 'enter') return { done: choices[at]! };
            else if (str && /^[1-9]$/.test(str) && Number(str) <= choices.length) return { done: choices[Number(str) - 1]! };
            else return undefined;
            return 'redraw';
        },
    );
}

// Any number of choices: Space ticks, Enter confirms once at least one is ticked
export function checklist<T>(head: string[], hint: string, choices: (Choice<T> & { on: boolean })[]): Promise<Choice<T>[]> {
    let at = 0;
    const on = choices.map((c) => c.on);
    const pad = Math.max(...choices.map((c) => c.label.length));
    return keyLoop(
        () => [
            ...head,
            paint('dim', hint),
            ...choices.map((c, i) => row(i === at, `${on[i] ? paint('green', '[x]') : '[ ]'} ${withDetail(c.label, c.detail, pad)}`)),
        ],
        (_str, key) => {
            if (key.name === 'up') at = (at - 1 + choices.length) % choices.length;
            else if (key.name === 'down') at = (at + 1) % choices.length;
            else if (key.name === 'space') on[at] = !on[at];
            else if ((key.name === 'return' || key.name === 'enter') && on.some(Boolean)) return { done: choices.filter((_, i) => on[i]) };
            else return undefined;
            return 'redraw';
        },
    );
}

// Counts the rows written from now on, typed answers included, so a finished exchange can be wiped
// and replaced by a one-line summary.
export function track() {
    let n = 0;
    let col = 0;
    const write = stdout.write;
    stdout.write = function (this: typeof stdout, chunk: unknown, ...rest: unknown[]) {
        for (const ch of stripVTControlCharacters(String(chunk))) {
            if (ch === '\n') {
                n++;
                col = 0;
            } else if (ch === '\r') col = 0;
            else if (++col > (stdout.columns || 80)) {
                n++;
                col = 1;
            }
        }
        return (write as (...a: unknown[]) => boolean).call(this, chunk, ...rest);
    } as typeof stdout.write;
    return {
        erase() {
            stdout.write = write;
            stdout.write(`\r${n ? `\x1b[${n}A` : ''}\x1b[0J`);
            n = 0;
        },
    };
}

// Free text after "> " on the line below the question
export async function input(question: string): Promise<string> {
    stdin.ref();
    const rl = readlinePromises.createInterface({ input: stdin, output: stdout });
    const abort = new AbortController();
    rl.on('SIGINT', () => abort.abort());
    // Ctrl+D or a closed stdin closes the interface without settling the question
    rl.on('close', () => abort.abort());
    try {
        return (await rl.question(question + '\n> ', { signal: abort.signal })).trim();
    } catch (e) {
        throw abort.signal.aborted ? new Cancelled() : e;
    } finally {
        rl.close();
        stdin.unref();
    }
}
