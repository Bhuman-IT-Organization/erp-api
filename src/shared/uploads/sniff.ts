/**
 * Content sniffing of a complete upload (ADR-0041 §6, T-4.2-28): the bytes must be what the file
 * name says, and the name's extension must be one the purpose allows. Binary types are read by
 * `file-type` from their magic bytes; csv and txt have none, so they must be valid UTF-8 with no NUL
 * byte in the first 4 KiB and no binary signature. The old Office formats (doc, xls, ppt) share one
 * container signature (CFB), which is as far as magic bytes can tell them apart. An extension this
 * table cannot verify (svg, html, anything else) never matches: a file is refused rather than
 * stored unchecked.
 */
import { open } from 'node:fs/promises';
import { posix } from 'node:path';
import { fileTypeFromFile } from 'file-type';

/** Extensions checked as text: UTF-8, no NUL. */
const TEXT_MIME: Readonly<Record<string, string>> = { csv: 'text/csv', txt: 'text/plain' };
/** The old Office formats, all one Compound File Binary container. */
const CFB_EXTENSIONS: readonly string[] = ['doc', 'xls', 'ppt'];
/** A declared extension and the one `file-type` names for the same bytes. */
const EQUIVALENT: Readonly<Record<string, string>> = { jpeg: 'jpg' };
/** How much of a text file is checked. */
const TEXT_SAMPLE_BYTES = 4096;
const NUL = 0;

/** The lower-case extension of a file name without the dot; `''` when it has none. */
export function extensionOf(fileName: string): string {
  return posix.extname(fileName).slice(1).toLowerCase();
}

async function isCleanText(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const sample = Buffer.alloc(TEXT_SAMPLE_BYTES);
    const { bytesRead } = await handle.read(sample, 0, TEXT_SAMPLE_BYTES, 0);
    const bytes = sample.subarray(0, bytesRead);
    if (bytes.includes(NUL)) return false;
    // `stream: true` keeps a character cut at the sample's end from counting as invalid.
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: true });
    return true;
  } catch {
    return false;
  } finally {
    await handle.close();
  }
}

/** True when the file at `path` is a `declared` file and `declared` is in `allowed`. */
export async function sniffMatches(
  path: string,
  declared: string,
  allowed: readonly string[],
): Promise<boolean> {
  if (!allowed.includes(declared)) return false;
  const type = await fileTypeFromFile(path);
  if (Object.hasOwn(TEXT_MIME, declared)) return type === undefined && (await isCleanText(path));
  if (type === undefined) return false;
  if (CFB_EXTENSIONS.includes(declared)) return type.ext === 'cfb';
  return type.ext === (Object.hasOwn(EQUIVALENT, declared) ? EQUIVALENT[declared] : declared);
}

/** The sniffed MIME type, or the text type of a text extension; call after `sniffMatches`. */
export async function mimeOf(path: string, declared: string): Promise<string> {
  const type = await fileTypeFromFile(path);
  if (type !== undefined) return type.mime;
  return Object.hasOwn(TEXT_MIME, declared)
    ? (TEXT_MIME[declared] ?? '')
    : 'application/octet-stream';
}
