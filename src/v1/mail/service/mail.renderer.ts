/**
 * The whole template engine: nothing here executes, sections and partials do not exist (D-10,
 * ADR-0049 decision 6). One function, `renderMail`, serves the preview and the send.
 *
 * - A merge field is a `{token}` of the template's own list; a known token is looked up with
 *   `Object.hasOwn`, so `{constructor}` or `{__proto__}` never reach the prototype; an unknown one
 *   stays as typed (the preview contract; the save validator refuses it).
 * - The HTML part escapes every literal run of the wording AND every value (D-04, T-4.3-02): neither
 *   what an administrator types nor what a record holds can become markup. The text part is raw.
 * - A `url` field becomes a link only when its value is `http:` or `https:` (T-4.3-10); the link
 *   text is the escaped value itself, never a disguise.
 * - The subject loses every C0 control character and DEL after substitution (T-4.3-01, Pitfall 7):
 *   a value cannot add a header line. nodemailer's own header encoding is the second control.
 */
import {
  escapeHtml,
  layoutHtml,
  MAIL_COLOURS,
  MAIL_LAYOUT,
  type MailBrand,
} from './mail.layout.js';

export { escapeHtml, type MailBrand };

export const TOKEN_PATTERN = /\{([a-z][a-z0-9_]*)\}/gu;

/** The same token as one capture of the whole `{token}`, for splitting a line into literals and tokens. */
const TOKEN_SPLIT = /(\{[a-z][a-z0-9_]*\})/u;

/** A blank line (spaces or tabs allowed) between paragraphs. */
const PARAGRAPH_BREAK = /\n[ \t]*\n/u;

const SPACE_RUN = / {2,}/gu;

/** Every character, one code point at a time (a control character is tested by its code). */
const ANY_CHAR = /[\s\S]/gu;

/** The last C0 control character; DEL is the other one. */
const LAST_C0 = 0x1f;
const DEL = 0x7f;

const normaliseNewlines = (text: string): string => text.replaceAll('\r\n', '\n');

/** Known tokens (own keys of `values`) replaced raw; every other `{token}` as typed. */
export function substitute(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(TOKEN_PATTERN, (whole, token: string) =>
    Object.hasOwn(values, token) ? (values[token] ?? '') : whole,
  );
}

/** The tokens of `text` outside `allowed`, distinct, in order of appearance. */
export function unknownTokens(text: string, allowed: ReadonlySet<string>): string[] {
  const tokens = [...text.matchAll(TOKEN_PATTERN)].map((match) => match[1] ?? '');
  return [...new Set(tokens.filter((token) => !allowed.has(token)))];
}

/** Every C0 control and DEL becomes a space, runs of spaces collapse, the ends are trimmed. */
export function cleanSubject(subject: string): string {
  const spaced = subject.replace(ANY_CHAR, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code <= LAST_C0 || code === DEL ? ' ' : char;
  });
  return spaced.replace(SPACE_RUN, ' ').trim();
}

/** The URL when it parses with protocol `http:` or `https:`, else null. */
export function safeUrl(value: string): string | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}

export interface RenderInput {
  readonly subject: string;
  readonly message: string;
  readonly values: Readonly<Record<string, string>>;
  readonly urlTokens: ReadonlySet<string>;
  readonly locale: string;
  readonly brand: MailBrand;
  /** `messageOf(locale, 'test_prefix')` for a test, else null. */
  readonly subjectPrefix: string | null;
}

export interface RenderedMail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

const LINK_STYLE = `color:${MAIL_COLOURS.text};text-decoration:underline`;
const PARAGRAPH_STYLE = `margin:0 0 ${String(MAIL_LAYOUT.bodyLinePx)}px`;

function tokenHtml(
  whole: string,
  values: Readonly<Record<string, string>>,
  urlTokens: ReadonlySet<string>,
): string {
  const token = whole.slice(1, -1);
  if (!Object.hasOwn(values, token)) return escapeHtml(whole);
  const value = values[token] ?? '';
  const url = urlTokens.has(token) ? safeUrl(value) : null;
  return url === null
    ? escapeHtml(value)
    : `<a href="${escapeHtml(url)}" style="${LINK_STYLE}">${escapeHtml(value)}</a>`;
}

/** Odd parts of the split are the `{token}` captures, even parts the literal runs between them. */
function lineHtml(
  line: string,
  values: Readonly<Record<string, string>>,
  urlTokens: ReadonlySet<string>,
): string {
  return line
    .split(TOKEN_SPLIT)
    .map((part, index) => (index % 2 === 0 ? escapeHtml(part) : tokenHtml(part, values, urlTokens)))
    .join('');
}

function paragraphHtml(
  paragraph: string,
  values: Readonly<Record<string, string>>,
  urlTokens: ReadonlySet<string>,
): string {
  const lines = paragraph.split('\n').map((line) => lineHtml(line, values, urlTokens));
  return `<p style="${PARAGRAPH_STYLE}">${lines.join('<br>')}</p>`;
}

function bodyHtml(
  message: string,
  values: Readonly<Record<string, string>>,
  urlTokens: ReadonlySet<string>,
): string {
  return normaliseNewlines(message)
    .split(PARAGRAPH_BREAK)
    .filter((paragraph) => paragraph.trim() !== '')
    .map((paragraph) => paragraphHtml(paragraph, values, urlTokens))
    .join('');
}

/** The subject, the branded HTML part and the plain-text part of one email. */
export function renderMail(input: RenderInput): RenderedMail {
  const { values, urlTokens, brand, locale } = input;
  const prefix = input.subjectPrefix === null ? '' : `${input.subjectPrefix} `;
  const subject = cleanSubject(prefix + substitute(input.subject, values));
  const text = `${normaliseNewlines(substitute(input.message, values))}\n\n${brand.companyName}`;
  const html = layoutHtml({
    bodyHtml: bodyHtml(input.message, values, urlTokens),
    locale,
    brand,
    title: subject,
  });
  return { subject, html, text };
}
