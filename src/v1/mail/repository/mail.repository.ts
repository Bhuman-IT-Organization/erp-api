/**
 * Repository: the mail module's data seam (BE-08) and the only file here that touches Prisma (DB-04).
 *
 * Owner of the three tables it writes (ADR-0029; `ownership-node.json`, ADR-0035; DDL
 * `prisma/sql/0004-mail.sql`, ADR-0036):
 *   `tblmail_templates`           one row per template key; Active, the formatting notice, who saved.
 *   `tblmail_template_versions`   one subject and message per template and locale.
 *   `tblmail_sent_emails`         the sent-email log: never a subject, a body or a merge value (D-05).
 * Every read and write goes through the typed delegates, which the ownership guard admits because
 * the register names `node`. The one raw statement is the template save's row lock, a tagged
 * `$executeRaw` with the id bound (`UPDATE tblmail_templates SET id = id WHERE id = ?`), admitted
 * as a raw write on a node-owned table.
 *
 * Read only, never written (DB-03):
 *   `tblemailtemplates`           Perfex's own templates, read once per key to seed one (D-03).
 * Perfex's `tblmail_queue` is never read.
 *
 * Every row is re-parsed through its zod schema (BE-11): a `failure_reason` outside
 * `MAIL_FAILURE_REASONS` reads as `unknown`, a `status` outside `SENT_EMAIL_STATUSES` fails the
 * parse. Search terms and filter values are bound values, never SQL text.
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService, type ExtendedPrismaClient } from '../../../shared/db/prisma.service.js';
import {
  encodeCursor,
  keysetWhere,
  type DecodedCursor,
  type KeyValue,
  type ListPageMeta,
} from '../../../shared/http/keyset.js';
import {
  MAIL_FAILURE_REASONS,
  SENT_EMAIL_STATUSES,
  STATUS_TEST_FILTER,
  type MailFailureReason,
  type MailTemplate,
  type MailTemplateListItem,
  type MailTemplatePage,
  type MailTemplateVersion,
  type NewSentEmail,
  type PerfexTemplateRow,
  type SentEmail,
  type SentEmailPage,
  type SentEmailStatus,
} from '../model/mail.model.js';

export type MailTemplateSortField = 'module' | 'key';

export interface MailTemplateListRequest {
  readonly sortField: MailTemplateSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<MailTemplateSortField> | null;
  readonly limit: number;
  /** Contains, over `template_key` or any version's subject. */
  readonly search: string | null;
  /** `[]` = any module. */
  readonly modules: readonly string[];
  /** `complete`: a version for every locale in `locales`; `missing`: at least one absent. */
  readonly translation: 'complete' | 'missing' | null;
  readonly active: boolean | null;
  /** The supported locales, en first. */
  readonly locales: readonly string[];
}

export interface SentEmailListRequest {
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<'queuedAt'> | null;
  readonly limit: number;
  /** startsWith on `recipient_email`. */
  readonly recipientPrefix: string | null;
  /** Template keys; `STATUS_TEST_FILTER` matches `template_key` NULL. */
  readonly templates: readonly string[];
  readonly statuses: readonly SentEmailStatus[];
  /** Inclusive bounds on `queued_at`. */
  readonly queuedFrom: Date | null;
  readonly queuedTo: Date | null;
}

export interface TemplateChange {
  readonly active: boolean;
  /** `null`: remove that locale. */
  readonly versions: Readonly<
    Record<string, { readonly subject: string; readonly message: string } | null>
  >;
  readonly staffId: number;
}

/**
 * The client an interactive `$transaction` hands its callback (the identity.repository.ts form).
 * Declared here because `repository/` is the only place allowed to name a Prisma type (BE-08).
 */
export type MailTransaction = Omit<
  ExtendedPrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

/** Prisma's unique-constraint violation and "record to update not found". */
const UNIQUE_VIOLATION = 'P2002';
const RECORD_NOT_FOUND = 'P2025';

/** The Prisma error code, read from the error's `code` so no Prisma class leaves this file. */
function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

const VERSION_COLUMNS = { locale: true, subject: true, message: true } as const;
const TEMPLATE_COLUMNS = {
  id: true,
  template_key: true,
  module: true,
  active: true,
  formatting_dropped: true,
  updated_by_staff_id: true,
  created_at: true,
  updated_at: true,
  tblmail_template_versions: { select: VERSION_COLUMNS, orderBy: { locale: 'asc' } },
} as const;
const TEMPLATE_LIST_COLUMNS = {
  id: true,
  template_key: true,
  module: true,
  active: true,
  tblmail_template_versions: { select: { locale: true }, orderBy: { locale: 'asc' } },
} as const;
const SENT_COLUMNS = {
  id: true,
  template_key: true,
  is_test: true,
  source_ref: true,
  recipient_email: true,
  locale: true,
  status: true,
  attempts: true,
  max_attempts: true,
  next_try_at: true,
  failure_reason: true,
  server_reply: true,
  dedupe_key: true,
  resent_from_id: true,
  requested_by_staff_id: true,
  request_id: true,
  queued_at: true,
  sent_at: true,
  updated_at: true,
} as const;

const versionSchema = z.object({ locale: z.string(), subject: z.string(), message: z.string() });

const templateRowSchema = z
  .object({
    id: z.number().int(),
    template_key: z.string(),
    module: z.string(),
    active: z.boolean(),
    formatting_dropped: z.boolean(),
    updated_by_staff_id: z.number().int().nullable(),
    created_at: z.date(),
    updated_at: z.date(),
    tblmail_template_versions: z.array(versionSchema),
  })
  .transform((row): MailTemplate => ({
    id: row.id,
    key: row.template_key,
    module: row.module,
    active: row.active,
    formattingDropped: row.formatting_dropped,
    updatedByStaffId: row.updated_by_staff_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    versions: row.tblmail_template_versions,
  }));

const templateListRowSchema = z
  .object({
    id: z.number().int(),
    template_key: z.string(),
    module: z.string(),
    active: z.boolean(),
    tblmail_template_versions: z.array(z.object({ locale: z.string() })),
  })
  .transform((row): MailTemplateListItem => ({
    id: row.id,
    key: row.template_key,
    module: row.module,
    active: row.active,
    locales: row.tblmail_template_versions.map((version) => version.locale),
  }));

const failureReasonSchema = z
  .string()
  .nullable()
  .transform((raw): MailFailureReason | null => {
    if (raw === null) return null;
    return (MAIL_FAILURE_REASONS as readonly string[]).includes(raw)
      ? (raw as MailFailureReason)
      : 'unknown';
  });

const sentRowSchema = z
  .object({
    id: z.number().int(),
    template_key: z.string().nullable(),
    is_test: z.boolean(),
    source_ref: z.string().nullable(),
    recipient_email: z.string(),
    locale: z.string(),
    status: z.enum(SENT_EMAIL_STATUSES),
    attempts: z.number().int(),
    max_attempts: z.number().int(),
    next_try_at: z.date().nullable(),
    failure_reason: failureReasonSchema,
    server_reply: z.string().nullable(),
    dedupe_key: z.string().nullable(),
    resent_from_id: z.number().int().nullable(),
    requested_by_staff_id: z.number().int().nullable(),
    request_id: z.string().nullable(),
    queued_at: z.date(),
    sent_at: z.date().nullable(),
    updated_at: z.date(),
  })
  .transform((row): SentEmail => ({
    id: row.id,
    templateKey: row.template_key,
    isTest: row.is_test,
    sourceRef: row.source_ref,
    recipientEmail: row.recipient_email,
    locale: row.locale,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextTryAt: row.next_try_at,
    failureReason: row.failure_reason,
    serverReply: row.server_reply,
    dedupeKey: row.dedupe_key,
    resentFromId: row.resent_from_id,
    requestedByStaffId: row.requested_by_staff_id,
    requestId: row.request_id,
    queuedAt: row.queued_at,
    sentAt: row.sent_at,
    updatedAt: row.updated_at,
  }));

const perfexTemplateRowSchema = z
  .object({
    language: z.string().nullable(),
    subject: z.string(),
    message: z.string(),
    active: z.number().int(),
  })
  .transform((row): PerfexTemplateRow => ({
    language: row.language,
    subject: row.subject,
    message: row.message,
    active: row.active !== 0,
  }));

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];

/** The column each template sort field orders by; a fixed map, never a caller's string. */
const TEMPLATE_SORT_COLUMNS = {
  module: 'module',
  key: 'template_key',
} as const satisfies Record<MailTemplateSortField, string>;

/** `{ AND: [...] }` of the fragments that are not `null`; `{}` matches every row. */
function allOf(fragments: readonly (WhereValue | null)[]): WhereValue {
  const present = fragments.filter((fragment): fragment is WhereValue => fragment !== null);
  return present.length === 0 ? {} : { AND: present };
}

function templateMatch(request: MailTemplateListRequest): WhereValue {
  const { search, modules, translation, active, locales } = request;
  const has = (locale: string) => ({ tblmail_template_versions: { some: { locale } } });
  const lacks = (locale: string) => ({ tblmail_template_versions: { none: { locale } } });
  return allOf([
    search === null
      ? null
      : {
          OR: [
            { template_key: { contains: search } },
            { tblmail_template_versions: { some: { subject: { contains: search } } } },
          ],
        },
    modules.length === 0 ? null : { module: { in: [...modules] } },
    active === null ? null : { active },
    translation === 'complete' ? { AND: locales.map(has) } : null,
    translation === 'missing' ? { OR: locales.map(lacks) } : null,
  ]);
}

function sentMatch(request: SentEmailListRequest): WhereValue {
  const { recipientPrefix, templates, statuses, queuedFrom, queuedTo } = request;
  const keys = templates.filter((key) => key !== STATUS_TEST_FILTER);
  const tests = templates.includes(STATUS_TEST_FILTER);
  return allOf([
    recipientPrefix === null ? null : { recipient_email: { startsWith: recipientPrefix } },
    templates.length === 0
      ? null
      : {
          OR: [
            ...(keys.length > 0 ? [{ template_key: { in: keys } }] : []),
            ...(tests ? [{ template_key: null }] : []),
          ],
        },
    statuses.length === 0 ? null : { status: { in: [...statuses] } },
    queuedFrom === null ? null : { queued_at: { gte: queuedFrom } },
    queuedTo === null ? null : { queued_at: { lte: queuedTo } },
  ]);
}

/** A `before` cursor reads the rows just before it in the reversed order, then reverses them back. */
function readDirection(
  order: 'asc' | 'desc',
  cursor: DecodedCursor<string> | null,
): 'asc' | 'desc' {
  if (cursor?.direction !== 'before') return order;
  return order === 'asc' ? 'desc' : 'asc';
}

/** Next exists while rows remain after the page, Previous while rows exist before it. */
function pageMeta(sort: string, keys: readonly Key[], total: number, before: number): ListPageMeta {
  const first = keys[0];
  const last = keys.at(-1);
  if (first === undefined || last === undefined) {
    return { nextCursor: null, prevCursor: null, total, rangeStart: 0 };
  }
  const rangeStart = before + 1;
  return {
    nextCursor: rangeStart - 1 + keys.length < total ? encodeCursor(sort, last, 'after') : null,
    prevCursor: rangeStart > 1 ? encodeCursor(sort, first, 'before') : null,
    total,
    rangeStart,
  };
}

@Injectable()
export class MailRepository {
  constructor(private readonly prisma: PrismaService) {}

  // --- templates ------------------------------------------------------------------------------

  async findTemplateById(id: number): Promise<MailTemplate | null> {
    return this.readTemplate(this.prisma.client, { id });
  }

  async findTemplateByKey(key: string): Promise<MailTemplate | null> {
    return this.readTemplate(this.prisma.client, { template_key: key });
  }

  /**
   * One keyset page ordered by `(sortField, id)`, then `total` (the match without the cursor) and
   * the rank of the first row, the expense-categories form.
   */
  async listTemplates(request: MailTemplateListRequest): Promise<MailTemplatePage> {
    const { sortField, order, cursor, limit } = request;
    const column = TEMPLATE_SORT_COLUMNS[sortField];
    const match = templateMatch(request);
    const read = readDirection(order, cursor);
    const rows = await this.prisma.client.tblmail_templates.findMany({
      where: cursor === null ? match : { AND: [match, keysetWhere(column, 'id', cursor, order)] },
      orderBy: [{ [column]: read }, { id: read }],
      take: limit,
      select: TEMPLATE_LIST_COLUMNS,
    });
    const items = z.array(templateListRowSchema).parse(rows);
    if (read !== order) items.reverse();
    const keys = items.map((row): Key => [sortField === 'module' ? row.module : row.key, row.id]);
    const first = keys[0];
    const [total, before] = await Promise.all([
      this.prisma.client.tblmail_templates.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblmail_templates.count({
            where: {
              AND: [
                match,
                keysetWhere(
                  column,
                  'id',
                  { sort: sortField, key: first, direction: 'before' },
                  order,
                ),
              ],
            },
          }),
    ]);
    return { items, ...pageMeta(sortField, keys, total, before) };
  }

  /** Every module that has a template, sorted. */
  async templateModules(): Promise<string[]> {
    const rows = await this.prisma.client.tblmail_templates.findMany({
      distinct: ['module'],
      select: { module: true },
      orderBy: { module: 'asc' },
    });
    return rows.map((row) => row.module);
  }

  /** Every template key, sorted. */
  async templateKeys(): Promise<string[]> {
    const rows = await this.prisma.client.tblmail_templates.findMany({
      select: { template_key: true },
      orderBy: { template_key: 'asc' },
    });
    return rows.map((row) => row.template_key);
  }

  /** Active of each stored template among `keys`, in one read; a key with no template is absent. */
  async templateActivity(keys: readonly string[]): Promise<ReadonlyMap<string, boolean>> {
    if (keys.length === 0) return new Map();
    const rows = await this.prisma.client.tblmail_templates.findMany({
      where: { template_key: { in: [...keys] } },
      select: { template_key: true, active: true },
    });
    return new Map(rows.map((row) => [row.template_key, row.active]));
  }

  /** `null` when the key already exists (P2002): another process seeded it first. */
  async createTemplate(input: {
    readonly key: string;
    readonly module: string;
    readonly active: boolean;
    readonly formattingDropped: boolean;
    readonly versions: readonly MailTemplateVersion[];
  }): Promise<MailTemplate | null> {
    const now = new Date();
    try {
      const row = await this.prisma.client.tblmail_templates.create({
        data: {
          template_key: input.key,
          module: input.module,
          active: input.active,
          formatting_dropped: input.formattingDropped,
          created_at: now,
          updated_at: now,
          tblmail_template_versions: {
            create: input.versions.map((version) => ({ ...version, updated_at: now })),
          },
        },
        select: TEMPLATE_COLUMNS,
      });
      return templateRowSchema.parse(row);
    } catch (error) {
      if (hasCode(error, UNIQUE_VIOLATION)) return null;
      throw error;
    }
  }

  /**
   * One interactive transaction: the row lock (`UPDATE ... SET id = id`; 0 rows is a missing id,
   * `null`), the re-read, `assertCurrent` (it throws to abort, so nothing is written), then Active,
   * the stamp, `formatting_dropped = 0`, an upsert per non-null version and a delete per null one.
   * Answers the template as it is after the write.
   */
  async saveTemplate(
    id: number,
    assertCurrent: (current: MailTemplate) => void,
    change: TemplateChange,
  ): Promise<MailTemplate | null> {
    return this.prisma.client.$transaction(async (tx) => {
      const locked = await tx.$executeRaw`UPDATE tblmail_templates SET id = id WHERE id = ${id}`;
      if (locked === 0) return null;
      const current = await this.readTemplate(tx, { id });
      if (current === null) return null;
      assertCurrent(current);
      const now = new Date();
      const entries = Object.entries(change.versions);
      const removed = entries.filter(([, version]) => version === null).map(([locale]) => locale);
      await tx.tblmail_templates.update({
        where: { id },
        data: {
          active: change.active,
          updated_by_staff_id: change.staffId,
          updated_at: now,
          formatting_dropped: false,
        },
      });
      await tx.tblmail_template_versions.deleteMany({
        where: { template_id: id, locale: { in: removed } },
      });
      await Promise.all(
        entries.flatMap(([locale, version]) =>
          version === null
            ? []
            : [
                tx.tblmail_template_versions.upsert({
                  where: { template_id_locale: { template_id: id, locale } },
                  create: { template_id: id, locale, ...version, updated_at: now },
                  update: { ...version, updated_at: now },
                }),
              ],
        ),
      );
      return this.readTemplate(tx, { id });
    });
  }

  /** `null` when the id is missing. */
  async setActive(id: number, active: boolean, staffId: number): Promise<MailTemplate | null> {
    try {
      const row = await this.prisma.client.tblmail_templates.update({
        where: { id },
        data: { active, updated_by_staff_id: staffId, updated_at: new Date() },
        select: TEMPLATE_COLUMNS,
      });
      return templateRowSchema.parse(row);
    } catch (error) {
      if (hasCode(error, RECORD_NOT_FOUND)) return null;
      throw error;
    }
  }

  /** Sets Active on every template of `module` that differs; answers how many changed. */
  async setActiveByModule(module: string, active: boolean, staffId: number): Promise<number> {
    const { count } = await this.prisma.client.tblmail_templates.updateMany({
      where: { module, active: !active },
      data: { active, updated_by_staff_id: staffId, updated_at: new Date() },
    });
    return count;
  }

  // --- sent emails ----------------------------------------------------------------------------

  /** Inserts a `queued` (or `failed`) row; a `dedupeKey` already stored answers that row, `created: false`. */
  async insertSent(
    row: NewSentEmail,
    now: Date,
  ): Promise<{ readonly row: SentEmail; readonly created: boolean }> {
    try {
      const created = await this.prisma.client.tblmail_sent_emails.create({
        data: {
          template_key: row.templateKey,
          is_test: row.isTest,
          source_ref: row.sourceRef,
          recipient_email: row.recipientEmail,
          locale: row.locale,
          status: row.status,
          failure_reason: row.failureReason,
          max_attempts: row.maxAttempts,
          dedupe_key: row.dedupeKey,
          resent_from_id: row.resentFromId,
          requested_by_staff_id: row.requestedByStaffId,
          request_id: row.requestId,
          queued_at: now,
          updated_at: now,
        },
        select: SENT_COLUMNS,
      });
      return { row: sentRowSchema.parse(created), created: true };
    } catch (error) {
      if (row.dedupeKey === null || !hasCode(error, UNIQUE_VIOLATION)) throw error;
      const existing = await this.prisma.client.tblmail_sent_emails.findUnique({
        where: { dedupe_key: row.dedupeKey },
        select: SENT_COLUMNS,
      });
      if (existing === null) throw error;
      return { row: sentRowSchema.parse(existing), created: false };
    }
  }

  async findSent(id: number): Promise<SentEmail | null> {
    const row = await this.prisma.client.tblmail_sent_emails.findUnique({
      where: { id },
      select: SENT_COLUMNS,
    });
    return row === null ? null : sentRowSchema.parse(row);
  }

  /** One keyset page ordered by `(queued_at, id)`, newest first unless `order` asks otherwise. */
  async listSent(request: SentEmailListRequest): Promise<SentEmailPage> {
    const { order, cursor, limit } = request;
    const match = sentMatch(request);
    const read = readDirection(order, cursor);
    const rows = await this.prisma.client.tblmail_sent_emails.findMany({
      where:
        cursor === null ? match : { AND: [match, keysetWhere('queued_at', 'id', cursor, order)] },
      orderBy: [{ queued_at: read }, { id: read }],
      take: limit,
      select: SENT_COLUMNS,
    });
    const items = z.array(sentRowSchema).parse(rows);
    if (read !== order) items.reverse();
    const keys = items.map((row): Key => [row.queuedAt.toISOString(), row.id]);
    const first = keys[0];
    const [total, before] = await Promise.all([
      this.prisma.client.tblmail_sent_emails.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblmail_sent_emails.count({
            where: {
              AND: [
                match,
                keysetWhere(
                  'queued_at',
                  'id',
                  { sort: 'queuedAt', key: first, direction: 'before' },
                  order,
                ),
              ],
            },
          }),
    ]);
    return { items, ...pageMeta('queuedAt', keys, total, before) };
  }

  /** The newest row (by id) whose status is `sent` or `failed`, or `null`. */
  async lastFinished(): Promise<SentEmail | null> {
    const row = await this.prisma.client.tblmail_sent_emails.findFirst({
      where: { status: { in: ['sent', 'failed'] } },
      orderBy: { id: 'desc' },
      select: SENT_COLUMNS,
    });
    return row === null ? null : sentRowSchema.parse(row);
  }

  async markSent(id: number, attempts: number, at: Date): Promise<void> {
    await this.prisma.client.tblmail_sent_emails.updateMany({
      where: { id },
      data: {
        status: 'sent',
        attempts,
        sent_at: at,
        next_try_at: null,
        failure_reason: null,
        server_reply: null,
        updated_at: at,
      },
    });
  }

  async markRetrying(
    id: number,
    attempts: number,
    nextTryAt: Date,
    reason: MailFailureReason,
    serverReply: string | null,
    at: Date,
  ): Promise<void> {
    await this.prisma.client.tblmail_sent_emails.updateMany({
      where: { id },
      data: {
        status: 'retrying',
        attempts,
        next_try_at: nextTryAt,
        failure_reason: reason,
        server_reply: serverReply,
        updated_at: at,
      },
    });
  }

  async markFailed(
    id: number,
    attempts: number,
    reason: MailFailureReason,
    serverReply: string | null,
    at: Date,
  ): Promise<void> {
    await this.prisma.client.tblmail_sent_emails.updateMany({
      where: { id },
      data: {
        status: 'failed',
        attempts,
        next_try_at: null,
        failure_reason: reason,
        server_reply: serverReply,
        updated_at: at,
      },
    });
  }

  /** Ids of non-test rows still `queued` before `cutoff`, oldest first (the sweep's read). */
  async queuedBefore(cutoff: Date, limit: number): Promise<number[]> {
    const rows = await this.prisma.client.tblmail_sent_emails.findMany({
      where: { status: 'queued', is_test: false, queued_at: { lt: cutoff } },
      orderBy: [{ queued_at: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * ONE batch of the 12-month purge (D-09, B12): the ids of at most `batchSize` rows queued before
   * `cutoff`, lowest first, then one delete by primary key. Answers the count; the processor loops
   * until it answers less than `batchSize`.
   */
  async purgeBefore(cutoff: Date, batchSize: number): Promise<number> {
    const rows = await this.prisma.client.tblmail_sent_emails.findMany({
      where: { queued_at: { lt: cutoff } },
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true },
    });
    if (rows.length === 0) return 0;
    const { count } = await this.prisma.client.tblmail_sent_emails.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    return count;
  }

  // --- Perfex, read only ----------------------------------------------------------------------

  /** Perfex's `tblemailtemplates` rows of one slug, every language (DB-03: read, never written). */
  async readPerfexTemplates(slug: string): Promise<PerfexTemplateRow[]> {
    const rows = await this.prisma.client.tblemailtemplates.findMany({
      where: { slug },
      select: { language: true, subject: true, message: true, active: true },
    });
    return z.array(perfexTemplateRowSchema).parse(rows);
  }

  private async readTemplate(
    client: MailTransaction,
    where: { readonly id: number } | { readonly template_key: string },
  ): Promise<MailTemplate | null> {
    const row = await client.tblmail_templates.findUnique({ where, select: TEMPLATE_COLUMNS });
    return row === null ? null : templateRowSchema.parse(row);
  }
}
