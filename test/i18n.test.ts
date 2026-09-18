import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LANGS } from '../src/i18n.ts';

// Walk two dictionaries in parallel; every string must use the same {placeholders}.
function compare(a: unknown, b: unknown, where: string) {
    if (typeof a === 'string') {
        assert.equal(typeof b, 'string', where);
        const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        assert.deepEqual(vars(b as string), vars(a), `placeholders differ at ${where}`);
        return;
    }
    if (Array.isArray(a)) {
        assert.ok(Array.isArray(b) && b.length === a.length, `array length differs at ${where}`);
        a.forEach((v, i) => compare(v, (b as unknown[])[i], `${where}[${i}]`));
        return;
    }
    const ka = Object.keys(a as object).sort(), kb = Object.keys(b as object).sort();
    assert.deepEqual(kb, ka, `keys differ at ${where}`);
    for (const k of ka) compare((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${where}.${k}`);
}

test('every language mirrors English', () => {
    for (const [lang, dict] of Object.entries(LANGS)) compare(LANGS.en, dict, lang);
});
