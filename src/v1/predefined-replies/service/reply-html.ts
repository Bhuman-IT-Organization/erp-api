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

/**
 * Converts stored HTML into plain text for the API.
 * Flags common formatting from older Perfex replies so the UI can warn
 * that saving the reply as plain text will remove that formatting.
 */
export function fromStoredHtml(html: string): {
  text: string;
  hasOtherFormatting: boolean;
} {
  const hasOtherFormatting =
    /<(?:b|strong|i|em|u|s|del|ins|a|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|h[1-6])\b/i.test(
      html,
    );

  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<p\b[^>]*>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, '\u00a0')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');

  return { text, hasOtherFormatting };
}
