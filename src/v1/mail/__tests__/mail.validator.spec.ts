import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import {
  MAIL_MESSAGE_MAX,
  MAIL_SUBJECT_MAX,
  MailValidator,
  type MailIssue,
  type VersionDraft,
} from '../service/mail.validator.js';

/** D-06: the character is built, never typed. */
const LONG_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

const LOCALES = ['en', 'ar'] as const;
const ALLOWED = new Set(['staff_name', 'link']);
const validator = new MailValidator();
const OK = { subject: 'Hello {staff_name}', message: 'See {link}' };

/** The issues of a refused call (the one validation code, every issue together). */
function issuesOf(call: () => unknown): MailIssue[] {
  try {
    call();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('ERP-VALIDATION-0001');
    return (error as AppError).extras?.issues as MailIssue[];
  }
  throw new Error('expected a refusal');
}

const versions = (input: Readonly<Record<string, VersionDraft>>): MailIssue[] =>
  issuesOf(() => validator.versions(input, ALLOWED, LOCALES));

describe('MailValidator.versions', () => {
  it('passes a valid English version and answers it unchanged', () => {
    expect(validator.versions({ en: OK }, ALLOWED, LOCALES)).toEqual({ en: OK });
  });

  it('English subject empty or message blank is required', () => {
    expect(versions({ en: { subject: '', message: 'x' } })).toEqual([
      expect.objectContaining({ path: ['versions', 'en', 'subject'], rule: 'required' }),
    ]);
    expect(versions({ en: { subject: 'x', message: '   ' } })).toEqual([
      expect.objectContaining({ path: ['versions', 'en', 'message'], rule: 'required' }),
    ]);
  });

  it('English null or absent is required on both fields', () => {
    expect(versions({ en: null }).map((issue) => issue.path)).toEqual([
      ['versions', 'en', 'subject'],
      ['versions', 'en', 'message'],
    ]);
    expect(versions({ ar: OK }).map((issue) => issue.rule)).toEqual(['required', 'required']);
  });

  it('a non-English version with one field empty is a version_pair on the empty one', () => {
    expect(versions({ en: OK, ar: { subject: 'x', message: '' } })).toEqual([
      expect.objectContaining({ path: ['versions', 'ar', 'message'], rule: 'version_pair' }),
    ]);
  });

  it('a non-English version with both empty is removal (null), with no issue', () => {
    expect(
      validator.versions({ en: OK, ar: { subject: ' ', message: '' } }, ALLOWED, LOCALES),
    ).toEqual({ en: OK, ar: null });
    expect(validator.versions({ en: OK, ar: null }, ALLOWED, LOCALES)).toEqual({
      en: OK,
      ar: null,
    });
  });

  it('a subject over 255 and a message over 20,000 characters are too_long with the max', () => {
    expect(MAIL_SUBJECT_MAX).toBe(255);
    expect(MAIL_MESSAGE_MAX).toBe(20_000);
    expect(versions({ en: { subject: 'a'.repeat(256), message: 'b'.repeat(20_001) } })).toEqual([
      expect.objectContaining({
        path: ['versions', 'en', 'subject'],
        rule: 'too_long',
        params: { max: 255 },
      }),
      expect.objectContaining({
        path: ['versions', 'en', 'message'],
        rule: 'too_long',
        params: { max: 20_000 },
      }),
    ]);
    expect(
      validator.versions(
        { en: { subject: 'a'.repeat(255), message: 'b'.repeat(20_000) } },
        ALLOWED,
        LOCALES,
      ),
    ).toBeDefined();
  });

  it('an unknown token is unknown_merge_field naming the first one; a known token passes', () => {
    expect(
      versions({ en: { subject: 'Hello {staff_nam} {other}', message: '{staff_name}' } }),
    ).toEqual([
      expect.objectContaining({
        path: ['versions', 'en', 'subject'],
        rule: 'unknown_merge_field',
        params: { token: 'staff_nam' },
      }),
    ]);
  });

  it('U+2014 is long_dash; a hyphen and an en dash pass', () => {
    expect(versions({ en: { subject: `a ${LONG_DASH} b`, message: 'x' } })).toEqual([
      expect.objectContaining({ path: ['versions', 'en', 'subject'], rule: 'long_dash' }),
    ]);
    expect(
      validator.versions({ en: { subject: `a - b ${EN_DASH} c`, message: 'x' } }, ALLOWED, LOCALES),
    ).toBeDefined();
  });

  it('a locale the deployment does not support is unknown_locale at the version', () => {
    expect(versions({ en: OK, fr: OK })).toEqual([
      expect.objectContaining({ path: ['versions', 'fr'], rule: 'unknown_locale' }),
    ]);
  });

  it('lists every issue of one call together, one per rule per field, in rule order', () => {
    const issues = versions({
      en: { subject: `${'a'.repeat(256)} {nope} ${LONG_DASH}`, message: '' },
      ar: { subject: '', message: `x ${LONG_DASH}` },
      fr: OK,
    });
    expect(issues.map((issue) => [issue.path.join('.'), issue.rule])).toEqual([
      ['versions.en.subject', 'too_long'],
      ['versions.en.subject', 'unknown_merge_field'],
      ['versions.en.subject', 'long_dash'],
      ['versions.en.message', 'required'],
      ['versions.ar.subject', 'version_pair'],
      ['versions.ar.message', 'long_dash'],
      ['versions.fr', 'unknown_locale'],
    ]);
    for (const issue of issues) expect(issue.message).not.toBe('');
  });
});

describe('MailValidator.draft', () => {
  it('passes an unknown token (the preview shows it as typed)', () => {
    expect(() => {
      validator.draft('en', 'Hello {nope}', 'x {nope}', LOCALES);
    }).not.toThrow();
  });

  it('refuses a subject over 255, a message over 20,000 and a locale outside the deployment', () => {
    const issues = issuesOf(() => {
      validator.draft('fr', 'a'.repeat(256), 'b'.repeat(20_001), LOCALES);
    });
    expect(issues.map((issue) => [issue.path.join('.'), issue.rule])).toEqual([
      ['locale', 'unknown_locale'],
      ['subject', 'too_long'],
      ['message', 'too_long'],
    ]);
  });
});

describe('MailValidator.isRecipient (04.3-06: the address a resolver answers)', () => {
  it('admits one address up to the 191-character log column, nothing else', () => {
    expect(validator.isRecipient('user@example.test')).toBe(true);
    expect(validator.isRecipient('not an address')).toBe(false);
    expect(validator.isRecipient('a@example.test, b@example.test')).toBe(false);
    expect(validator.isRecipient('')).toBe(false);
    const of = (length: number) =>
      `${'a'.repeat(64)}@${'b'.repeat(50)}.${'c'.repeat(50)}.${'d'.repeat(length - 172)}.test`;
    expect(of(191)).toHaveLength(191);
    expect(validator.isRecipient(of(191))).toBe(true);
    expect(validator.isRecipient(of(192))).toBe(false);
  });
});

/** The first issue's path of a refusal (04.3-07: the screens' queries, params and bodies). */
function refusedOn(call: () => unknown): unknown {
  try {
    call();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('ERP-VALIDATION-0001');
    return ((error as AppError).extras?.issues as readonly { path: readonly unknown[] }[])[0]?.path;
  }
  throw new Error('expected a refusal');
}

describe('MailValidator.parseTemplateList (04.3-07)', () => {
  it('defaults to module ascending, 50 rows, no filter, the supported locales', () => {
    expect(validator.parseTemplateList({})).toEqual({
      sortField: 'module',
      order: 'asc',
      cursor: null,
      limit: 50,
      search: null,
      modules: [],
      translation: null,
      active: null,
      locales: ['en', 'ar'],
    });
  });

  it('parses the module, translation and active filters, a descending key sort and q', () => {
    expect(
      validator.parseTemplateList({
        'filter[module][in]': 'a,b',
        'filter[translation][eq]': 'missing',
        'filter[active][eq]': '0',
        sort: '-key',
        q: 'notice',
      }),
    ).toMatchObject({
      sortField: 'key',
      order: 'desc',
      modules: ['a', 'b'],
      translation: 'missing',
      active: false,
      search: 'notice',
    });
    expect(validator.parseTemplateList({ 'filter[active][eq]': '1' }).active).toBe(true);
  });

  it('refuses an unknown value, field or operator, offset paging, a filter used as a sort and a long q, naming the key', () => {
    const list = (query: Record<string, string>) => () => validator.parseTemplateList(query);
    expect(refusedOn(list({ 'filter[translation][eq]': 'x' }))).toEqual([
      'filter',
      'translation',
      'eq',
    ]);
    expect(refusedOn(list({ 'filter[name][eq]': 'y' }))).toEqual(['filter', 'name', 'eq']);
    expect(refusedOn(list({ 'filter[active][in]': '1' }))).toEqual(['filter', 'active', 'in']);
    expect(refusedOn(list({ 'filter[active][eq]': 'yes' }))).toEqual(['filter', 'active', 'eq']);
    expect(refusedOn(list({ page: '2' }))).toEqual(['page']);
    expect(refusedOn(list({ sort: 'translation' }))).toEqual(['sort']);
    expect(refusedOn(list({ q: 'q'.repeat(101) }))).toEqual(['q']);
  });
});

describe('MailValidator.parseSentList (04.3-07)', () => {
  it('defaults to newest first, 50 rows, no filter', () => {
    expect(validator.parseSentList({})).toEqual({
      order: 'desc',
      cursor: null,
      limit: 50,
      recipientPrefix: null,
      templates: [],
      statuses: [],
      queuedFrom: null,
      queuedTo: null,
    });
  });

  it('parses the template (keys and status-test), status and date filters, an ascending sort and q', () => {
    expect(
      validator.parseSentList({
        'filter[template][in]': 'zz_a,status-test',
        'filter[status][in]': 'failed,sent',
        'filter[queuedAt][gte]': '2026-10-01T00:00:00+07:00',
        'filter[queuedAt][lte]': '2026-10-01T23:59:59.999+07:00',
        sort: 'queuedAt',
        q: 'user@',
      }),
    ).toEqual({
      order: 'asc',
      cursor: null,
      limit: 50,
      recipientPrefix: 'user@',
      templates: ['zz_a', 'status-test'],
      statuses: ['failed', 'sent'],
      queuedFrom: new Date('2026-09-30T17:00:00.000Z'),
      queuedTo: new Date('2026-10-01T16:59:59.999Z'),
    });
  });

  it('refuses a date without a time or an offset, an unknown status or template value and a q over 191', () => {
    const list = (query: Record<string, string>) => () => validator.parseSentList(query);
    const gte = ['filter', 'queuedAt', 'gte'];
    expect(refusedOn(list({ 'filter[queuedAt][gte]': '2026-10-01' }))).toEqual(gte);
    expect(refusedOn(list({ 'filter[queuedAt][gte]': '2026-10-01T00:00:00' }))).toEqual(gte);
    expect(refusedOn(list({ 'filter[status][in]': 'sent,lost' }))).toEqual([
      'filter',
      'status',
      'in',
    ]);
    expect(refusedOn(list({ 'filter[template][in]': 'Bad Key' }))).toEqual([
      'filter',
      'template',
      'in',
    ]);
    expect(refusedOn(list({ 'filter[status][eq]': 'sent' }))).toEqual(['filter', 'status', 'eq']);
    expect(refusedOn(list({ q: 'q'.repeat(192) }))).toEqual(['q']);
    expect(refusedOn(list({ sort: 'status' }))).toEqual(['sort']);
  });
});

describe('MailValidator params and bodies (04.3-07)', () => {
  it('reads a positive integer id; anything else is a 400 on id', () => {
    expect(validator.params({ id: '12' })).toEqual({ id: 12 });
    expect(refusedOn(() => validator.params({ id: 'x' }))).toEqual(['id']);
    expect(refusedOn(() => validator.params({ id: '0' }))).toEqual(['id']);
  });

  it('bodies are strict: an address field is refused, never ignored (T-4.3-03)', () => {
    const draft = { locale: 'en', subject: 's', message: 'm' };
    expect(validator.draftBody(draft)).toEqual(draft);
    for (const key of ['to', 'recipient', 'email']) {
      expect(refusedOn(() => validator.draftBody({ ...draft, [key]: 'x@example.test' }))).toEqual(
        [],
      );
    }
    expect(validator.templateActive({ active: false })).toEqual({ active: false });
    expect(refusedOn(() => validator.templateActive({ active: 'no' }))).toEqual(['active']);
    expect(validator.moduleActive({ module: 'zz_mod_a', active: true })).toEqual({
      module: 'zz_mod_a',
      active: true,
    });
    expect(refusedOn(() => validator.moduleActive({ module: '', active: true }))).toEqual([
      'module',
    ]);
    const save = { active: true, versions: { en: { subject: 's', message: 'm' }, ar: null } };
    expect(validator.templateSave(save)).toEqual(save);
    expect(refusedOn(() => validator.templateSave({ ...save, key: 'x' }))).toEqual([]);
  });
});
