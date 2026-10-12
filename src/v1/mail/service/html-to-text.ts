/**
 * Seeding only (D-03, RESEARCH R4 "Seeding"): Perfex's template HTML to the plain text Node stores.
 * `<br>` is a newline and `</p>` a blank line; every other tag is removed and sets
 * `formattingDropped`, which tells the administrator to check the wording. The common entities and
 * numeric references are decoded AFTER the tags are gone, so an escaped `&lt;b&gt;` stays text.
 * The output is plain text that the renderer escapes again (T-4.3-25): nothing here is trusted
 * as markup, and `{tokens}` pass through untouched.
 */

const BR = /<br\s*\/?>/giu;
const P_CLOSE = /<\/p\s*>/giu;
const P_OPEN = /<p(?:\s[^>]*)?>/giu;
const ANY_TAG = /<[^>]*>/gu;
const ENTITY = /&(?:#x([0-9a-f]+)|#([0-9]+)|(amp|lt|gt|quot|nbsp));/giu;
const MANY_NEWLINES = /\n{3,}/gu;
const LINE_END_SPACE = /[ \t]+$/gmu;

const NAMED: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  nbsp: ' ',
});

const HEX = 16;
const DECIMAL = 10;
const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_FIRST = 0xd800;
const SURROGATE_LAST = 0xdfff;

/** A code point as text; one outside Unicode (or a lone surrogate) is dropped. */
function fromCode(code: number): string {
  if (code > MAX_CODE_POINT || (code >= SURROGATE_FIRST && code <= SURROGATE_LAST)) return '';
  return String.fromCodePoint(code);
}

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (_whole, hex?: string, decimal?: string, name?: string) => {
    if (hex !== undefined) return fromCode(Number.parseInt(hex, HEX));
    if (decimal !== undefined) return fromCode(Number.parseInt(decimal, DECIMAL));
    return NAMED[(name ?? '').toLowerCase()] ?? '';
  });
}

export function htmlToText(html: string): {
  readonly text: string;
  readonly formattingDropped: boolean;
} {
  let formattingDropped = false;
  const stripped = html
    .replaceAll('\r\n', '\n')
    .replace(BR, '\n')
    .replace(P_CLOSE, '\n\n')
    .replace(P_OPEN, '')
    .replace(ANY_TAG, () => {
      formattingDropped = true;
      return '';
    });
  const text = decodeEntities(stripped)
    .replace(LINE_END_SPACE, '')
    .replace(MANY_NEWLINES, '\n\n')
    .trim();
  return { text, formattingDropped };
}
