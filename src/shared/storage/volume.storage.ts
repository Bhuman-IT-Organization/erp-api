/**
 * `StoragePort` on a directory (ADR-0041 §8): the files volume at `FILE_STORAGE_DIR`, mounted into
 * the api and the worker. Every key is checked twice before any disk call: it must match
 * `STORAGE_KEY`, and its resolved path must stay under the root (`containedPath`), so neither a
 * malformed key nor a traversal can reach outside it (T-4.2-11). The root is created on first write.
 */
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, open, rename, rm, stat, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../errors/app-error.js';
import { STORAGE_KEY, type StoragePort, type StoredObject } from './storage.port.js';

const INVALID_KEY = 'invalid storage key';

function errnoOf(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

/** `relative` resolved under `root`; throws `invalid storage key` when it would leave the root. */
export function containedPath(root: string, relative: string): string {
  const base = resolve(root);
  const full = resolve(base, relative);
  if (!full.startsWith(base + sep)) throw new Error(INVALID_KEY);
  return full;
}

/** The volume adapter; `root` is `FILE_STORAGE_DIR`. */
export class VolumeStorage implements StoragePort {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async putFile(key: string, sourcePath: string): Promise<StoredObject> {
    const target = await this.writablePath(key);
    try {
      await rename(sourcePath, target);
    } catch (error) {
      if (errnoOf(error) !== 'EXDEV') throw error;
      await copyFile(sourcePath, target);
      await unlink(sourcePath);
    }
    return { key, size: (await stat(target)).size };
  }

  async putStream(key: string, body: Readable): Promise<StoredObject> {
    const target = await this.writablePath(key);
    const part = `${target}.part`;
    try {
      await pipeline(body, createWriteStream(part));
    } catch (error) {
      await rm(part, { force: true });
      throw error;
    }
    await rename(part, target);
    return { key, size: (await stat(target)).size };
  }

  async read(key: string): Promise<Readable> {
    const handle = await open(this.pathOf(key), 'r').catch((error: unknown) => {
      throw errnoOf(error) === 'ENOENT' ? new AppError('ERP-CORE-0004') : error;
    });
    return handle.createReadStream();
  }

  async stat(key: string): Promise<StoredObject | null> {
    const found = await stat(this.pathOf(key)).catch((error: unknown) => {
      if (errnoOf(error) === 'ENOENT') return null;
      throw error;
    });
    return found === null ? null : { key, size: found.size };
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  private pathOf(key: string): string {
    if (!STORAGE_KEY.test(key)) throw new Error(INVALID_KEY);
    return containedPath(this.root, key);
  }

  private async writablePath(key: string): Promise<string> {
    const target = this.pathOf(key);
    await mkdir(dirname(target), { recursive: true });
    return target;
  }
}
