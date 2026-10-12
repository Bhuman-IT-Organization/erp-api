import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newStorageKey, STORAGE_KEY } from '../storage.port.js';
import { containedPath, VolumeStorage } from '../volume.storage.js';
import { runStorageContract } from './storage.contract.js';

runStorageContract('VolumeStorage', (root) => new VolumeStorage(root));

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

describe('newStorageKey', () => {
  it('builds <area>/<yyyy>/<mm>/<uuid>', () => {
    const key = newStorageKey('item-files', new Date('2026-09-29T00:00:00Z'));
    expect(key).toMatch(new RegExp(`^item-files/2026/09/${UUID}$`));
    expect(STORAGE_KEY.test(key)).toBe(true);
  });

  it.each(['../x', 'A', '', 'a/b', 'a.b'])('refuses the area %j', (area) => {
    expect(() => newStorageKey(area)).toThrow();
  });
});

describe('VolumeStorage refusals', () => {
  let dir: string;
  let root: string;
  let storage: VolumeStorage;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'erp-volume-'));
    root = join(dir, 'root');
    storage = new VolumeStorage(root);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    ['a traversal', '../etc/passwd'],
    ['a malformed key', 'a/2026/09/not-a-uuid'],
    ['an absolute path', resolve('/etc/passwd')],
    ['a backslash', String.raw`a\2026\09\0b7c2c4e-8f0a-4a8e-9a8e-2f0c1d3e4f5a`],
  ])('refuses %s with "invalid storage key" and writes nothing', async (_label, key) => {
    await expect(storage.putStream(key, Readable.from([Buffer.from('x')]))).rejects.toThrow(
      'invalid storage key',
    );
    await expect(storage.read(key)).rejects.toThrow('invalid storage key');
    await expect(storage.stat(key)).rejects.toThrow('invalid storage key');
    await expect(storage.delete(key)).rejects.toThrow('invalid storage key');
    expect(existsSync(root) ? await readdir(root, { recursive: true }) : []).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('keeps a path inside the root and refuses a traversal out of it (the second line behind STORAGE_KEY)', () => {
    expect(containedPath(root, 'a/b').startsWith(resolve(root) + sep)).toBe(true);
    expect(() => containedPath(root, '../etc/passwd')).toThrow('invalid storage key');
  });
});
