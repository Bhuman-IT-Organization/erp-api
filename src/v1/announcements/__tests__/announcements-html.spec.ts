import { describe, expect, it } from 'vitest';
import {
  exceedsMessageLimit,
  htmlToText,
  MESSAGE_MAX_BYTES,
  textToHtml,
} from '../service/announcements-html.js';

describe('textToHtml', () => {
  it('escapes & < > " and the apostrophe', () => {
    expect(textToHtml('a < b & "c"')).toBe('<p>a &lt; b &amp; &quot;c&quot;</p>');
    expect(textToHtml("it's >")).toBe('<p>it&#39;s &gt;</p>');
  });

  it('turns typed markup into text, never into a tag', () => {
    expect(textToHtml('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });

  it('gives two lines one paragraph joined with <br>', () => {
    expect(textToHtml('one\ntwo')).toBe('<p>one<br>two</p>');
    expect(textToHtml('one\r\ntwo')).toBe('<p>one<br>two</p>');
  });

  it('gives a blank line two paragraphs', () => {
    expect(textToHtml('one\n\ntwo')).toBe('<p>one</p><p>two</p>');
    expect(textToHtml('one\n  \n\ntwo')).toBe('<p>one</p><p>two</p>');
  });

  it('keeps an empty message empty', () => {
    expect(textToHtml('')).toBe('');
    expect(textToHtml('  \n \n')).toBe('');
  });
});

describe('htmlToText', () => {
  it('turns <br> into a newline and </p> into a blank line', () => {
    expect(htmlToText('<p>one<br>two</p><p>three</p>')).toEqual({
      text: 'one\ntwo\n\nthree',
      hasOtherFormatting: false,
    });
  });

  it('decodes the entities once', () => {
    expect(htmlToText('<p>a &lt; b &amp; &quot;c&quot; &#39;d&#39; &#x41;</p>').text).toBe(
      'a < b & "c" \'d\' A',
    );
    expect(htmlToText('<p>&amp;lt;</p>').text).toBe('&lt;');
  });

  it('keeps an escaped tag as text and does not flag it', () => {
    expect(htmlToText('<p>&lt;b&gt;x&lt;/b&gt;</p>')).toEqual({
      text: '<b>x</b>',
      hasOtherFormatting: false,
    });
  });

  it('removes every other tag and flags it', () => {
    expect(htmlToText('<p><strong>Hi</strong></p>')).toEqual({
      text: 'Hi',
      hasOtherFormatting: true,
    });
    expect(htmlToText('<p>See <a href="https://x.test">this</a></p>')).toEqual({
      text: 'See this',
      hasOtherFormatting: true,
    });
    expect(htmlToText('<p style="color:red">Hi</p>').hasOtherFormatting).toBe(true);
  });

  it('reads Perfex HTML that has raw newlines between its tags', () => {
    expect(htmlToText('<p>one</p>\r\n<p>two</p>\r\n').text).toBe('one\n\ntwo');
  });

  it('answers empty text for an empty message', () => {
    expect(htmlToText('')).toEqual({ text: '', hasOtherFormatting: false });
  });
});

describe('text to HTML to text', () => {
  it.each([
    'plain',
    'one\ntwo',
    'one\n\ntwo',
    'a < b & "c"',
    "it's <b>not</b> bold &amp; stays",
    'first line\nsecond line\n\nnew paragraph\nwith two lines',
  ])('gives the same text back for %j', (text) => {
    expect(htmlToText(textToHtml(text))).toEqual({ text, hasOtherFormatting: false });
  });
});

describe('exceedsMessageLimit', () => {
  it('counts the bytes of the stored HTML, not the characters', () => {
    expect(exceedsMessageLimit('a'.repeat(MESSAGE_MAX_BYTES))).toBe(false);
    expect(exceedsMessageLimit('a'.repeat(MESSAGE_MAX_BYTES + 1))).toBe(true);
    // 'é' is two bytes: half as many characters already overflow
    expect(exceedsMessageLimit('é'.repeat(Math.floor(MESSAGE_MAX_BYTES / 2) + 1))).toBe(true);
  });

  it('counts the escaping: typed text under the cap can be over it as HTML', () => {
    const typed = '&'.repeat(Math.floor(MESSAGE_MAX_BYTES / 5));
    expect(exceedsMessageLimit(textToHtml(typed))).toBe(true);
  });
});
