import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extensionOf, mimeOf, sniffMatches } from '../sniff.js';

/** A 1x1 PNG (synthetic, generated for tests). */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
/** HTML a browser would render if it were ever served inline. */
const HTML_BYTES = Buffer.from('<!doctype html><html><script>alert(1)</script></html>');
const CSV_BYTES = Buffer.from('a,b\n1,2\n');
const CFB_BYTES = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(504),
]);
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

describe('extensionOf', () => {
  it.each([
    ['Report.PDF', 'pdf'],
    ['rows.csv', 'csv'],
    ['archive.tar.gz', 'gz'],
    ['noext', ''],
    ['.png', ''],
  ])('%s is %j', (name, ext) => {
    expect(extensionOf(name)).toBe(ext);
  });
});

describe('sniffMatches', () => {
  let dir: string;
  const at = async (name: string, bytes: Buffer): Promise<string> => {
    const path = join(dir, name);
    await writeFile(path, bytes);
    return path;
  };
  const ALL = ['png', 'jpg', 'csv', 'txt', 'doc', 'svg', 'pdf'];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'erp-sniff-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('matches PNG bytes declared png', async () => {
    await expect(sniffMatches(await at('a.png', PNG_BYTES), 'png', ALL)).resolves.toBe(true);
  });

  it('refuses the same PNG bytes declared jpg', async () => {
    await expect(sniffMatches(await at('b.jpg', PNG_BYTES), 'jpg', ALL)).resolves.toBe(false);
  });

  it('refuses HTML bytes declared png', async () => {
    await expect(sniffMatches(await at('c.png', HTML_BYTES), 'png', ALL)).resolves.toBe(false);
  });

  it('matches clean UTF-8 text declared csv', async () => {
    await expect(sniffMatches(await at('rows.csv', CSV_BYTES), 'csv', ALL)).resolves.toBe(true);
  });

  it('refuses text with a NUL byte declared csv', async () => {
    const bytes = Buffer.concat([CSV_BYTES, Buffer.from([0]), CSV_BYTES]);
    await expect(sniffMatches(await at('nul.csv', bytes), 'csv', ALL)).resolves.toBe(false);
  });

  it('refuses invalid UTF-8 declared txt', async () => {
    const bytes = Buffer.from([0x61, 0xff, 0xfe, 0x62]);
    await expect(sniffMatches(await at('bad.txt', bytes), 'txt', ALL)).resolves.toBe(false);
  });

  it('matches a CFB container declared doc', async () => {
    await expect(sniffMatches(await at('old.doc', CFB_BYTES), 'doc', ALL)).resolves.toBe(true);
  });

  it('refuses an extension the purpose does not allow, even with matching bytes', async () => {
    await expect(sniffMatches(await at('d.png', PNG_BYTES), 'png', ['csv'])).resolves.toBe(false);
  });

  it('refuses an extension the table cannot verify (svg)', async () => {
    await expect(sniffMatches(await at('e.svg', SVG_BYTES), 'svg', ALL)).resolves.toBe(false);
  });

  it('names the sniffed type, or the text type of a text extension', async () => {
    await expect(mimeOf(await at('m.png', PNG_BYTES), 'png')).resolves.toBe('image/png');
    await expect(mimeOf(await at('m.csv', CSV_BYTES), 'csv')).resolves.toBe('text/csv');
    await expect(mimeOf(await at('m.txt', CSV_BYTES), 'txt')).resolves.toBe('text/plain');
  });
});
