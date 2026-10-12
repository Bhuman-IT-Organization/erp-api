import { describe, expect, it } from 'vitest';
import {
  attachmentsProblem,
  MAIL_ATTACHMENTS_MAX,
  MailTemplateRegistry,
  type MailAttachment,
  type MailTemplateDefinition,
} from '../service/mail-template.registry.js';
import { TEST_DEFINITION } from './fakes.js';

/** `TEST_DEFINITION` with one part changed, including what the type forbids. */
const broken = (patch: Record<string, unknown>): MailTemplateDefinition => ({
  ...TEST_DEFINITION,
  ...patch,
});

describe('MailTemplateRegistry', () => {
  it('registers a definition: get answers it and keys lists it, sorted', () => {
    const registry = new MailTemplateRegistry();
    registry.register(TEST_DEFINITION);
    registry.register({ ...TEST_DEFINITION, key: 'aa_first' });
    expect(registry.get('zz_test_notice')).toBe(TEST_DEFINITION);
    expect(registry.get('absent')).toBeUndefined();
    expect(registry.get('constructor')).toBeUndefined();
    expect(registry.keys()).toEqual(['aa_first', 'zz_test_notice']);
  });

  it('refuses a second registration of the same key', () => {
    const registry = new MailTemplateRegistry();
    registry.register(TEST_DEFINITION);
    expect(() => {
      registry.register(TEST_DEFINITION);
    }).toThrow('mail template zz_test_notice is already registered');
  });

  it.each([
    ['a key Bad-Key', { key: 'Bad-Key' }, 'key'],
    ['a key over 100 characters', { key: `a${'b'.repeat(100)}` }, 'key'],
    ['a module x y', { module: 'x y' }, 'module'],
    ['a module over 64 characters', { module: `a${'b'.repeat(64)}` }, 'module'],
    ['an unknown audience', { audience: 'everyone' }, 'audience'],
    [
      'a duplicate token',
      {
        mergeFields: [
          { token: 'staff_name', kind: 'text', sampleKey: 'sample_staff_name' },
          { token: 'staff_name', kind: 'text', sampleKey: 'sample_staff_name' },
        ],
      },
      'staff_name',
    ],
    [
      'a token Name',
      { mergeFields: [{ token: 'Name', kind: 'text', sampleKey: 'sample_staff_name' }] },
      'Name',
    ],
    [
      'a kind html',
      { mergeFields: [{ token: 'x', kind: 'html', sampleKey: 'sample_staff_name' }] },
      'x',
    ],
    [
      'a sample key the messages lack',
      { mergeFields: [{ token: 'x', kind: 'text', sampleKey: 'sample_nope' }] },
      'sample_nope',
    ],
    [
      'a fallback key the messages lack',
      { fallback: { subjectKey: 'nope', messageKey: 'status_test_message' } },
      'nope',
    ],
  ])('refuses %s, naming the problem', (_label, patch, named) => {
    const registry = new MailTemplateRegistry();
    expect(() => {
      registry.register(broken(patch));
    }).toThrow(named);
    expect(registry.keys()).toEqual([]);
  });

  it('admits a legacySlug Perfex names with a hyphen', () => {
    const registry = new MailTemplateRegistry();
    registry.register({ ...TEST_DEFINITION, legacySlug: 'staff-forgot-password' });
    expect(registry.get('zz_test_notice')?.legacySlug).toBe('staff-forgot-password');
  });

  it.each([
    ['a legacySlug Bad Slug', 'Bad Slug'],
    ['a legacySlug over 100 characters', `a${'b'.repeat(100)}`],
    ['an empty legacySlug', ''],
  ])('refuses %s', (_label, legacySlug) => {
    const registry = new MailTemplateRegistry();
    expect(() => {
      registry.register({ ...TEST_DEFINITION, legacySlug });
    }).toThrow('legacySlug');
    expect(registry.keys()).toEqual([]);
  });

  it('refuses a legacySlug another definition already seeds from', () => {
    const registry = new MailTemplateRegistry();
    registry.register({ ...TEST_DEFINITION, legacySlug: 'shared-slug' });
    expect(() => {
      registry.register({ ...TEST_DEFINITION, key: 'zz_other', legacySlug: 'shared-slug' });
    }).toThrow('legacySlug shared-slug');
    expect(registry.keys()).toEqual(['zz_test_notice']);
  });
});

/** A valid attachment: a generated storage key, a plain name, a lower-case type. */
const FILE: MailAttachment = {
  storageKey: 'zz-tests/2026/10/0b5d3c8e-6a1f-4c2b-9d7e-1f2a3b4c5d6e',
  fileName: 'notes.txt',
  contentType: 'text/plain',
};

describe('attachmentsProblem (ADR-0052)', () => {
  it('answers null for none and for valid attachments', () => {
    expect(attachmentsProblem([])).toBeNull();
    expect(attachmentsProblem([FILE])).toBeNull();
    expect(
      attachmentsProblem([
        FILE,
        { ...FILE, fileName: 'Monthly report.pdf', contentType: 'application/pdf' },
      ]),
    ).toBeNull();
  });

  it.each([
    ['six files', Array.from({ length: MAIL_ATTACHMENTS_MAX + 1 }, () => FILE)],
    ['a key outside STORAGE_KEY', [{ ...FILE, storageKey: '../etc/passwd' }]],
    ['a key with a path', [{ ...FILE, storageKey: '/var/files/zz-tests/2026/10/x' }]],
    ['a name with /', [{ ...FILE, fileName: 'a/b.txt' }]],
    ['a name with a backslash', [{ ...FILE, fileName: 'a\\b.txt' }]],
    ['a name with a control character', [{ ...FILE, fileName: 'a\u0007b.txt' }]],
    ['a name with a line feed', [{ ...FILE, fileName: 'a\nb.txt' }]],
    ['an empty name', [{ ...FILE, fileName: '' }]],
    ['a 256-character name', [{ ...FILE, fileName: 'a'.repeat(256) }]],
    ['a type Text/Plain', [{ ...FILE, contentType: 'Text/Plain' }]],
    ['a type text', [{ ...FILE, contentType: 'text' }]],
  ])('names a problem for %s', (_label, list) => {
    expect(attachmentsProblem(list)).toEqual(expect.any(String));
  });

  it('admits a 255-character name', () => {
    expect(attachmentsProblem([{ ...FILE, fileName: 'a'.repeat(255) }])).toBeNull();
  });
});
