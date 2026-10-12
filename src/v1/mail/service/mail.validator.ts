/**
 * Validator: the rules a template's wording obeys on every save, preview and test (04.3-UI-SPEC
 * § Template editor, the same rules as the web's zod schema). Every refusal is ONE
 * `ERP-VALIDATION-0001` listing every issue, each at `['versions', <locale>, <field>]` with a `rule`
 * the web maps to its own message; `message` is an English phrase for logs only (BE-09).
 *
 * - English is required: its subject and its message, non-blank.
 * - Any other locale is both or neither: one field filled and one empty is `version_pair`; both empty
 *   is the removal of that version (`null`).
 * - At most `MAIL_SUBJECT_MAX` and `MAIL_MESSAGE_MAX` characters.
 * - Every `{token}` is one of this template's merge fields (`unknown_merge_field`).
 * - No U+2014 (D-06, `long_dash`): nothing is replaced silently; seeded wording that holds it is
 *   kept as Perfex had it and cannot be saved until replaced.
 * - Only the deployment's supported locales (`unknown_locale`).
 *
 * `isRecipient` is the send's check of the address a template's resolver answers: one address that
 * fits the log's `recipient_email` column, else the send is skipped as `no_recipient`.
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../../../shared/config/legacy-locale.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { parseListQuery, type ListFilter, type ListSort } from '../../../shared/http/pagination.js';
import {
  MAIL_MODULE_MAX,
  MAIL_SENT_SEARCH_MAX,
  MAIL_TEMPLATES_SEARCH_MAX,
  mailDraftBodySchema,
  mailParamsSchema,
  moduleActiveBodySchema,
  templateActiveBodySchema,
  templateSaveBodySchema,
  type MailDraftBody,
  type MailParams,
  type ModuleActiveBody,
  type TemplateActiveBody,
  type TemplateSaveBody,
} from '../dto/mail.dto.js';
import {
  MAIL_MESSAGE_MAX,
  MAIL_SUBJECT_MAX,
  SENT_EMAIL_STATUSES,
  STATUS_TEST_FILTER,
  type SentEmailStatus,
} from '../model/mail.model.js';
import type {
  MailTemplateListRequest,
  MailTemplateSortField,
  SentEmailListRequest,
} from '../repository/mail.repository.js';
import { unknownTokens } from './mail.renderer.js';

export { MAIL_MESSAGE_MAX, MAIL_SUBJECT_MAX };

/** The deployment's locales, English first (`SUPPORTED_LOCALES`). */
export const MAIL_LOCALES: readonly string[] = SUPPORTED_LOCALES.map((s) => s.locale);
/** `tblmail_sent_emails.recipient_email` is VARCHAR(191). */
export const MAIL_RECIPIENT_MAX = 191;

const recipientSchema = z.email().max(MAIL_RECIPIENT_MAX);

/** D-06: U+2014 is built as `String.fromCharCode(0x2014)`, never typed; the magic-number rule names its code. */
const LONG_DASH_CODE = 0x2014;
const LONG_DASH = String.fromCharCode(LONG_DASH_CODE);

/** English is the required version; every other locale falls back to it. */
const ENGLISH = 'en';

export type MailIssueRule =
  'required' | 'too_long' | 'version_pair' | 'unknown_merge_field' | 'long_dash' | 'unknown_locale';

export interface MailIssue {
  readonly path: readonly string[];
  readonly message: string;
  readonly rule: MailIssueRule;
  readonly params?: Readonly<Record<string, string | number>>;
}

export type VersionDraft = { readonly subject: string; readonly message: string } | null;

type Field = 'subject' | 'message';
const FIELDS: readonly Field[] = ['subject', 'message'];
const MAX: Readonly<Record<Field, number>> = {
  subject: MAIL_SUBJECT_MAX,
  message: MAIL_MESSAGE_MAX,
};

const isBlank = (value: string): boolean => value.trim() === '';

/** `too_long`, `unknown_merge_field` (when `allowed` is given) and `long_dash` of one filled field. */
function contentIssues(
  path: readonly string[],
  field: Field,
  value: string,
  allowed: ReadonlySet<string> | null,
): MailIssue[] {
  const issues: MailIssue[] = [];
  const max = MAX[field];
  if (value.length > max) {
    issues.push({
      path,
      rule: 'too_long',
      message: `${field} is longer than ${String(max)} characters`,
      params: { max },
    });
  }
  const [unknown] = allowed === null ? [] : unknownTokens(value, allowed);
  if (unknown !== undefined) {
    issues.push({
      path,
      rule: 'unknown_merge_field',
      message: `${field} names an unknown merge field`,
      params: { token: unknown },
    });
  }
  if (value.includes(LONG_DASH)) {
    issues.push({ path, rule: 'long_dash', message: `${field} contains U+2014` });
  }
  return issues;
}

/** The issues of one version, field by field, in rule order. */
function versionIssues(
  locale: string,
  draft: VersionDraft,
  allowed: ReadonlySet<string>,
): MailIssue[] {
  const values = draft ?? { subject: '', message: '' };
  const english = locale === ENGLISH;
  const filled = FIELDS.filter((field) => !isBlank(values[field])).length;
  return FIELDS.flatMap((field) => {
    const path = ['versions', locale, field];
    if (isBlank(values[field])) {
      if (english) return [{ path, rule: 'required' as const, message: `${field} is required` }];
      return filled === 1
        ? [
            {
              path,
              rule: 'version_pair' as const,
              message: `${field} is empty while the other field is filled`,
            },
          ]
        : [];
    }
    return contentIssues(path, field, values[field], allowed);
  });
}

function refuse(issues: readonly MailIssue[]): void {
  if (issues.length > 0)
    throw new AppError('ERP-VALIDATION-0001', 'Template is invalid', { issues });
}

// --- the screens' queries, params and bodies (plan 04.3-07) ---------------------------------------

/** What `?filter[...]` and `?sort=` of the template list may name; the sort takes the first two only. */
const TEMPLATE_LIST_FIELDS = ['module', 'key', 'translation', 'active'] as const;
type TemplateListField = (typeof TEMPLATE_LIST_FIELDS)[number];
const TEMPLATE_SORT_FIELDS: readonly string[] = ['module', 'key'] satisfies MailTemplateSortField[];

/** What `?filter[...]` and `?sort=` of the sent-email log may name; the sort takes `queuedAt` only. */
const SENT_LIST_FIELDS = ['queuedAt', 'template', 'status'] as const;
type SentListField = (typeof SENT_LIST_FIELDS)[number];
const SENT_SORT_FIELD = 'queuedAt';

/** A template key is the registry's grammar, at most 100 characters. */
const TEMPLATE_KEY = /^[a-z][a-z0-9_]{0,99}$/u;
const ACTIVE_VALUES: Readonly<Record<string, boolean>> = { '1': true, '0': false };
const TRANSLATION_VALUES = ['complete', 'missing'] as const;

/** A date filter: an ISO date-time WITH an offset, so the day boundary is the browser's, never the server's. */
const instantSchema = z.iso.datetime({ offset: true });

function refuseQuery(path: readonly string[], message: string): never {
  throw new AppError('ERP-VALIDATION-0001', 'Query is invalid', {
    issues: [{ path: [...path], message }],
  });
}

/** `safeParse` to `ERP-VALIDATION-0001` with the zod issues (BE-09). */
function parseWith<T>(schema: z.ZodType<T>, input: unknown, detail: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('ERP-VALIDATION-0001', detail, { issues: parsed.error.issues });
  }
  return parsed.data;
}

/** `?q=`: the last value, at most `max` characters; an empty one is no search. */
function searchOf(input: unknown, max: number): string | null {
  const raw =
    typeof input === 'object' && input !== null ? (input as { q?: unknown }).q : undefined;
  const search: unknown = Array.isArray(raw) ? raw.at(-1) : raw;
  if (typeof search !== 'string' || search === '') return null;
  if (search.length > max) refuseQuery(['q'], `q must be at most ${String(max)} characters`);
  return search;
}

/** One sort segment out of `allowed`, or the default; two segments or another field are a 400. */
function oneSort<T extends string>(
  sort: readonly ListSort<T>[],
  allowed: readonly string[],
): ListSort<T> | undefined {
  if (sort.length > 1) refuseQuery(['sort'], 'the list sorts on one field at a time');
  const [first] = sort;
  if (first !== undefined && !allowed.includes(first.field)) {
    refuseQuery(['sort'], `the list cannot sort on "${first.field}"`);
  }
  return first;
}

/** Each value of an `in` filter must pass `ok`, else a 400 naming the filter. */
function listOf(filter: ListFilter<string>, ok: (value: string) => boolean): string[] {
  const values = typeof filter.value === 'string' ? [filter.value] : [...filter.value];
  if (!values.every(ok)) {
    refuseQuery(
      ['filter', filter.field, filter.op],
      `filter[${filter.field}] has a value it does not take`,
    );
  }
  return values;
}

/** The value of an `eq` filter, which must be one of `allowed`. */
function oneOf<T extends string>(filter: ListFilter<string>, allowed: readonly T[]): T {
  const value = typeof filter.value === 'string' ? filter.value : '';
  if (!(allowed as readonly string[]).includes(value)) {
    refuseQuery(
      ['filter', filter.field, filter.op],
      `filter[${filter.field}] has a value it does not take`,
    );
  }
  return value as T;
}

function unsupported(filter: ListFilter<string>): never {
  return refuseQuery(
    ['filter', filter.field, filter.op],
    `filter[${filter.field}] does not take ${filter.op}`,
  );
}

type TemplateFilters = Pick<MailTemplateListRequest, 'modules' | 'translation' | 'active'>;

function templateFilters(filters: readonly ListFilter<TemplateListField>[]): TemplateFilters {
  let result: TemplateFilters = { modules: [], translation: null, active: null };
  for (const filter of filters) {
    const at = `${filter.field}:${filter.op}`;
    if (at === 'module:in') {
      result = { ...result, modules: listOf(filter, (value) => value.length <= MAIL_MODULE_MAX) };
    } else if (at === 'translation:eq') {
      result = { ...result, translation: oneOf(filter, TRANSLATION_VALUES) };
    } else if (at === 'active:eq') {
      result = { ...result, active: ACTIVE_VALUES[oneOf(filter, ['1', '0'])] ?? null };
    } else {
      unsupported(filter);
    }
  }
  return result;
}

type SentFilters = Pick<SentEmailListRequest, 'templates' | 'statuses' | 'queuedFrom' | 'queuedTo'>;

const isTemplateFilterValue = (value: string): boolean =>
  value === STATUS_TEST_FILTER || TEMPLATE_KEY.test(value);
const isStatus = (value: string): value is SentEmailStatus =>
  (SENT_EMAIL_STATUSES as readonly string[]).includes(value);

/** The instant of a `queuedAt` bound. */
function instantOf(filter: ListFilter<string>): Date {
  const value = typeof filter.value === 'string' ? filter.value : '';
  if (!instantSchema.safeParse(value).success) {
    refuseQuery(
      ['filter', filter.field, filter.op],
      'filter[queuedAt] takes an ISO date-time with an offset',
    );
  }
  return new Date(value);
}

function sentFilters(filters: readonly ListFilter<SentListField>[]): SentFilters {
  let result: SentFilters = { templates: [], statuses: [], queuedFrom: null, queuedTo: null };
  for (const filter of filters) {
    const at = `${filter.field}:${filter.op}`;
    if (at === 'template:in') {
      result = { ...result, templates: listOf(filter, isTemplateFilterValue) };
    } else if (at === 'status:in') {
      result = { ...result, statuses: listOf(filter, isStatus).filter(isStatus) };
    } else if (at === 'queuedAt:gte') {
      result = { ...result, queuedFrom: instantOf(filter) };
    } else if (at === 'queuedAt:lte') {
      result = { ...result, queuedTo: instantOf(filter) };
    } else {
      unsupported(filter);
    }
  }
  return result;
}

@Injectable()
export class MailValidator {
  /** `GET templates`: BE-19's grammar, one keyset sort (`module` by default), three filters, `q`. */
  parseTemplateList(input: unknown): MailTemplateListRequest {
    const query = parseListQuery(input, TEMPLATE_LIST_FIELDS);
    const filters = templateFilters(query.filters);
    const sort = oneSort(query.sort, TEMPLATE_SORT_FIELDS);
    const sortField = (sort?.field ?? 'module') as MailTemplateSortField;
    const cursor = decodeCursor(query.cursor, sortField);
    if (cursor !== null && typeof cursor.key[0] !== 'string') {
      refuseQuery(['cursor'], 'cursor is not a cursor of this list');
    }
    return {
      sortField,
      order: sort?.direction ?? 'asc',
      cursor,
      limit: query.limit,
      search: searchOf(input, MAIL_TEMPLATES_SEARCH_MAX),
      ...filters,
      locales: MAIL_LOCALES,
    };
  }

  /** `GET sent-emails`: newest first by default, four filters, `q` a recipient prefix. */
  parseSentList(input: unknown): SentEmailListRequest {
    const query = parseListQuery(input, SENT_LIST_FIELDS);
    const filters = sentFilters(query.filters);
    const sort = oneSort(query.sort, [SENT_SORT_FIELD]);
    const cursor = decodeCursor(query.cursor, SENT_SORT_FIELD);
    if (cursor !== null && typeof cursor.key[0] !== 'string') {
      refuseQuery(['cursor'], 'cursor is not a cursor of this list');
    }
    return {
      order: sort?.direction ?? 'desc',
      cursor,
      limit: query.limit,
      recipientPrefix: searchOf(input, MAIL_SENT_SEARCH_MAX),
      ...filters,
    };
  }

  /** `:id`: a non-numeric or non-positive id is a 400, never a 404 probe. */
  params(input: unknown): MailParams {
    return parseWith(mailParamsSchema, input, 'Path parameter is invalid');
  }

  /** `PATCH templates/:id`: strict; the wording rules are `versions`. */
  templateSave(input: unknown): TemplateSaveBody {
    return parseWith(templateSaveBodySchema, input, 'Request body is invalid');
  }

  templateActive(input: unknown): TemplateActiveBody {
    return parseWith(templateActiveBodySchema, input, 'Request body is invalid');
  }

  moduleActive(input: unknown): ModuleActiveBody {
    return parseWith(moduleActiveBodySchema, input, 'Request body is invalid');
  }

  /** A preview or test draft: strict, so no address can ride along (T-4.3-03). */
  draftBody(input: unknown): MailDraftBody {
    return parseWith(mailDraftBodySchema, input, 'Request body is invalid');
  }

  /**
   * The versions of a save. Normalises a non-English version whose subject and message are both empty
   * to `null` (its removal); throws `ERP-VALIDATION-0001` listing EVERY issue. `allowed` is the
   * template's merge-field tokens; `locales` the supported locales, English first.
   */
  versions(
    input: Readonly<Record<string, VersionDraft>>,
    allowed: ReadonlySet<string>,
    locales: readonly string[],
  ): Readonly<Record<string, VersionDraft>> {
    const keys = [ENGLISH, ...Object.keys(input).filter((locale) => locale !== ENGLISH)];
    const issues: MailIssue[] = [];
    const unknownLocales: MailIssue[] = [];
    const result: Record<string, VersionDraft> = {};
    for (const locale of keys) {
      const draft = Object.hasOwn(input, locale) ? (input[locale] ?? null) : null;
      if (!locales.includes(locale)) {
        unknownLocales.push({
          path: ['versions', locale],
          rule: 'unknown_locale',
          message: 'locale is not supported',
        });
        continue;
      }
      issues.push(...versionIssues(locale, draft, allowed));
      const empty = draft === null || (isBlank(draft.subject) && isBlank(draft.message));
      result[locale] = locale !== ENGLISH && empty ? null : draft;
    }
    refuse([...issues, ...unknownLocales]);
    return result;
  }

  /** Preview and test drafts: lengths and the locale only (an unknown token stays as typed, UI-SPEC § Preview). */
  draft(locale: string, subject: string, message: string, locales: readonly string[]): void {
    const issues: MailIssue[] = [];
    if (!locales.includes(locale)) {
      issues.push({ path: ['locale'], rule: 'unknown_locale', message: 'locale is not supported' });
    }
    for (const [field, value] of [
      ['subject', subject],
      ['message', message],
    ] as const) {
      if (value.length > MAX[field]) {
        issues.push({
          path: [field],
          rule: 'too_long',
          message: `${field} is longer than ${String(MAX[field])} characters`,
          params: { max: MAX[field] },
        });
      }
    }
    refuse(issues);
  }

  /** One email address of at most `MAIL_RECIPIENT_MAX` characters. */
  isRecipient(value: string): boolean {
    return recipientSchema.safeParse(value).success;
  }
}
