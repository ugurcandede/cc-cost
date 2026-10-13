import { stripVTControlCharacters, styleText } from 'node:util';

let color = !!process.stdout.isTTY && !process.env.NO_COLOR;
export const setColor = (on: boolean) => {
    color = on && !!process.stdout.isTTY && !process.env.NO_COLOR;
};

type Style = Parameters<typeof styleText>[0];
export const paint = (style: Style, text: string) => (color ? styleText(style, text) : text);

// Marks what rests on something not verified yet (third-party Team prices, a guessed file location):
// "beta" in yellow wherever it shows, plain in CSV and JSON
export const BETA = 'beta';
export const beta = () => paint('yellow', BETA);
// A cell's plain text with every "beta" in it painted
export const markBeta = (text: string) => text.replace(/\bbeta\b/g, beta);

// Separators follow en-US in every language: '.' as thousands separator next to '$' reads as decimals.
export const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const int = (n: number) => Math.round(n).toLocaleString('en-US');
export const pct = (part: number, whole: number) => (whole ? ((part / whole) * 100).toFixed(1) : '0.0') + '%';
export function tokens(n: number): string {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
}

// Plain-text table. Columns after the first are right-aligned unless `left` says otherwise;
// styling is applied after padding so ANSI codes don't skew the widths.
export function table(head: string[], body: string[][], opts: { foot?: string[]; left?: number[]; dim?: Set<number> } = {}): string {
    const all = [head, ...body, ...(opts.foot ? [opts.foot] : [])];
    // widths by what shows, so a painted cell (a yellow "beta") lines up like any other
    const shown = (s: string) => stripVTControlCharacters(s).length;
    const width = head.map((_, i) => Math.max(...all.map((r) => shown(r[i] ?? ''))));
    const left = new Set([0, ...(opts.left ?? [])]);
    const pad = (cell: string, i: number) => ' '.repeat(Math.max(0, width[i]! - shown(cell)));
    const line = (r: string[]) => r.map((cell, i) => (left.has(i) ? cell + pad(cell, i) : pad(cell, i) + cell)).join('  ').trimEnd();
    const rule = width.map((w) => '─'.repeat(w)).join('  ');
    const out = [paint('bold', line(head)), paint('dim', rule)];
    body.forEach((r, i) => out.push(opts.dim?.has(i) ? paint('dim', line(r)) : line(r)));
    if (opts.foot) out.push(paint('dim', rule), paint('bold', line(opts.foot)));
    return out.join('\n');
}
