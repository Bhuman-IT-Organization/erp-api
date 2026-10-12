import { describe, expect, it } from 'vitest';
import { isMailMessageKey, MAIL_MESSAGES, messageOf } from '../service/mail.messages.js';

/** D-06: the character is built, never typed. */
const LONG_DASH = String.fromCharCode(0x2014);

describe('MAIL_MESSAGES', () => {
  it('en and ar hold the same keys', () => {
    expect(Object.keys(MAIL_MESSAGES.ar).sort()).toEqual(Object.keys(MAIL_MESSAGES.en).sort());
  });

  it('no value holds U+2014 and none is empty', () => {
    for (const messages of Object.values(MAIL_MESSAGES)) {
      for (const value of Object.values(messages)) {
        expect(value).not.toContain(LONG_DASH);
        expect(value.trim()).not.toBe('');
      }
    }
  });

  it('the test prefix and the sample link are what the renderer expects', () => {
    expect(MAIL_MESSAGES.en.test_prefix).toBe('[Test]');
    expect(MAIL_MESSAGES.en.sample_link).toBe('https://example.test/sample-record');
  });
});

describe('messageOf', () => {
  it('answers the locale value, else English', () => {
    expect(messageOf('ar', 'sample_staff_name')).toBe(MAIL_MESSAGES.ar.sample_staff_name);
    expect(messageOf('fr', 'test_prefix')).toBe('[Test]');
    expect(messageOf('constructor', 'test_prefix')).toBe('[Test]');
  });
});

describe('isMailMessageKey', () => {
  it('knows the keys and nothing on the prototype', () => {
    expect(isMailMessageKey('test_prefix')).toBe(true);
    expect(isMailMessageKey('nope')).toBe(false);
    expect(isMailMessageKey('constructor')).toBe(false);
  });
});
