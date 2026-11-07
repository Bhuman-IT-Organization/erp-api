export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function decodeHtml(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeAndJoinLine(line: string): string {
  return escapeHtml(line);
}

export function textToHtml(text: string | undefined | null): string {
  if (!text || text.trim() === '') return '';
  const normalized = text.replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n\s*\n/);
  return blocks
    .map((block) => {
      const lines = block.split('\n');
      const escapedLines = lines.map(escapeAndJoinLine);
      return `<p>${escapedLines.join('<br>')}</p>`;
    })
    .join('');
}

export function htmlToText(html: string | undefined | null): { text: string; hasOtherFormatting: boolean } {
  if (!html) return { text: '', hasOtherFormatting: false };
  const tagRegex = /<\/?[a-z0-9-]+(\s+[^>]*)?\/?>/gi;
  let match: RegExpExecArray | null;
  let hasOtherFormatting = false;
  while ((match = tagRegex.exec(html)) !== null) {
    const tag = match[0].toLowerCase();
    if (!['<p>', '</p>', '<br>', '<br/>', '<br />'].includes(tag)) {
      hasOtherFormatting = true;
    }
  }
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/?[a-z0-9-]+(\s+[^>]*)?\/?>/gi, '')
    .trim();
  text = decodeHtml(text);
  return { text, hasOtherFormatting };
}

export const MESSAGE_MAX_BYTES = 16_777_215;

export function exceedsMessageLimit(html: string): boolean {
  return Buffer.byteLength(html, 'utf8') > MESSAGE_MAX_BYTES;
}

export function validateMessageByteLength(html: string): void {
  if (exceedsMessageLimit(html)) {
    throw new Error('Message is too long (exceeds MEDIUMTEXT limit)');
  }
}
