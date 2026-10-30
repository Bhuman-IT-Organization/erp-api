const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPE_MAP[character] ?? character);
}

/**
 * Converts user-entered plain text into safe HTML for storage.
 * Blank lines separate paragraphs; single newlines become <br>.
 */
export function toStoredHtml(plainText: string): string {
  if (plainText.length === 0) return '';

  return plainText
    .split(/\r?\n[ \t]*\r?\n/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}

const ENTITY_MAP: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: '\u00a0',
};

/**
 * Converts stored HTML into plain text. Any tag other than paragraph and line-break markup is
 * flagged, and entities are decoded in one pass so escaped text is never decoded recursively.
 */
export function fromStoredHtml(html: string): {
  text: string;
  hasOtherFormatting: boolean;
} {
  const hasOtherFormatting = /<\/?(?!p\b|br\b)[a-z][^>]*>/i.test(html);

  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<p\b[^>]*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(
      /&(?:amp|lt|gt|quot|#39|apos|nbsp);/gi,
      (entity) => ENTITY_MAP[entity.slice(1, -1).toLowerCase()] ?? entity,
    )
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');

  return { text, hasOtherFormatting };
}
