/**
 * Every test file lives in a `__tests__/` folder beside the code it tests — never colocated
 * (lead rule, 2026-09-20; erp-docs 02-coding-rules/05-backend.md BE-21). A `*.spec.ts` or
 * `*.int.spec.ts` whose parent folder is not `__tests__` fails here with the move it needs. erp-web enforces the same
 * rule in Phase 3.
 */
import { readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '..');

const posix = (p: string): string => p.split(sep).join('/');

function specFiles(): string[] {
  return readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.ts'))
    .map((entry) => posix(relative(SRC, join(entry.parentPath, entry.name))))
    .filter((rel) => !rel.startsWith('shared/db/generated/'))
    .sort();
}

describe('test placement', () => {
  it('every *.spec.ts under src/ has __tests__ as its parent folder', () => {
    const specs = specFiles();
    expect(specs.length).toBeGreaterThan(40);
    const colocated = specs.filter((rel) => basename(dirname(rel)) !== '__tests__');
    expect(
      colocated,
      `colocated test files — move each to <folder>/__tests__/<name> and bump its relative imports: ${colocated.join(', ')}`,
    ).toEqual([]);
  });
});
