/**
 * The in-memory `StoragePort` for unit specs (other modules' tests import it). It passes the same
 * contract spec as `VolumeStorage` (`storage.contract.ts`), key checks included.
 */
import { readFile, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { AppError } from '../../errors/app-error.js';
import { STORAGE_KEY, type StoragePort, type StoredObject } from '../storage.port.js';

function checked(key: string): string {
  if (!STORAGE_KEY.test(key)) throw new Error('invalid storage key');
  return key;
}

/** Bytes in a Map keyed by storage key. */
export class InMemoryStorage implements StoragePort {
  readonly objects = new Map<string, Buffer>();

  async putFile(key: string, sourcePath: string): Promise<StoredObject> {
    const bytes = await readFile(sourcePath);
    await unlink(sourcePath);
    this.objects.set(checked(key), bytes);
    return { key, size: bytes.length };
  }

  async putStream(key: string, body: Readable): Promise<StoredObject> {
    checked(key);
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
    const bytes = Buffer.concat(chunks);
    this.objects.set(key, bytes);
    return { key, size: bytes.length };
  }

  read(key: string): Promise<Readable> {
    const bytes = this.objects.get(checked(key));
    if (bytes === undefined) return Promise.reject(new AppError('ERP-CORE-0004'));
    return Promise.resolve(Readable.from([bytes]));
  }

  stat(key: string): Promise<StoredObject | null> {
    const bytes = this.objects.get(checked(key));
    return Promise.resolve(bytes === undefined ? null : { key, size: bytes.length });
  }

  delete(key: string): Promise<void> {
    this.objects.delete(checked(key));
    return Promise.resolve();
  }
}
