/**
 * The one `StoragePort` contract (ADR-0041, BE-17 "Instead"): every implementation, the volume
 * adapter and the in-memory fake alike, passes the same cases, so a test that uses the fake proves
 * what the volume does.
 */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../errors/app-error.js';
import { newStorageKey, type StoragePort } from '../storage.port.js';

/** Every byte of a stream. */
export async function bytesOf(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

/** Runs the contract against the storage `make` builds in a fresh temp directory per case. */
export function runStorageContract(name: string, make: (dir: string) => StoragePort): void {
  describe(`StoragePort contract: ${name}`, () => {
    let dir: string;
    let storage: StoragePort;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'erp-storage-'));
      storage = make(join(dir, 'root'));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('putStream then read returns the same bytes, and stat the size', async () => {
      const key = newStorageKey('contract');
      const bytes = randomBytes(1000);
      await expect(storage.putStream(key, Readable.from([bytes]))).resolves.toEqual({
        key,
        size: 1000,
      });
      expect((await bytesOf(await storage.read(key))).equals(bytes)).toBe(true);
      await expect(storage.stat(key)).resolves.toEqual({ key, size: 1000 });
    });

    it('putFile moves the source: the bytes are stored and the source path is gone', async () => {
      const key = newStorageKey('contract');
      const source = join(dir, 'source.bin');
      const bytes = randomBytes(300);
      await writeFile(source, bytes);
      await expect(storage.putFile(key, source)).resolves.toEqual({ key, size: 300 });
      expect(existsSync(source)).toBe(false);
      expect((await bytesOf(await storage.read(key))).equals(bytes)).toBe(true);
    });

    it('delete then stat is null', async () => {
      const key = newStorageKey('contract');
      await storage.putStream(key, Readable.from([Buffer.from('x')]));
      await storage.delete(key);
      await expect(storage.stat(key)).resolves.toBeNull();
    });

    it('deletes an absent key without an error', async () => {
      await expect(storage.delete(newStorageKey('contract'))).resolves.toBeUndefined();
    });

    it('refuses to read an absent key with ERP-CORE-0004', async () => {
      const error: unknown = await storage.read(newStorageKey('contract')).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('ERP-CORE-0004');
    });
  });
}
