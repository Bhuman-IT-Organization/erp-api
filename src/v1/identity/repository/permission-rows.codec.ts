/**
 * The narrow PHP `serialize()` codec for `tblroles.permissions` — the one column in this module's
 * tables that holds a serialised PHP value (identity-access brief §2.1: all 21 rows are
 * `array<string, string[]>`, a Perfex `feature => [capability, …]` template).
 *
 * Written by hand and specced here rather than installed: the shape is one array of arrays of
 * strings, a dependency for it would need an ADR-0017 licence line, and `03.1-RESEARCH.md`
 * § Package Legitimacy Audit records that this phase installs nothing (threat T-3.1-SC, brief §6).
 *
 * **Byte-length aware.** PHP writes `s:<byte length>:"…"`, not `s:<character count>:"…"`, so both
 * directions count UTF-8 bytes: the encoder with `Buffer.byteLength`, the decoder by parsing over a
 * `Buffer` and slicing by byte offset. A role name or capability outside ASCII would otherwise
 * round-trip to a string PHP cannot read.
 *
 * What it deliberately does not do: no object, no reference, no nested array beyond the two levels
 * the column holds, no integer or boolean leaf. Anything else is malformed, and malformed decodes
 * to `{}` with a warn — a role whose template we cannot read grants nothing, which is the safe
 * direction (a throw would take the whole member save down for a column Perfex wrote).
 */

/** Why a decode was refused; handed to the caller's warn, never to the client. */
export type MalformedReason = string;

interface Reader {
  readonly buf: Buffer;
  pos: number;
}

class MalformedError extends Error {
  override readonly name = 'MalformedError';
}

function expectText(reader: Reader, text: string): void {
  const bytes = Buffer.from(text, 'utf8');
  const seen = reader.buf.subarray(reader.pos, reader.pos + bytes.length);
  if (!seen.equals(bytes)) {
    throw new MalformedError(`expected ${JSON.stringify(text)} at byte ${String(reader.pos)}`);
  }
  reader.pos += bytes.length;
}

/** Reads decimal digits up to `terminator`, consuming it. */
function readCount(reader: Reader, terminator: string): number {
  const end = reader.buf.indexOf(terminator, reader.pos);
  if (end === -1) {
    throw new MalformedError(`no ${JSON.stringify(terminator)} after byte ${String(reader.pos)}`);
  }
  const text = reader.buf.toString('utf8', reader.pos, end);
  if (!/^\d+$/.test(text)) throw new MalformedError(`${JSON.stringify(text)} is not a count`);
  reader.pos = end + Buffer.byteLength(terminator, 'utf8');
  return Number(text);
}

/** `s:<bytes>:"value";` — the length is a byte count, so the slice is by byte offset. */
function readString(reader: Reader): string {
  expectText(reader, 's:');
  const byteLength = readCount(reader, ':');
  expectText(reader, '"');
  const end = reader.pos + byteLength;
  if (end > reader.buf.length) throw new MalformedError('string runs past the end');
  const value = reader.buf.toString('utf8', reader.pos, end);
  reader.pos = end;
  expectText(reader, '";');
  return value;
}

/** `a:<count>:{` — returns the declared element count. */
function readArrayHeader(reader: Reader): number {
  expectText(reader, 'a:');
  const count = readCount(reader, ':');
  expectText(reader, '{');
  return count;
}

function phpString(value: string): string {
  return `s:${String(Buffer.byteLength(value, 'utf8'))}:"${value}";`;
}

/**
 * The PHP `serialize()` text for a `feature => capability[]` map, byte-for-byte what Perfex's own
 * roles screen writes. Key order is the map's own insertion order, list order the array's.
 */
export function encodeRolePermissions(map: Readonly<Record<string, readonly string[]>>): string {
  const entries = Object.entries(map);
  let out = `a:${String(entries.length)}:{`;
  for (const [feature, capabilities] of entries) {
    out += phpString(feature);
    out += `a:${String(capabilities.length)}:{`;
    for (const [index, capability] of capabilities.entries()) {
      out += `i:${String(index)};${phpString(capability)}`;
    }
    out += '}';
  }
  return `${out}}`;
}

/**
 * The `feature => capability[]` map a `tblroles.permissions` value holds. `null`, an empty column
 * and anything malformed answer `{}`; `onMalformed` is called with the reason so the caller can
 * warn (the repository does — a codec has no logger of its own).
 */
export function decodeRolePermissions(
  serialized: string | null,
  onMalformed?: (reason: MalformedReason) => void,
): Record<string, string[]> {
  if (serialized === null || serialized === '') return {};
  const reader: Reader = { buf: Buffer.from(serialized, 'utf8'), pos: 0 };
  try {
    const featureCount = readArrayHeader(reader);
    const map: Record<string, string[]> = {};
    for (let feature = 0; feature < featureCount; feature += 1) {
      const name = readString(reader);
      const capabilityCount = readArrayHeader(reader);
      const capabilities: string[] = [];
      for (let index = 0; index < capabilityCount; index += 1) {
        expectText(reader, 'i:');
        const declaredIndex = readCount(reader, ';');
        if (declaredIndex !== index) {
          throw new MalformedError(
            `capability list of ${JSON.stringify(name)} is keyed ${String(declaredIndex)} at ${String(index)}`,
          );
        }
        capabilities.push(readString(reader));
      }
      expectText(reader, '}');
      map[name] = capabilities;
    }
    expectText(reader, '}');
    if (reader.buf.toString('utf8', reader.pos).trim() !== '') {
      throw new MalformedError('trailing bytes after the outer array');
    }
    return map;
  } catch (error) {
    onMalformed?.(error instanceof MalformedError ? error.message : 'unreadable');
    return {};
  }
}
