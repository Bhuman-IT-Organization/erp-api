/**
 * MailRepository over a stub client: what it asks the database, not what the database answers (the
 * int spec proves that against the local database). The stub records every delegate call and the
 * one tagged `$executeRaw` (its SQL text with `?` per hole, and the bound values), so these cases
 * prove the query shapes and the paths a real database cannot be made to take on demand: an
 * unknown `failure_reason` reads as `unknown`, an unknown `status` fails the parse, P2002 and P2025
 * become `null` (or the existing row) while any other error is rethrown, the lock's zero rows, and
 * an empty purge batch issues no delete.
 */
import { describe, expect, it } from 'vitest';
import { STATUS_TEST_FILTER, type NewSentEmail } from '../model/mail.model.js';
import {
  MailRepository,
  type MailTemplateListRequest,
  type SentEmailListRequest,
} from '../repository/mail.repository.js';

/** The repository's constructor parameter, named without importing the database layer. */
type ClientHolder = ConstructorParameters<typeof MailRepository>[0];

const T0 = new Date('2026-10-02T08:00:00.000Z');
/** The clock's own `now`, which these cases do not fix. */
const ANY_DATE: unknown = expect.any(Date);

const templateRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  template_key: 'k1',
  module: 'm1',
  active: true,
  formatting_dropped: false,
  updated_by_staff_id: null,
  created_at: T0,
  updated_at: T0,
  tblmail_template_versions: [{ locale: 'en', subject: 'S', message: 'M' }],
  ...overrides,
});

const sentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  template_key: 'k1',
  is_test: false,
  source_ref: null,
  recipient_email: 'user@example.test',
  locale: 'en',
  status: 'queued',
  attempts: 0,
  max_attempts: 8,
  next_try_at: null,
  failure_reason: null,
  server_reply: null,
  dedupe_key: null,
  resent_from_id: null,
  requested_by_staff_id: null,
  request_id: null,
  queued_at: T0,
  sent_at: null,
  updated_at: T0,
  ...overrides,
});

const prismaError = (code: string): Error => Object.assign(new Error(code), { code });

type Answer = unknown;

/**
 * Answers per `<table>.<method>`, in call order; an `Error` is thrown instead of answered. An empty
 * queue answers `fallback(method)`.
 */
function stub(answers: Record<string, readonly Answer[]> = {}, locked = 1) {
  const calls: { method: string; args: unknown }[] = [];
  const raw: { sql: string; values: unknown[] }[] = [];
  const queues = new Map(Object.entries(answers).map(([key, list]) => [key, [...list]]));
  const fallback = (method: string): Answer => {
    if (method === 'count') return 0;
    if (method === 'findMany') return [];
    if (method.endsWith('Many')) return { count: 0 };
    return null;
  };
  const delegate = (table: string) =>
    new Proxy(
      {},
      {
        get: (_, method: string) => (args: unknown) => {
          calls.push({ method: `${table}.${method}`, args });
          const queue = queues.get(`${table}.${method}`);
          const answer = queue !== undefined && queue.length > 0 ? queue.shift() : fallback(method);
          return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
        },
      },
    );
  const client: Record<string, unknown> = {
    tblmail_templates: delegate('tblmail_templates'),
    tblmail_template_versions: delegate('tblmail_template_versions'),
    tblmail_sent_emails: delegate('tblmail_sent_emails'),
    tblemailtemplates: delegate('tblemailtemplates'),
    $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]): Promise<number> => {
      raw.push({ sql: strings.join('?'), values });
      return Promise.resolve(locked);
    },
  };
  client.$transaction = (run: (tx: unknown) => Promise<unknown>) => run(client);
  const repository = new MailRepository({ client } as unknown as ClientHolder);
  const called = (method: string) => calls.filter((c) => c.method === method).map((c) => c.args);
  return { repository, calls, raw, called };
}

function templates(overrides: Partial<MailTemplateListRequest> = {}): MailTemplateListRequest {
  return {
    sortField: 'module',
    order: 'asc',
    cursor: null,
    limit: 2,
    search: null,
    modules: [],
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
    limit: 2,
    recipientPrefix: null,
    templates: [],
    statuses: [],
    queuedFrom: null,
    queuedTo: null,
    ...overrides,
  };
}

const newSent = (overrides: Partial<NewSentEmail> = {}): NewSentEmail => ({
  templateKey: 'k1',
  isTest: false,
  sourceRef: null,
  recipientEmail: 'user@example.test',
  locale: 'en',
  status: 'queued',
  failureReason: null,
  maxAttempts: 8,
  dedupeKey: 'd1',
  resentFromId: null,
  requestedByStaffId: null,
  requestId: null,
  ...overrides,
});

describe('MailRepository: templates', () => {
  it('reads one template by id or key into the model, null when absent', async () => {
    const { repository, called } = stub({ 'tblmail_templates.findUnique': [templateRow(), null] });
    expect(await repository.findTemplateById(1)).toEqual({
      id: 1,
      key: 'k1',
      module: 'm1',
      active: true,
      formattingDropped: false,
      updatedByStaffId: null,
      createdAt: T0,
      updatedAt: T0,
      versions: [{ locale: 'en', subject: 'S', message: 'M' }],
    });
    expect(await repository.findTemplateByKey('nope')).toBeNull();
    expect(
      called('tblmail_templates.findUnique').map((a) => (a as { where: unknown }).where),
    ).toEqual([{ id: 1 }, { template_key: 'nope' }]);
  });

  it('builds every list filter from bound values and pages by (sortField, id)', async () => {
    const { repository, called } = stub({
      'tblmail_templates.findMany': [
        [
          {
            id: 1,
            template_key: 'a',
            module: 'm',
            active: true,
            tblmail_template_versions: [{ locale: 'en' }],
          },
          { id: 2, template_key: 'b', module: 'm', active: false, tblmail_template_versions: [] },
        ],
      ],
      'tblmail_templates.count': [5, 0],
    });
    const page = await repository.listTemplates(
      templates({ search: 'x', modules: ['m'], active: true, translation: 'complete' }),
    );
    expect(page.items.map((i) => i.locales)).toEqual([['en'], []]);
    expect(page).toMatchObject({ total: 5, rangeStart: 1, prevCursor: null });
    expect(page.nextCursor).not.toBeNull();
    const [read] = called('tblmail_templates.findMany') as { where: unknown; orderBy: unknown }[];
    expect(read?.orderBy).toEqual([{ module: 'asc' }, { id: 'asc' }]);
    expect(read?.where).toEqual({
      AND: [
        {
          OR: [
            { template_key: { contains: 'x' } },
            { tblmail_template_versions: { some: { subject: { contains: 'x' } } } },
          ],
        },
        { module: { in: ['m'] } },
        { active: true },
        {
          AND: [
            { tblmail_template_versions: { some: { locale: 'en' } } },
            { tblmail_template_versions: { some: { locale: 'ar' } } },
          ],
        },
      ],
    });
  });

  it('missing translation is "lacks any locale"; a before cursor reads reversed by key; an empty page has no cursors', async () => {
    const { repository, called } = stub({
      'tblmail_templates.findMany': [
        [
          { id: 2, template_key: 'b', module: 'm', active: true, tblmail_template_versions: [] },
          { id: 1, template_key: 'a', module: 'm', active: true, tblmail_template_versions: [] },
        ],
      ],
      'tblmail_templates.count': [2, 1],
    });
    const page = await repository.listTemplates(
      templates({
        sortField: 'key',
        translation: 'missing',
        cursor: { sort: 'key', key: ['c', 3], direction: 'before' },
      }),
    );
    expect(page.items.map((i) => i.id)).toEqual([1, 2]);
    expect(page.rangeStart).toBe(2);
    const [read] = called('tblmail_templates.findMany') as {
      where: { AND: unknown[] };
      orderBy: unknown;
    }[];
    expect(read?.orderBy).toEqual([{ template_key: 'desc' }, { id: 'desc' }]);
    expect(read?.where.AND[0]).toEqual({
      AND: [
        {
          OR: [
            { tblmail_template_versions: { none: { locale: 'en' } } },
            { tblmail_template_versions: { none: { locale: 'ar' } } },
          ],
        },
      ],
    });
    const empty = await stub().repository.listTemplates(templates());
    expect(empty).toEqual({
      items: [],
      nextCursor: null,
      prevCursor: null,
      total: 0,
      rangeStart: 0,
    });
  });

  it('lists the modules (distinct) and the keys, sorted by the database', async () => {
    const { repository, called } = stub({
      'tblmail_templates.findMany': [[{ module: 'a' }, { module: 'b' }], [{ template_key: 'k' }]],
    });
    expect(await repository.templateModules()).toEqual(['a', 'b']);
    expect(await repository.templateKeys()).toEqual(['k']);
    expect(called('tblmail_templates.findMany')[0]).toMatchObject({ distinct: ['module'] });
  });

  it('templateActivity reads the keys in one findMany; no key reads nothing', async () => {
    const { repository, called } = stub({
      'tblmail_templates.findMany': [[{ template_key: 'k1', active: false }]],
    });
    expect(await repository.templateActivity([])).toEqual(new Map());
    expect(called('tblmail_templates.findMany')).toEqual([]);
    expect(await repository.templateActivity(['k1', 'k2'])).toEqual(new Map([['k1', false]]));
    expect(called('tblmail_templates.findMany')).toEqual([
      {
        where: { template_key: { in: ['k1', 'k2'] } },
        select: { template_key: true, active: true },
      },
    ]);
  });

  it('createTemplate nests the versions; P2002 answers null; any other error is rethrown', async () => {
    const boom = new Error('down');
    const { repository, called } = stub({
      'tblmail_templates.create': [templateRow(), prismaError('P2002'), boom],
    });
    const input = {
      key: 'k1',
      module: 'm1',
      active: true,
      formattingDropped: false,
      versions: [{ locale: 'en', subject: 'S', message: 'M' }],
    };
    expect((await repository.createTemplate(input))?.key).toBe('k1');
    expect(await repository.createTemplate(input)).toBeNull();
    await expect(repository.createTemplate(input)).rejects.toBe(boom);
    const [create] = called('tblmail_templates.create') as {
      data: { tblmail_template_versions: { create: { locale: string }[] } };
    }[];
    expect(create?.data.tblmail_template_versions.create[0]?.locale).toBe('en');
  });

  it('saveTemplate locks with a bound id; 0 locked rows and a vanished row answer null', async () => {
    const none = stub({}, 0);
    expect(
      await none.repository.saveTemplate(4, () => undefined, {
        active: true,
        versions: {},
        staffId: 1,
      }),
    ).toBeNull();
    expect(none.raw).toEqual([
      { sql: 'UPDATE tblmail_templates SET id = id WHERE id = ?', values: [4] },
    ]);
    expect(none.calls).toEqual([]);
    const gone = stub({ 'tblmail_templates.findUnique': [null] });
    expect(
      await gone.repository.saveTemplate(4, () => undefined, {
        active: true,
        versions: {},
        staffId: 1,
      }),
    ).toBeNull();
    expect(gone.called('tblmail_templates.update')).toEqual([]);
  });

  it('saveTemplate writes Active, the stamp, the cleared notice, an upsert per version and one delete', async () => {
    const { repository, called } = stub({
      'tblmail_templates.findUnique': [templateRow(), templateRow({ active: false })],
    });
    const saved = await repository.saveTemplate(1, () => undefined, {
      active: false,
      versions: { en: { subject: 'N', message: 'B' }, ar: null },
      staffId: 3,
    });
    expect(saved?.active).toBe(false);
    expect(called('tblmail_templates.update')).toEqual([
      {
        where: { id: 1 },
        data: {
          active: false,
          updated_by_staff_id: 3,
          updated_at: ANY_DATE,
          formatting_dropped: false,
        },
      },
    ]);
    expect(called('tblmail_template_versions.deleteMany')).toEqual([
      { where: { template_id: 1, locale: { in: ['ar'] } } },
    ]);
    expect(called('tblmail_template_versions.upsert')).toEqual([
      {
        where: { template_id_locale: { template_id: 1, locale: 'en' } },
        create: {
          template_id: 1,
          locale: 'en',
          subject: 'N',
          message: 'B',
          updated_at: ANY_DATE,
        },
        update: { subject: 'N', message: 'B', updated_at: ANY_DATE },
      },
    ]);
  });

  it('setActive answers the template, null on P2025, and rethrows anything else; per module counts the changed rows', async () => {
    const boom = new Error('down');
    const { repository, called } = stub({
      'tblmail_templates.update': [templateRow({ active: false }), prismaError('P2025'), boom],
      'tblmail_templates.updateMany': [{ count: 3 }],
    });
    expect((await repository.setActive(1, false, 2))?.active).toBe(false);
    expect(await repository.setActive(9, false, 2)).toBeNull();
    await expect(repository.setActive(9, false, 2)).rejects.toBe(boom);
    expect(await repository.setActiveByModule('m', true, 2)).toBe(3);
    expect(called('tblmail_templates.updateMany')).toEqual([
      {
        where: { module: 'm', active: false },
        data: { active: true, updated_by_staff_id: 2, updated_at: ANY_DATE },
      },
    ]);
  });
});

describe('MailRepository: sent emails', () => {
  it('reads an unknown failure_reason as unknown and refuses an unknown status', async () => {
    const { repository } = stub({
      'tblmail_sent_emails.findUnique': [
        sentRow({ status: 'failed', failure_reason: 'smtp_said_no' }),
        sentRow({ status: 'bounced' }),
        null,
      ],
    });
    expect((await repository.findSent(5))?.failureReason).toBe('unknown');
    await expect(repository.findSent(5)).rejects.toThrow();
    expect(await repository.findSent(6)).toBeNull();
  });

  it('insertSent: created; P2002 on a dedupe key answers the stored row; otherwise rethrows', async () => {
    const boom = new Error('down');
    const dup = prismaError('P2002');
    const { repository, called } = stub({
      'tblmail_sent_emails.create': [sentRow(), dup, dup, dup, boom],
      'tblmail_sent_emails.findUnique': [sentRow({ id: 9 }), null],
    });
    expect(await repository.insertSent(newSent(), T0)).toMatchObject({
      created: true,
      row: { id: 5 },
    });
    expect(await repository.insertSent(newSent(), T0)).toMatchObject({
      created: false,
      row: { id: 9 },
    });
    await expect(repository.insertSent(newSent(), T0)).rejects.toBe(dup);
    await expect(repository.insertSent(newSent({ dedupeKey: null }), T0)).rejects.toBe(dup);
    await expect(repository.insertSent(newSent(), T0)).rejects.toBe(boom);
    expect(called('tblmail_sent_emails.findUnique')[0]).toMatchObject({
      where: { dedupe_key: 'd1' },
    });
    expect(called('tblmail_sent_emails.create')[0]).toMatchObject({
      data: { queued_at: T0, updated_at: T0, status: 'queued', dedupe_key: 'd1' },
    });
  });

  it('listSent: the status-test filter is template_key NULL, every other filter a bound value', async () => {
    const { repository, called } = stub({
      'tblmail_sent_emails.findMany': [[sentRow({ id: 2 }), sentRow({ id: 1 })], []],
      'tblmail_sent_emails.count': [3, 0],
    });
    const from = new Date('2026-01-01T00:00:00.000Z');
    const page = await repository.listSent(
      sentList({
        recipientPrefix: 'user@',
        templates: ['k1', STATUS_TEST_FILTER],
        statuses: ['failed'],
        queuedFrom: from,
        queuedTo: T0,
      }),
    );
    expect(page.items.map((i) => i.id)).toEqual([2, 1]);
    expect(page.nextCursor).not.toBeNull();
    const [read] = called('tblmail_sent_emails.findMany') as { where: unknown; orderBy: unknown }[];
    expect(read?.orderBy).toEqual([{ queued_at: 'desc' }, { id: 'desc' }]);
    expect(read?.where).toEqual({
      AND: [
        { recipient_email: { startsWith: 'user@' } },
        { OR: [{ template_key: { in: ['k1'] } }, { template_key: null }] },
        { status: { in: ['failed'] } },
        { queued_at: { gte: from } },
        { queued_at: { lte: T0 } },
      ],
    });
    await repository.listSent(
      sentList({
        templates: [STATUS_TEST_FILTER],
        cursor: { sort: 'queuedAt', key: [T0.toISOString(), 1], direction: 'after' },
      }),
    );
    const second = called('tblmail_sent_emails.findMany')[1] as { where: { AND: unknown[] } };
    expect(second.where.AND[0]).toEqual({ AND: [{ OR: [{ template_key: null }] }] });
  });

  it('lastFinished reads the newest sent or failed row by id', async () => {
    const { repository, called } = stub({
      'tblmail_sent_emails.findFirst': [sentRow({ status: 'sent' }), null],
    });
    expect((await repository.lastFinished())?.status).toBe('sent');
    expect(await repository.lastFinished()).toBeNull();
    expect(called('tblmail_sent_emails.findFirst')[0]).toMatchObject({
      where: { status: { in: ['sent', 'failed'] } },
      orderBy: { id: 'desc' },
    });
  });

  it('the three status moves write exactly their columns', async () => {
    const { repository, called } = stub();
    await repository.markRetrying(1, 2, T0, 'timeout', 'r', T0);
    await repository.markSent(1, 3, T0);
    await repository.markFailed(1, 8, 'auth_failed', null, T0);
    expect(
      called('tblmail_sent_emails.updateMany').map((a) => (a as { data: unknown }).data),
    ).toEqual([
      {
        status: 'retrying',
        attempts: 2,
        next_try_at: T0,
        failure_reason: 'timeout',
        server_reply: 'r',
        updated_at: T0,
      },
      {
        status: 'sent',
        attempts: 3,
        sent_at: T0,
        next_try_at: null,
        failure_reason: null,
        server_reply: null,
        updated_at: T0,
      },
      {
        status: 'failed',
        attempts: 8,
        next_try_at: null,
        failure_reason: 'auth_failed',
        server_reply: null,
        updated_at: T0,
      },
    ]);
  });

  it('queuedBefore reads non-test queued rows oldest first; purgeBefore deletes one batch by id, none when empty', async () => {
    const { repository, called } = stub({
      'tblmail_sent_emails.findMany': [[{ id: 4 }], [{ id: 1 }, { id: 2 }], []],
      'tblmail_sent_emails.deleteMany': [{ count: 2 }],
    });
    expect(await repository.queuedBefore(T0, 10)).toEqual([4]);
    expect(await repository.purgeBefore(T0, 2)).toBe(2);
    expect(await repository.purgeBefore(T0, 2)).toBe(0);
    expect(called('tblmail_sent_emails.findMany')).toEqual([
      {
        where: { status: 'queued', is_test: false, queued_at: { lt: T0 } },
        orderBy: [{ queued_at: 'asc' }, { id: 'asc' }],
        take: 10,
        select: { id: true },
      },
      { where: { queued_at: { lt: T0 } }, orderBy: { id: 'asc' }, take: 2, select: { id: true } },
      { where: { queued_at: { lt: T0 } }, orderBy: { id: 'asc' }, take: 2, select: { id: true } },
    ]);
    expect(called('tblmail_sent_emails.deleteMany')).toEqual([{ where: { id: { in: [1, 2] } } }]);
  });
});

describe('MailRepository: Perfex templates, read only', () => {
  it('reads one slug with findMany only and maps active 0/1 to a boolean', async () => {
    const { repository, calls } = stub({
      'tblemailtemplates.findMany': [
        [
          { language: 'english', subject: 'S', message: 'M', active: 1 },
          { language: null, subject: 'S', message: 'M', active: 0 },
        ],
      ],
    });
    expect((await repository.readPerfexTemplates('slug')).map((r) => r.active)).toEqual([
      true,
      false,
    ]);
    expect(calls).toEqual([
      {
        method: 'tblemailtemplates.findMany',
        args: {
          where: { slug: 'slug' },
          select: { language: true, subject: true, message: true, active: true },
        },
      },
    ]);
  });
});
