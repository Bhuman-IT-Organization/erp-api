import { describe, expect, it } from 'vitest';
import { fromStoredHtml, toStoredHtml } from '../service/reply-html.js';

describe('reply-html', () => {
  it('escapes HTML-sensitive characters before storing', () => {
    expect(toStoredHtml(`<script>alert("x" & 'y')</script>`)).toBe(
      '<p>&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;</p>',
    );
  });

  it('wraps paragraphs and preserves single line breaks', () => {
    expect(toStoredHtml('First line\nsecond line\n\nNext paragraph')).toBe(
      '<p>First line<br>second line</p><p>Next paragraph</p>',
    );
  });

  it('round-trips plain text back from stored HTML', () => {
    const original = 'Hello <world>\nsecond line\n\nThank you & goodbye';
    expect(fromStoredHtml(toStoredHtml(original))).toEqual({
      text: original,
      hasOtherFormatting: false,
    });
  });

  it('flags legacy formatting such as bold text, lists, and links', () => {
    expect(fromStoredHtml('<p>Hello <strong>there</strong></p>').hasOtherFormatting).toBe(true);
    expect(fromStoredHtml('<ul><li>One</li></ul>').hasOtherFormatting).toBe(true);
    expect(fromStoredHtml('<p><a href="https://example.com">Link</a></p>').hasOtherFormatting).toBe(
      true,
    );
  });

  it('does not flag ordinary paragraphs and line breaks as other formatting', () => {
    expect(fromStoredHtml('<p>Hello<br>there</p>')).toEqual({
      text: 'Hello\nthere',
      hasOtherFormatting: false,
    });
  });
});
