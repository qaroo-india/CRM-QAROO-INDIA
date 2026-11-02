/**
 * The production Content-Security-Policy (vercel.json) allows exactly one
 * inline script: the pre-paint theme snippet in index.html, by its SHA-256.
 * Editing that snippet without updating the hash would silently break the
 * theme in production, so this test keeps them in step.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');

describe('content security policy', () => {
  it('allows the inline theme script by its current hash, and nothing else inline', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(inline).toHaveLength(1);
    const hash = `'sha256-${createHash('sha256').update(inline[0]!).digest('base64')}'`;

    const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8')) as { headers: { headers: { key: string; value: string }[] }[] };
    const csp = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')!.value;
    const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'))!;
    expect(scriptSrc).toBe(`script-src 'self' ${hash}`);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });
});
