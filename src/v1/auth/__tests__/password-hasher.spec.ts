/**
 * Every fixture is GENERATED here (research Pitfall 9 / T-1.3-28): a bcrypt string copied from
 * the database would be a real credential in the repository. `hashSync` with a cost yields a
 * `$2b$` label; the first four bytes are relabelled to reproduce what the wild holds.
 */
import { hashSync } from 'bcryptjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PasswordHasher } from '../service/password-hasher.js';

const PASSWORD = 'fixture-password';
const WRONG = 'fixture-password-wrong';

function relabel(hash: string, label: '$2a$' | '$2y$' | '$2b$'): string {
  return label + hash.slice(4);
}

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();
  let fixtures: Record<'$2a$08$' | '$2y$08$' | '$2y$10$' | '$2b$12$', string>;

  beforeAll(() => {
    fixtures = {
      $2a$08$: relabel(hashSync(PASSWORD, 8), '$2a$'), // what Perfex's phpass writes
      $2y$08$: relabel(hashSync(PASSWORD, 8), '$2y$'), // a local password_hash(cost 8)
      $2y$10$: relabel(hashSync(PASSWORD, 10), '$2y$'), // the live rows after the 2026-08-07 reset
      $2b$12$: hashSync(PASSWORD, 12), // bcryptjs native
    };
  });

  it.each(['$2a$08$', '$2y$08$', '$2y$10$', '$2b$12$'] as const)(
    'verifies the right password and rejects a wrong one for a %s hash',
    async (label) => {
      const stored = fixtures[label];
      expect(stored.startsWith(label)).toBe(true);
      expect(stored).toHaveLength(60);
      await expect(hasher.verify(PASSWORD, stored)).resolves.toBe(true);
      await expect(hasher.verify(WRONG, stored)).resolves.toBe(false);
    },
  );

  it('hash() produces a 60-character $2y$12$ string that verify() accepts', async () => {
    const produced = await hasher.hash('x');
    expect(produced.startsWith(PasswordHasher.TARGET_PREFIX)).toBe(true);
    expect(produced.startsWith('$2y$12$')).toBe(true);
    expect(produced).toHaveLength(60);
    await expect(hasher.verify('x', produced)).resolves.toBe(true);
    await expect(hasher.verify('y', produced)).resolves.toBe(false);
  });

  it('two hashes of the same password differ (fresh salt each time)', async () => {
    const [a, b] = await Promise.all([hasher.hash('x'), hasher.hash('x')]);
    expect(a).not.toBe(b);
  });

  it.each(['$2a$08$', '$2y$08$', '$2y$10$', '$2b$12$'] as const)(
    'needsRehash is true for a %s hash',
    (label) => {
      expect(hasher.needsRehash(fixtures[label])).toBe(true);
    },
  );

  it('needsRehash is false for the $2y$12$ output', async () => {
    expect(hasher.needsRehash(await hasher.hash('x'))).toBe(false);
  });

  it.each(['', 'not-a-hash', '$1$abc', '$2z$12$' + 'a'.repeat(53), '$P$Bportable'])(
    'verify() resolves false (never throws) for the unparsable stored value %j',
    async (stored) => {
      let outcome: boolean | 'threw' = 'threw';
      try {
        outcome = await hasher.verify(PASSWORD, stored);
      } catch {
        outcome = 'threw';
      }
      expect(outcome).toBe(false);
    },
  );
});
