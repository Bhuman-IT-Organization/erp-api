/**
 * No vendor licence check exists in erp-api, and none can arrive unnoticed (ADR-0042 point 5,
 * P-01, T-4.2-14, T-4.2-15). Perfex's modules carry a vendor licence check that Node never
 * rebuilds: no licence server call, no licence key variable, no `LB-*` header and no
 * `vendorLicence` breaker. Every source file git knows under `src/`, `packages/`, `scripts/` and
 * `prisma/` (tracked, or new and not ignored), except this spec, is matched case-insensitively
 * against the patterns below; the failure message lists each offending `file:line`. The
 * patterns live in a `String.raw` literal, so no backslash is doubled. erp-web holds the twin,
 * `src/__tests__/no-vendor-licence.test.ts`.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF = 'src/__tests__/no-vendor-licence.spec.ts';
const SCANNED = ['src', 'packages', 'scripts', 'prisma'];
const LICENCE = new RegExp(
  String.raw`verify_license|verify-license|licensebox|lb-api-key|lb-url|lb-ip|vendorlicen[cs]e|licen[cs]e_api|licen[cs]e_key|api/verify_license|\.lic['"` +
    '`]',
  'i',
);

function sourceFiles(): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...SCANNED],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return listed.split('\n').filter((file) => file !== '' && file !== SELF);
}

describe('no vendor licence check (ADR-0042, T-4.2-14)', () => {
  it('names no licence server, licence key, LB-* header or vendorLicence breaker anywhere', () => {
    const offending: string[] = [];
    for (const file of sourceFiles()) {
      let text: string;
      try {
        text = readFileSync(join(ROOT, file), 'utf8');
      } catch {
        continue; // listed by git but deleted in the working tree
      }
      text.split('\n').forEach((line, index) => {
        if (LICENCE.test(line)) offending.push(`${file}:${String(index + 1)}`);
      });
    }
    expect(offending, offending.join('\n')).toEqual([]);
  });
});
