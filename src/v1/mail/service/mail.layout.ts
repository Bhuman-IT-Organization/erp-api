/**
 * The branded email page around a rendered body (04.3-UI-SPEC § Email layout): inline styles, a
 * 600px column, the 4px brand bar, the logo or the company name, the message, a rule and the
 * company name as the footer. The brand comes from branding data (D-04), never from code. The three
 * hex values are the email twins of the app's `--foreground`, `--border` and `--muted-foreground`
 * (email clients do not read oklch); they live here and nowhere in erp-web.
 *
 * Every piece of brand data is escaped here; the body arrives already escaped from the renderer.
 * `escapeHtml` lives here (the renderer imports this file and re-exports it, so there is no cycle).
 */

/** The brand an email carries: from `BrandingFacade` through the transport (D-04). */
export interface MailBrand {
  readonly companyName: string;
  /** Absolute http(s), or null: the header shows the company name. */
  readonly logoUrl: string | null;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

/** `& < > " '` to entities: text, never markup or an attribute break (T-4.3-02). Re-exported by the renderer. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (c) => HTML_ESCAPES[c] ?? c);
}

export const MAIL_COLOURS = Object.freeze({
  text: '#171717',
  rule: '#e5e5e5',
  muted: '#737373',
  bar: '#171717',
  page: '#ffffff',
});

export const MAIL_LAYOUT = Object.freeze({
  maxWidthPx: 600,
  paddingPx: 24,
  barPx: 4,
  logoMaxHeightPx: 48,
  headerFontPx: 20,
  headerWeight: 600,
  bodyFontPx: 16,
  bodyLinePx: 24,
  footerFontPx: 12,
});

/** Email clients do not load Inter; Arial carries Arabic glyphs on common systems. */
export const MAIL_FONT = 'Arial, Helvetica, sans-serif';

/** The right-to-left locales; the twin of erp-web's `RTL_LOCALES` (the api cannot import it). */
export const RTL_LOCALES: readonly string[] = Object.freeze(['ar']);

export function directionOf(locale: string): 'rtl' | 'ltr' {
  return RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
}

function headerHtml(brand: MailBrand): string {
  const name = escapeHtml(brand.companyName);
  const { paddingPx, logoMaxHeightPx, headerFontPx, headerWeight } = MAIL_LAYOUT;
  const content =
    brand.logoUrl === null
      ? `<div style="font-size:${String(headerFontPx)}px;font-weight:${String(headerWeight)}">${name}</div>`
      : `<img src="${escapeHtml(brand.logoUrl)}" alt="${name}" style="display:block;border:0;max-height:${String(logoMaxHeightPx)}px">`;
  return `<div style="padding:${String(paddingPx)}px 0">${content}</div>`;
}

/** The whole HTML document: `dir` and `lang` of the version on `<html>`, so Arabic mirrors. */
export function layoutHtml(input: {
  readonly bodyHtml: string;
  readonly locale: string;
  readonly brand: MailBrand;
  readonly title: string;
}): string {
  const { maxWidthPx, paddingPx, barPx, bodyFontPx, bodyLinePx, footerFontPx } = MAIL_LAYOUT;
  const locale = escapeHtml(input.locale);
  return [
    '<!doctype html>',
    `<html lang="${locale}" dir="${directionOf(input.locale)}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(input.title)}</title></head>`,
    `<body style="margin:0;background:${MAIL_COLOURS.page}">`,
    `<div style="max-width:${String(maxWidthPx)}px;margin:0 auto;padding:${String(paddingPx)}px;font-family:${MAIL_FONT};color:${MAIL_COLOURS.text}">`,
    `<div style="height:${String(barPx)}px;background:${MAIL_COLOURS.bar}"></div>`,
    headerHtml(input.brand),
    `<div style="font-size:${String(bodyFontPx)}px;line-height:${String(bodyLinePx)}px">${input.bodyHtml}</div>`,
    `<hr style="border:0;border-top:1px solid ${MAIL_COLOURS.rule};margin:${String(paddingPx)}px 0 0">`,
    `<p style="font-size:${String(footerFontPx)}px;color:${MAIL_COLOURS.muted};margin:${String(footerFontPx)}px 0 0">${escapeHtml(input.brand.companyName)}</p>`,
    '</div></body></html>',
  ].join('');
}
