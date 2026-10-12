import { describe, expect, it } from 'vitest';
import { directionOf, layoutHtml, MAIL_COLOURS, RTL_LOCALES } from '../service/mail.layout.js';
import {
  cleanSubject,
  escapeHtml,
  renderMail,
  safeUrl,
  substitute,
  unknownTokens,
  type MailBrand,
  type RenderInput,
} from '../service/mail.renderer.js';

const BRAND: MailBrand = { companyName: 'Company One', logoUrl: null };

/** A render of `message` with one text token `name` and one url token `link`. */
function render(overrides: Partial<RenderInput> = {}): ReturnType<typeof renderMail> {
  return renderMail({
    subject: 'Hello {name}',
    message: 'Hello {name}',
    values: { name: 'Sample Staff', link: 'https://example.test/sample-record' },
    urlTokens: new Set(['link']),
    locale: 'en',
    brand: BRAND,
    subjectPrefix: null,
    ...overrides,
  });
}

describe('escapeHtml', () => {
  it('escapes the five characters that open markup or an attribute', () => {
    expect(escapeHtml(`a & b < c > d " e ' f`)).toBe('a &amp; b &lt; c &gt; d &quot; e &#39; f');
  });
});

describe('substitute', () => {
  it('replaces a known token raw and leaves an unknown one as typed', () => {
    expect(substitute('Hi {name}, {other}', { name: '<b>' })).toBe('Hi <b>, {other}');
  });

  it('never reaches the prototype: {__proto__}, {constructor} and {tostring} stay as typed', () => {
    expect(substitute('{__proto__}', {})).toBe('{__proto__}');
    expect(substitute('{constructor} {tostring} {hasownproperty}', {})).toBe(
      '{constructor} {tostring} {hasownproperty}',
    );
  });
});

describe('unknownTokens', () => {
  it('lists the tokens outside the allowed set, distinct, in order of appearance', () => {
    expect(unknownTokens('{b} {name} {a} {b}', new Set(['name']))).toEqual(['b', 'a']);
    expect(unknownTokens('{name}', new Set(['name']))).toEqual([]);
  });
});

describe('cleanSubject', () => {
  it('turns CR, LF, TAB, NUL and DEL into spaces, collapses runs and trims (Pitfall 7)', () => {
    expect(cleanSubject('x\r\nBcc: a@example.test')).toBe('x Bcc: a@example.test');
    expect(cleanSubject(' a\tb\u0000c\u007fd ')).toBe('a b c d');
  });
});

describe('safeUrl', () => {
  it('admits http and https only', () => {
    expect(safeUrl('https://example.test/a')).toBe('https://example.test/a');
    expect(safeUrl('http://example.test/')).toBe('http://example.test/');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,x')).toBeNull();
    expect(safeUrl('example.test/relative')).toBeNull();
  });
});

describe('renderMail: escaping (T-4.3-02)', () => {
  it('a <script> value is text in the HTML part and verbatim in the text part', () => {
    const mail = render({ values: { name: '<script>alert(1)</script>' } });
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.html).not.toContain('<script');
    expect(mail.text).toContain('Hello <script>alert(1)</script>');
  });

  it('an attribute breakout value never produces markup or a bare quote', () => {
    const mail = render({ values: { name: '"><img src=x onerror=alert(1)>' } });
    expect(mail.html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(mail.html).not.toContain('<img');
    expect(mail.html).not.toContain('"><img');
  });

  it('wording typed by the administrator is escaped too', () => {
    const mail = render({ message: '<b>bold</b> {name}' });
    expect(mail.html).toContain('&lt;b&gt;bold&lt;/b&gt; Sample Staff');
    expect(mail.html).not.toContain('<b>');
  });

  it('{__proto__}, {constructor} and {tostring} stay as typed and escaped', () => {
    const mail = render({ message: '{__proto__} {constructor} {tostring} <i>', values: {} });
    expect(mail.html).toContain('{__proto__} {constructor} {tostring} &lt;i&gt;');
    expect(mail.text).toContain('{__proto__} {constructor} {tostring} <i>');
  });
});

describe('renderMail: url fields (T-4.3-10)', () => {
  it('an https value becomes one link with its query escaped', () => {
    const mail = render({
      message: 'See {link}',
      values: { link: 'https://example.test/a?b=1&c=2' },
    });
    expect(mail.html.split('<a ').length - 1).toBe(1);
    expect(mail.html).toContain('<a href="https://example.test/a?b=1&amp;c=2"');
    expect(mail.html).toContain('>https://example.test/a?b=1&amp;c=2</a>');
    expect(mail.text).toContain('See https://example.test/a?b=1&c=2');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x'])(
    '%s is escaped text, never a link',
    (url) => {
      const mail = render({ message: 'See {link}', values: { link: url } });
      expect(mail.html).not.toContain('<a');
      expect(mail.html).toContain(`See ${escapeHtml(url)}`);
    },
  );

  it('a text token holding a url stays text', () => {
    const mail = render({ message: '{name}', values: { name: 'https://example.test/' } });
    expect(mail.html).not.toContain('<a');
  });
});

describe('renderMail: subject', () => {
  it('a merge value with CR and LF cannot add a header line', () => {
    const mail = render({ values: { name: 'x\r\nBcc: a@example.test' } });
    expect(mail.subject).toBe('Hello x Bcc: a@example.test');
    expect(mail.subject).not.toMatch(/[\r\n]/u);
  });

  it('a TAB and NUL in the wording become spaces', () => {
    expect(render({ subject: 'a\tb\u0000c' }).subject).toBe('a b c');
  });

  it('the test prefix comes first, then a space', () => {
    expect(render({ subjectPrefix: '[Test]' }).subject).toBe('[Test] Hello Sample Staff');
    expect(render().subject).toBe('Hello Sample Staff');
  });
});

describe('renderMail: paragraphs and text part', () => {
  it('a blank line starts a new <p>, a single newline is <br>, CRLF counts as LF', () => {
    const mail = render({ message: 'One\r\nTwo\r\n \r\nThree' });
    expect(mail.html).toMatch(/<p style="[^"]*">One<br>Two<\/p><p style="[^"]*">Three<\/p>/u);
    expect(mail.text).toBe('One\nTwo\n \nThree\n\nCompany One');
  });

  it('the text part ends with a blank line and the company name', () => {
    expect(render().text).toBe('Hello Sample Staff\n\nCompany One');
  });
});

describe('layoutHtml', () => {
  const page = (locale: string, brand: MailBrand = BRAND): string =>
    layoutHtml({ bodyHtml: '<p>x</p>', locale, brand, title: 'T <1>' });

  it('ar is right to left, en left to right, on <html>', () => {
    expect(page('ar')).toContain('<html lang="ar" dir="rtl">');
    expect(page('en')).toContain('<html lang="en" dir="ltr">');
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('fr')).toBe('ltr');
    expect(RTL_LOCALES).toEqual(['ar']);
  });

  it('a logo is an <img> at most 48px high with the company name as alt', () => {
    const html = page('en', {
      companyName: 'Company One',
      logoUrl: 'http://localhost:8088/uploads/company/logo.png',
    });
    expect(html).toMatch(
      /<img src="http:\/\/localhost:8088\/uploads\/company\/logo.png" alt="Company One" style="[^"]*max-height:48px/u,
    );
  });

  it('no logo: the company name at 20px in the header; the footer names the company', () => {
    const html = page('en');
    expect(html).not.toContain('<img');
    expect(html).toMatch(/font-size:20px[^"]*">Company One</u);
    expect(html).toContain(`<p style="font-size:12px;color:${MAIL_COLOURS.muted};`);
    expect(html).toMatch(/<p style="font-size:12px[^"]*">Company One<\/p>/u);
  });

  it('the bar, the rule and the text use the email colours', () => {
    const html = page('en');
    expect(html).toContain(`height:4px;background:${MAIL_COLOURS.bar}`);
    expect(MAIL_COLOURS.bar).toBe(MAIL_COLOURS.text);
    expect(html).toContain(`border-top:1px solid ${MAIL_COLOURS.rule}`);
    expect(html).toContain(`color:${MAIL_COLOURS.text}`);
    expect(html).toContain('<title>T &lt;1&gt;</title>');
    expect(html).toContain('<p>x</p>');
  });

  it('a company name A & <B> is escaped in the header, the alt and the footer', () => {
    const name = 'A & <B>';
    expect(page('en', { companyName: name, logoUrl: null }).split('A &amp; &lt;B&gt;').length).toBe(
      3,
    );
    const withLogo = page('en', { companyName: name, logoUrl: 'https://example.test/l.png' });
    expect(withLogo).toContain('alt="A &amp; &lt;B&gt;"');
    expect(withLogo.split('A &amp; &lt;B&gt;').length).toBe(3);
    expect(withLogo).not.toContain('<B>');
  });
});
