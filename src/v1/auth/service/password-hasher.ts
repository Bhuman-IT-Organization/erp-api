/**
 * bcrypt for the legacy `tblstaff.password` column (research Q1).
 *
 * Four labels exist in the wild: `$2a$08$` (what Perfex's phpass writes), `$2y$10$` and
 * `$2y$08$` (the live rows after the 2026-08-07 bulk reset and a local `password_hash`), and
 * `$2b$12$` (what bcryptjs would emit natively). `bcryptjs.compare` reads the label, the cost and
 * the salt from the stored hash and compares in constant time; nothing here parses the cost or
 * string-compares a hash.
 *
 * New hashes are `$2y$12$`: the same algorithm, PHP's own label, so a user who later falls back
 * to the legacy login is verified by PHP `crypt()` on any host (verified in the legacy image).
 * `needsRehash` is "not already `$2y$12$`" — the service re-hashes on the next successful login.
 *
 * It implements `PasswordHasherPort` and `AuthModule` provides it under `PASSWORD_HASHER`, so
 * `v1/identity` — which owns `tblstaff` and therefore writes the password an administrator sets
 * (ADR-0034 d.1) — hashes through this class rather than carrying a second copy of the rule.
 */
import { Injectable } from '@nestjs/common';
import { compare, genSalt, hash } from 'bcryptjs';
import type { PasswordHasherPort } from '../../../shared/crypto/password-hasher.port.js';

const TARGET_COST = 12;

@Injectable()
export class PasswordHasher implements PasswordHasherPort {
  static readonly TARGET_PREFIX = '$2y$12$';

  /** `true` when `password` matches `storedHash` (any bcrypt label, any cost); `false` on a mismatch or an unparsable hash. */
  async verify(password: string, storedHash: string): Promise<boolean> {
    try {
      return await compare(password, storedHash);
    } catch {
      // An unparsable stored value (empty column, unknown label) is a mismatch, not a 500.
      return false;
    }
  }

  /** A fresh `$2y$12$` hash (60 characters). */
  async hash(password: string): Promise<string> {
    const salt = (await genSalt(TARGET_COST)).replace(/^\$2b\$/, '$2y$');
    return hash(password, salt);
  }

  /** `true` unless the stored hash already carries the target label and cost. */
  needsRehash(storedHash: string): boolean {
    return !storedHash.startsWith('$2y$12$');
  }
}
