/**
 * Node's own file storage (ADR-0041 §8, Phase 4.2 D-17). New files live behind this port: a volume
 * at `FILE_STORAGE_DIR` now (`VolumeStorage`), object storage later, never Perfex's upload folders
 * (Node shares no disk with the cPanel host, ADR-0024).
 *
 * Keys are generated, never built from input (T-4.2-11): `newStorageKey(area)` answers
 * `<area>/<yyyy>/<mm>/<uuid>`, and an adapter refuses any key that does not match `STORAGE_KEY`. A
 * client's file name is metadata on the owning row, never part of a path.
 *
 * The port and token follow `PASSWORD_HASHER`; the in-memory fake under `__tests__/` passes the same
 * contract spec as the volume adapter, so other modules' tests import it.
 */
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

/** What a write or a stat answers. */
export interface StoredObject {
  readonly key: string;
  readonly size: number;
}

/** Puts, reads, stats and deletes bytes under generated keys. */
export interface StoragePort {
  /** Moves a finished local file into storage (rename; copy then unlink across devices). */
  putFile(key: string, sourcePath: string): Promise<StoredObject>;
  /** Writes `<key>.part` then renames, so a reader never sees half a file. */
  putStream(key: string, body: Readable): Promise<StoredObject>;
  /** The stored bytes; `AppError('ERP-CORE-0004')` when the key is absent. */
  read(key: string): Promise<Readable>;
  stat(key: string): Promise<StoredObject | null>;
  /** An absent key is not an error. */
  delete(key: string): Promise<void>;
}

export const STORAGE = Symbol('STORAGE');

/** `<area>/<yyyy>/<mm>/<uuid>`, the only key shape an adapter accepts. */
export const STORAGE_KEY =
  /^[a-z0-9-]+\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const STORAGE_AREA = /^[a-z0-9-]+$/;
const MONTH_DIGITS = 2;

/** A fresh key in `area` (lower case, digits and `-`) for the UTC month of `now`. */
export function newStorageKey(area: string, now: Date = new Date()): string {
  if (!STORAGE_AREA.test(area)) throw new Error(`invalid storage area ${JSON.stringify(area)}`);
  const month = String(now.getUTCMonth() + 1).padStart(MONTH_DIGITS, '0');
  return `${area}/${String(now.getUTCFullYear())}/${month}/${randomUUID()}`;
}
