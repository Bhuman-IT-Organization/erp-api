/**
 * MailRepository against the local database (DATABASE_URL from ../erp-infra/env/local/api.host.env).
 *
 * The three tables are node-owned (`prisma/ownership-node.json`), so the ownership guard admits the
 * writes and the one raw row lock. Everything this spec writes it creates and deletes itself:
 * templates keyed `zz_test_<run>_*` (their versions go with them, ON DELETE CASCADE) and sent rows
 * whose `source_ref` starts `zz_test_`, at queued times in 2000 and 2001 so no real row can fall in
 * a filter window or under the purge cut-off. Perfex's `tblemailtemplates` is only read, with a slug
 * that does not exist, so no Perfex value is read into an assertion.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import {
  STATUS_TEST_FILTER,
  type MailTemplate,
  type NewSentEmail,
  type SentEmailPage,
} from '../model/mail.model.js';
import {
  MailRepository,
  type MailTemplateListRequest,
  type SentEmailListRequest,
} from '../repository/mail.repository.js';

const RUN = randomUUID().slice(0, 8);
const PREFIX = 'zz_test_';
const KEY_A = `${PREFIX}${RUN}_a`;
const KEY_B = `${PREFIX}${RUN}_b`;
const MOD_A = 'zz_mod_a';
const MOD_B = 'zz_mod_b';
const SOURCE = `${PREFIX}${RUN}`;
/** A token only the Arabic subject of KEY_A carries. */
const AR_TOKEN = `تجربة-${RUN}`;
const at = (iso: string): Date => new Date(iso);

/** The filter window every sent-email list case reads, so no real row is ever in it. */
const WINDOW = {
  queuedFrom: at('2001-01-01T00:00:00.000Z'),
  queuedTo: at('2001-12-31T00:00:00.000Z'),
};

function templates(overrides: Partial<MailTemplateListRequest> = {}): MailTemplateListRequest {
  return {
    sortField: 'module',
    order: 'asc',
    cursor: null,
    limit: 25,
    search: null,
    modules: [MOD_A, MOD_B],
    translation: null,
    active: null,
    locales: ['en', 'ar'],
    ...overrides,
  };
}

function sentList(overrides: Partial<SentEmailListRequest> = {}): SentEmailListRequest {
  return {
    order: 'desc',
    cursor: null,
    limit: 25,
    recipientPrefix: null,
    templates: [],
    statuses: [],
    ...WINDOW,
    ...overrides,
  };
}

function newSent(overrides: Partial<NewSentEmail> = {}): NewSentEmail {
  return {
    templateKey: KEY_A,
    isTest: false,
    sourceRef: SOURCE,
    recipientEmail: 'user@example.test',
    locale: 'en',
    status: 'queued',
    failureReason: null,
    maxAttempts: 8,
    dedupeKey: null,
    resentFromId: null,
    requestedByStaffId: null,
    requestId: null,
    ...overrides,
  };
}

const ids = (page: { items: readonly { id: number }[] }): number[] => page.items.map((r) => r.id);

describe.skipIf(!process.env.DATABASE_URL)('MailRepository against the local database', () => {
  const service = new PrismaService(new AppConfig(), new HealthService());
  const repository = new MailRepository(service);

  const cleanup = async (): Promise<void> => {
    await service.client.tblmail_templates.deleteMany({
      where: { template_key: { startsWith: PREFIX } },
    });
    await service.client.tblmail_sent_emails.deleteMany({
      where: { source_ref: { startsWith: PREFIX } },
    });
  };

  const insert = async (row: Partial<NewSentEmail>, iso: string): Promise<number> =>
    (await repository.insertSent(newSent(row), at(iso))).row.id;

  beforeAll(cleanup);

  afterAll(async () => {
    await cleanup();
    const left = await Promise.all([
      service.client.tblmail_templates.count({ where: { template_key: { startsWith: PREFIX } } }),
      service.client.tblmail_sent_emails.count({ where: { source_ref: { startsWith: PREFIX } } }),
    ]);
    await service.client.$disconnect();
    expect(left).toEqual([0, 0]);
  });

  describe('templates', () => {
    let a: MailTemplate;
    let b: MailTemplate;

    beforeAll(async () => {
      const created = await Promise.all([
        repository.createTemplate({
          key: KEY_A,
          module: MOD_A,
          active: true,
          formattingDropped: true,
          versions: [
            { locale: 'en', subject: 'Hello', message: 'Body en' },
            { locale: 'ar', subject: AR_TOKEN, message: 'نص' },
          ],
        }),
        repository.createTemplate({
          key: KEY_B,
          module: MOD_B,
          active: true,
          formattingDropped: false,
          versions: [{ locale: 'en', subject: 'Only en', message: 'Body' }],
        }),
      ]);
      if (created[0] === null || created[1] === null) throw new Error('seed failed');
      [a, b] = created;
    });

    it('creates with its versions ordered by locale; a second create of the key answers null', async () => {
      expect(a.versions.map((v) => v.locale)).toEqual(['ar', 'en']);
      expect(a.formattingDropped).toBe(true);
      expect(await repository.findTemplateByKey(KEY_A)).toEqual(a);
      expect(await repository.findTemplateById(b.id)).toEqual(b);
      expect(
        await repository.createTemplate({
          key: KEY_A,
          module: MOD_A,
          active: true,
          formattingDropped: false,
          versions: [],
        }),
      ).toBeNull();
    });

    it('pages by module with limit 1 forward and back; total 2, rangeStart 1 then 2', async () => {
      const first = await repository.listTemplates(templates({ limit: 1 }));
      expect(ids(first)).toEqual([a.id]);
      expect(first.total).toBe(2);
      expect(first.rangeStart).toBe(1);
      expect(first.prevCursor).toBeNull();
      expect(first.items[0]?.locales).toEqual(['ar', 'en']);
      const second = await repository.listTemplates(
        templates({ limit: 1, cursor: decodeCursor(first.nextCursor, 'module') }),
      );
      expect(ids(second)).toEqual([b.id]);
      expect(second.rangeStart).toBe(2);
      expect(second.nextCursor).toBeNull();
      const back = await repository.listTemplates(
        templates({ limit: 1, cursor: decodeCursor(second.prevCursor, 'module') }),
      );
      expect(ids(back)).toEqual([a.id]);
      const byKeyDesc = await repository.listTemplates(
        templates({ sortField: 'key', order: 'desc' }),
      );
      expect(ids(byKeyDesc)).toEqual([b.id, a.id]);
    });

    it('filters by translation, by search over an Arabic subject, and lists modules and keys', async () => {
      expect(ids(await repository.listTemplates(templates({ translation: 'complete' })))).toEqual([
        a.id,
      ]);
      expect(ids(await repository.listTemplates(templates({ translation: 'missing' })))).toEqual([
        b.id,
      ]);
      expect(ids(await repository.listTemplates(templates({ search: AR_TOKEN })))).toEqual([a.id]);
      expect(ids(await repository.listTemplates(templates({ search: KEY_B })))).toEqual([b.id]);
      expect(ids(await repository.listTemplates(templates({ modules: [MOD_B] })))).toEqual([b.id]);
      const modules = await repository.templateModules();
      expect(modules).toEqual(expect.arrayContaining([MOD_A, MOD_B]));
      expect(modules).toEqual([...modules].sort());
      expect(await repository.templateKeys()).toEqual(expect.arrayContaining([KEY_A, KEY_B]));
      expect(await repository.templateActivity([KEY_A, KEY_B, `${KEY_A}_absent`])).toEqual(
        new Map([
          [KEY_A, true],
          [KEY_B, true],
        ]),
      );
    });

    it('setActive one by one, then the active filter; setActiveByModule changes only its module', async () => {
      const off = await repository.setActive(b.id, false, 1);
      expect(off?.active).toBe(false);
      expect(off?.updatedByStaffId).toBe(1);
      expect(ids(await repository.listTemplates(templates({ active: false })))).toEqual([b.id]);
      expect(await repository.setActive(0, false, 1)).toBeNull();
      expect(await repository.setActiveByModule(MOD_A, false, 1)).toBe(1);
      expect(await repository.setActiveByModule(MOD_A, false, 1)).toBe(0);
      expect((await repository.findTemplateById(a.id))?.active).toBe(false);
      expect(await repository.setActiveByModule(MOD_B, true, 1)).toBe(1);
      expect(await repository.setActiveByModule(MOD_A, true, 1)).toBe(1);
    });

    it('saveTemplate: a throwing check aborts with nothing changed; a passing one writes under the lock', async () => {
      const stale = new AppError('ERP-CORE-0013');
      await expect(
        repository.saveTemplate(
          a.id,
          () => {
            throw stale;
          },
          { active: false, versions: { en: null }, staffId: 2 },
        ),
      ).rejects.toBe(stale);
      const unchanged = await repository.findTemplateById(a.id);
      expect(unchanged?.versions.map((v) => v.locale)).toEqual(['ar', 'en']);
      expect(unchanged?.active).toBe(true);

      let shown: MailTemplate | null = null;
      const saved = await repository.saveTemplate(
        a.id,
        (current) => {
          shown = current;
        },
        {
          active: false,
          versions: { en: { subject: 'New', message: 'New body' }, ar: null },
          staffId: 2,
        },
      );
      expect(shown).toEqual(unchanged);
      expect(saved?.active).toBe(false);
      expect(saved?.versions).toEqual([{ locale: 'en', subject: 'New', message: 'New body' }]);
      expect(saved?.formattingDropped).toBe(false);
      expect(saved?.updatedByStaffId).toBe(2);
      expect(
        await repository.saveTemplate(0, () => undefined, {
          active: true,
          versions: {},
          staffId: 2,
        }),
      ).toBeNull();
    });
  });

  describe('sent emails', () => {
    afterEach(async () => {
      await service.client.tblmail_sent_emails.deleteMany({
        where: { source_ref: { startsWith: PREFIX } },
      });
    });

    it('insertSent is idempotent on dedupeKey and the row carries no subject or body', async () => {
      const dedupeKey = `zz:${randomUUID()}`;
      const now = at('2001-02-01T00:00:00.000Z');
      const first = await repository.insertSent(newSent({ dedupeKey }), now);
      const again = await repository.insertSent(
        newSent({ dedupeKey, recipientEmail: 'other@example.test' }),
        now,
      );
      expect(first.created).toBe(true);
      expect(again).toEqual({ row: first.row, created: false });
      expect(first.row).toMatchObject({
        status: 'queued',
        attempts: 0,
        maxAttempts: 8,
        queuedAt: now,
        sentAt: null,
      });
      expect(Object.keys(first.row)).not.toEqual(expect.arrayContaining(['subject']));
      expect(Object.keys(first.row).filter((k) => /subject|message|body/i.test(k))).toEqual([]);
      expect(await repository.findSent(first.row.id)).toEqual(first.row);
      expect(await repository.findSent(0)).toBeNull();
    });

    it('listSent pages newest first and each filter narrows as named', async () => {
      const oldest = await insert(
        { status: 'failed', failureReason: 'auth_failed' },
        '2001-03-01T00:00:00.000Z',
      );
      const test = await insert({ templateKey: null, isTest: true }, '2001-03-02T00:00:00.000Z');
      const other = await insert(
        { recipientEmail: 'other@example.test' },
        '2001-03-03T00:00:00.000Z',
      );
      const newest = await insert({}, '2001-03-04T00:00:00.000Z');

      const first: SentEmailPage = await repository.listSent(sentList({ limit: 2 }));
      expect(ids(first)).toEqual([newest, other]);
      expect(first.total).toBe(4);
      const second = await repository.listSent(
        sentList({ limit: 2, cursor: decodeCursor(first.nextCursor, 'queuedAt') }),
      );
      expect(ids(second)).toEqual([test, oldest]);
      expect(second.rangeStart).toBe(3);
      expect(second.nextCursor).toBeNull();
      const back = await repository.listSent(
        sentList({ limit: 2, cursor: decodeCursor(second.prevCursor, 'queuedAt') }),
      );
      expect(ids(back)).toEqual([newest, other]);
      expect(ids(await repository.listSent(sentList({ order: 'asc' })))).toEqual([
        oldest,
        test,
        other,
        newest,
      ]);

      expect(ids(await repository.listSent(sentList({ templates: [STATUS_TEST_FILTER] })))).toEqual(
        [test],
      );
      expect(
        ids(await repository.listSent(sentList({ templates: [KEY_A, STATUS_TEST_FILTER] }))),
      ).toHaveLength(4);
      expect(ids(await repository.listSent(sentList({ statuses: ['failed'] })))).toEqual([oldest]);
      expect(
        ids(
          await repository.listSent(
            sentList({
              queuedFrom: at('2001-03-02T00:00:00.000Z'),
              queuedTo: at('2001-03-03T00:00:00.000Z'),
            }),
          ),
        ),
      ).toEqual([other, test]);
      expect(ids(await repository.listSent(sentList({ recipientPrefix: 'user@' })))).toEqual([
        newest,
        test,
        oldest,
      ]);
      const failed = await repository.findSent(oldest);
      expect(failed?.failureReason).toBe('auth_failed');
    });

    it('moves a row through retrying, sent and failed; lastFinished is the newest finished row', async () => {
      const id = await insert({}, '2001-04-01T00:00:00.000Z');
      const later = at('2001-04-01T00:00:30.000Z');
      await repository.markRetrying(id, 1, later, 'timeout', '421 try later', later);
      expect(await repository.findSent(id)).toMatchObject({
        status: 'retrying',
        attempts: 1,
        nextTryAt: later,
        failureReason: 'timeout',
        serverReply: '421 try later',
      });
      const sentAt = new Date();
      await repository.markSent(id, 2, sentAt);
      expect(await repository.findSent(id)).toMatchObject({
        status: 'sent',
        attempts: 2,
        sentAt,
        nextTryAt: null,
        failureReason: null,
      });
      const other = await insert({}, '2001-04-02T00:00:00.000Z');
      await repository.markFailed(other, 8, 'recipient_refused', '550 no such user', new Date());
      expect(await repository.findSent(other)).toMatchObject({
        status: 'failed',
        attempts: 8,
        failureReason: 'recipient_refused',
        serverReply: '550 no such user',
        nextTryAt: null,
      });
      expect((await repository.lastFinished())?.id).toBe(other);
    });

    it('queuedBefore lists a queued non-test row older than the cut-off, not a test row nor a newer one', async () => {
      const old = await insert({}, '2001-05-01T00:00:00.000Z');
      await insert({ isTest: true, templateKey: null }, '2001-05-01T00:00:01.000Z');
      await insert({}, '2001-05-03T00:00:00.000Z');
      expect(await repository.queuedBefore(at('2001-05-02T00:00:00.000Z'), 10)).toEqual([old]);
    });

    it('purgeBefore deletes one batch at a time: 2, 2, 1, 0, and the newer row stays (B12)', async () => {
      for (const day of ['01', '02', '03', '04', '05']) {
        await insert({}, `2000-01-${day}T00:00:00.000Z`);
      }
      const newer = await insert({}, '2000-01-07T00:00:00.000Z');
      const cutoff = at('2000-01-06T00:00:00.000Z');
      const counts: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        counts.push(await repository.purgeBefore(cutoff, 2));
      }
      expect(counts).toEqual([2, 2, 1, 0]);
      expect(await repository.findSent(newer)).not.toBeNull();
    });
  });

  it('readPerfexTemplates runs its read on tblemailtemplates and answers [] for an absent slug', async () => {
    expect(await repository.readPerfexTemplates(`zz_absent_${randomUUID()}`)).toEqual([]);
  });
});
