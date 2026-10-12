/**
 * The row fingerprint (ADR-0040, Phase 4.2 D-14): a record a screen edits carries a quoted strong
 * ETag computed from what that screen shows; a save sends it back in `If-Match`, and the repository,
 * after taking the row lock (`UPDATE <t> SET id = id WHERE id = ?` first in the transaction),
 * re-reads the shown columns and calls `assertFresh` or `assertBatchFresh`. A different fingerprint
 * is 412 `ERP-CORE-0013`; a batch names every stale row in `issues` and nothing is written (L-08).
 *
 * Why a fingerprint and not a version column: every W1 table is co-written by Perfex, which would
 * never bump a version. Why only the shown columns: a co-writer flipping a column the screen does
 * not own (an accounting mapping, a manufacturing field) must not refuse an unrelated save
 * (RESEARCH Pitfall 3). So `shown` is exactly the columns and owned child rows the form writes,
 * never a secret column (T-4.2-32).
 *
 * Pure functions, no I/O: the repository owns the lock and the read, this file only compares.
 */
import { createHash } from 'node:crypto';
import { AppError } from '../errors/app-error.js';

/** The response header beside the body's `etag` field (erp-web reads the body, PATTERNS M4). */
export const ETAG_HEADER = 'ETag';

/** One row of a batch save: the fingerprint the client sent and the row as it is now. */
export interface BatchRowVersion {
  readonly id: string | number;
  readonly etag: string;
  readonly current: unknown;
}

function hasToJson(value: object): value is { toJSON: () => unknown } {
  return typeof (value as { toJSON?: unknown }).toJSON === 'function';
}

/**
 * Stable JSON: object keys sorted, arrays in order, `undefined` and `null` both `null`, a bigint as
 * the string of its decimal, a value with `toJSON()` (a Date, a Prisma Decimal) through it, every
 * other scalar through `JSON.stringify`. The same row always hashes the same.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value !== 'object') return JSON.stringify(value);
  if (hasToJson(value)) return canonicalJson(value.toJSON());
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const fields = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${fields.join(',')}}`;
}

/** `"<base64url sha-256 of canonicalJson(shown)>"`: 43 characters inside the quotes. */
export function etagOf(shown: unknown): string {
  return `"${createHash('sha256').update(canonicalJson(shown)).digest('base64url')}"`;
}

/** Throws 412 `ERP-CORE-0013` when `current` no longer has the fingerprint the client read. */
export function assertFresh(ifMatch: string, current: unknown): void {
  if (etagOf(current) !== ifMatch) throw new AppError('ERP-CORE-0013');
}

/**
 * Throws one 412 `ERP-CORE-0013` naming EVERY stale row in `issues` (`[{ id: '<row id>' }]`), so the
 * screen can mark them all; returns when every row is fresh.
 */
export function assertBatchFresh(rows: readonly BatchRowVersion[]): void {
  const stale = rows.filter((row) => etagOf(row.current) !== row.etag);
  if (stale.length === 0) return;
  throw new AppError('ERP-CORE-0013', `${String(stale.length)} rows changed since they were read`, {
    issues: stale.map((row) => ({ id: String(row.id) })),
  });
}
