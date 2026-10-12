import { describe, expect, it } from 'vitest';
import { htmlToText } from '../service/html-to-text.js';

const NBSP = String.fromCharCode(0xa0);

describe('htmlToText', () => {
  it('paragraphs become blank-line separated text, with nothing dropped', () => {
    expect(htmlToText('<p>Line one</p><p>Line two</p>')).toEqual({
      text: 'Line one\n\nLine two',
      formattingDropped: false,
    });
    expect(htmlToText('<P class="x">A</P >')).toEqual({ text: 'A', formattingDropped: false });
  });

  it('<br> in any case, with or without a slash, is a newline', () => {
    expect(htmlToText('a<br>b<BR/>c<br />d')).toEqual({
      text: 'a\nb\nc\nd',
      formattingDropped: false,
    });
  });

  it('any other tag is removed and flags the dropped formatting', () => {
    expect(htmlToText('<strong>x</strong>')).toEqual({ text: 'x', formattingDropped: true });
    expect(htmlToText('<pre>x</pre>').formattingDropped).toBe(true);
  });

  it('decodes the common entities and numeric references', () => {
    expect(htmlToText('&amp;&lt;&gt;&quot;&#39;&nbsp;&#65;&#x42;').text).toBe(`&<>"'${NBSP}AB`);
  });

  it('decodes after removing tags, so an escaped tag stays text', () => {
    expect(htmlToText('&lt;b&gt;x&lt;/b&gt;')).toEqual({
      text: '<b>x</b>',
      formattingDropped: false,
    });
  });

  it('drops a reference outside Unicode; leaves an unknown entity as typed', () => {
    expect(htmlToText('a&#99999999;b&#x110000;c').text).toBe('abc');
    expect(htmlToText('a &copy; b').text).toBe('a &copy; b');
  });

  it('{tokens} pass through untouched', () => {
    expect(htmlToText('<p>Hello {staff_name}</p>').text).toBe('Hello {staff_name}');
  });

  it('CRLF is LF, five newlines collapse to two, line ends and the whole are trimmed', () => {
    expect(htmlToText('  a  \r\n\n\n\n\nb \n').text).toBe('a\n\nb');
  });
});
