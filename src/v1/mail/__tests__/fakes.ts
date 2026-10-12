/**
 * Fakes for the mail specs. The email provider is faked at the PORT (PATTERNS M4: a v1 spec never
 * imports an adapter), the repository is replaced so no spec but the int spec reaches MySQL, and
 * the state store has an in-memory twin that passes the same contract as the Redis adapter.
 */
import { expect, it } from 'vitest';
import type {
  EmailMessage,
  EmailProviderPort,
  SendResult,
} from '../../../integrations/ports/email-provider.port.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import { LoggerService, type LogMeta } from '../../../shared/logger/logger.service.js';
import { BrandingFacade, type Branding } from '../../branding/index.js';
import type { IdentityFacade, StaffContact } from '../../identity/index.js';
import {
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
} from '../model/mail.model.js';
import { mailKeys, type MailStateStore } from '../repository/mail-state.store.js';
import type {
  MailTemplateListRequest,
  SentEmailListRequest,
  TemplateChange,
} from '../repository/mail.repository.js';
import type {
  MailAttachment,
  MailTemplateDefinition,
  ResolvedMail,
} from '../service/mail-template.registry.js';

/** What `TEST_DEFINITION` resolves record '1' to: synthetic values only. */
export const TEST_RESOLVED: ResolvedMail = {
  to: { email: 'staff@example.test', locale: null },
  values: { staff_name: 'Sample Staff', link: 'https://example.test/sample-record' },
};

/**
 * A synthetic template definition, registered only by specs (never in production code): one text
 * and one url merge field, the status test's wording as its fallback, and a resolver that knows
 * record '1' only.
 */
export const TEST_DEFINITION: MailTemplateDefinition = {
  key: 'zz_test_notice',
  module: 'zz_tests',
  audience: 'staff',
  mergeFields: [
    { token: 'staff_name', kind: 'text', sampleKey: 'sample_staff_name' },
    { token: 'link', kind: 'url', sampleKey: 'sample_link' },
  ],
  fallback: { subjectKey: 'status_test_subject', messageKey: 'status_test_message' },
  resolve: (sourceRef) => Promise.resolve(sourceRef === '1' ? TEST_RESOLVED : null),
};

/**
 * `TEST_DEFINITION` (under `key`) whose resolver also answers `attachments` for record '1'
 * (ADR-0052): the storage keys a spec stored itself, never a path.
 */
export function definitionWithAttachments(
  attachments: readonly MailAttachment[],
  key: string = TEST_DEFINITION.key,
): MailTemplateDefinition {
  return {
    ...TEST_DEFINITION,
    key,
    resolve: (sourceRef) =>
      Promise.resolve(sourceRef === '1' ? { ...TEST_RESOLVED, attachments } : null),
  };
}

/**
 * `EMAIL_PROVIDER` in the test app: records every message and answers `result`, or rejects with
 * `rejectWith` (the open breaker's `UpstreamUnavailableError`) without recording.
 */
export class FakeEmailProvider implements EmailProviderPort {
  readonly sent: EmailMessage[] = [];
  configured = true;
  result: SendResult = { ok: true };
  rejectWith: Error | null = null;

  send(message: EmailMessage): Promise<SendResult> {
    if (this.rejectWith !== null) return Promise.reject(this.rejectWith);
    this.sent.push(message);
    return Promise.resolve(this.result);
  }
}

/**
 * Stands in for `MailRepository` in the test app. Plans 04.3-05 to 04.3-07 add the methods their
 * service and e2e specs drive, each pushing to `calls`.
 */
export class FakeMailRepository {
  readonly calls: { readonly method: string; readonly args: readonly unknown[] }[] = [];
  /** The Node templates the fake holds; `createTemplate` appends. */
  readonly templates: MailTemplate[] = [];
  /** What `readPerfexTemplates` answers for any slug (synthetic rows only). */
  perfexRows: PerfexTemplateRow[] = [];
  /** `true`: `createTemplate` answers null, as when another process seeded the key first. */
  seededElsewhere = false;

  findTemplateById(id: number): Promise<MailTemplate | null> {
    this.calls.push({ method: 'findTemplateById', args: [id] });
    return Promise.resolve(this.templates.find((template) => template.id === id) ?? null);
  }

  findTemplateByKey(key: string): Promise<MailTemplate | null> {
    this.calls.push({ method: 'findTemplateByKey', args: [key] });
    return Promise.resolve(this.templates.find((template) => template.key === key) ?? null);
  }

  readPerfexTemplates(slug: string): Promise<PerfexTemplateRow[]> {
    this.calls.push({ method: 'readPerfexTemplates', args: [slug] });
    return Promise.resolve([...this.perfexRows]);
  }

  createTemplate(input: {
    readonly key: string;
    readonly module: string;
    readonly active: boolean;
    readonly formattingDropped: boolean;
    readonly versions: readonly MailTemplateVersion[];
  }): Promise<MailTemplate | null> {
    this.calls.push({ method: 'createTemplate', args: [input] });
    if (this.seededElsewhere) return Promise.resolve(null);
    const template = templateOf(this.templates.length + 1, input);
    this.templates.push(template);
    return Promise.resolve(template);
  }

  /** The sent-email rows the fake holds; `insertSent` appends, the marks replace. */
  readonly sent: SentEmail[] = [];
  /** Set: `insertSent` rejects with it. */
  insertSentFails: Error | null = null;
  /** What `queuedBefore` answers. */
  queuedIds: number[] = [];
  /** What successive `purgeBefore` calls answer; 0 once used up. */
  purgeBatches: number[] = [];

  insertSent(
    row: NewSentEmail,
    now: Date,
  ): Promise<{ readonly row: SentEmail; readonly created: boolean }> {
    this.calls.push({ method: 'insertSent', args: [row, now] });
    if (this.insertSentFails !== null) return Promise.reject(this.insertSentFails);
    const existing =
      row.dedupeKey === null ? undefined : this.sent.find((s) => s.dedupeKey === row.dedupeKey);
    if (existing !== undefined) return Promise.resolve({ row: existing, created: false });
    const created = sentOf(this.sent.length + 1, row, now);
    this.sent.push(created);
    return Promise.resolve({ row: created, created: true });
  }

  findSent(id: number): Promise<SentEmail | null> {
    this.calls.push({ method: 'findSent', args: [id] });
    return Promise.resolve(this.sent.find((row) => row.id === id) ?? null);
  }

  markSent(id: number, attempts: number, at: Date): Promise<void> {
    this.calls.push({ method: 'markSent', args: [id, attempts, at] });
    this.patch(id, {
      status: 'sent',
      attempts,
      sentAt: at,
      nextTryAt: null,
      failureReason: null,
      serverReply: null,
    });
    return Promise.resolve();
  }

  markRetrying(
    id: number,
    attempts: number,
    nextTryAt: Date,
    reason: MailFailureReason,
    serverReply: string | null,
    at: Date,
  ): Promise<void> {
    this.calls.push({
      method: 'markRetrying',
      args: [id, attempts, nextTryAt, reason, serverReply, at],
    });
    this.patch(id, { status: 'retrying', attempts, nextTryAt, failureReason: reason, serverReply });
    return Promise.resolve();
  }

  markFailed(
    id: number,
    attempts: number,
    reason: MailFailureReason,
    serverReply: string | null,
    at: Date,
  ): Promise<void> {
    this.calls.push({ method: 'markFailed', args: [id, attempts, reason, serverReply, at] });
    this.patch(id, {
      status: 'failed',
      attempts,
      nextTryAt: null,
      failureReason: reason,
      serverReply,
    });
    return Promise.resolve();
  }

  queuedBefore(cutoff: Date, limit: number): Promise<number[]> {
    this.calls.push({ method: 'queuedBefore', args: [cutoff, limit] });
    return Promise.resolve([...this.queuedIds]);
  }

  purgeBefore(cutoff: Date, batchSize: number): Promise<number> {
    this.calls.push({ method: 'purgeBefore', args: [cutoff, batchSize] });
    return Promise.resolve(this.purgeBatches.shift() ?? 0);
  }

  // --- the screens (plan 04.3-07): the wire only; the SQL is mail.repository.int.spec.ts' ----------

  /** Filters like the repository, sorts by the field then the id, one page of at most `limit`. */
  listTemplates(request: MailTemplateListRequest): Promise<MailTemplatePage> {
    this.calls.push({ method: 'listTemplates', args: [request] });
    const field = request.sortField;
    const direction = request.order === 'asc' ? 1 : -1;
    const items = this.templates
      .filter((t) => request.modules.length === 0 || request.modules.includes(t.module))
      .filter((t) => request.active === null || t.active === request.active)
      .filter((t) => request.search === null || t.key.includes(request.search))
      .sort((a, b) => direction * (a[field].localeCompare(b[field]) || a.id - b.id))
      .map(listItemOf);
    return Promise.resolve(pageOf(items.slice(0, request.limit), items.length));
  }

  templateModules(): Promise<string[]> {
    this.calls.push({ method: 'templateModules', args: [] });
    return Promise.resolve([...new Set(this.templates.map((t) => t.module))].sort());
  }

  templateActivity(keys: readonly string[]): Promise<ReadonlyMap<string, boolean>> {
    this.calls.push({ method: 'templateActivity', args: [keys] });
    const stored = this.templates.filter((t) => keys.includes(t.key));
    return Promise.resolve(new Map(stored.map((t) => [t.key, t.active])));
  }

  templateKeys(): Promise<string[]> {
    this.calls.push({ method: 'templateKeys', args: [] });
    return Promise.resolve(this.templates.map((t) => t.key).sort());
  }

  /** The repository's contract: `assertCurrent` throws to abort, and then nothing is written. */
  saveTemplate(
    id: number,
    assertCurrent: (current: MailTemplate) => void,
    change: TemplateChange,
  ): Promise<MailTemplate | null> {
    this.calls.push({ method: 'saveTemplate', args: [id, change] });
    const index = this.templates.findIndex((t) => t.id === id);
    const current = this.templates[index];
    if (current === undefined) return Promise.resolve(null);
    assertCurrent(current);
    const kept = current.versions.filter((v) => !Object.hasOwn(change.versions, v.locale));
    const written = Object.entries(change.versions).flatMap(([locale, version]) =>
      version === null ? [] : [{ locale, ...version }],
    );
    const saved: MailTemplate = {
      ...current,
      active: change.active,
      formattingDropped: false,
      updatedByStaffId: change.staffId,
      versions: [...kept, ...written].sort((a, b) => a.locale.localeCompare(b.locale)),
    };
    this.templates[index] = saved;
    return Promise.resolve(saved);
  }

  setActive(id: number, active: boolean, staffId: number): Promise<MailTemplate | null> {
    this.calls.push({ method: 'setActive', args: [id, active, staffId] });
    const index = this.templates.findIndex((t) => t.id === id);
    const current = this.templates[index];
    if (current === undefined) return Promise.resolve(null);
    const saved = { ...current, active, updatedByStaffId: staffId };
    this.templates[index] = saved;
    return Promise.resolve(saved);
  }

  setActiveByModule(module: string, active: boolean, staffId: number): Promise<number> {
    this.calls.push({ method: 'setActiveByModule', args: [module, active, staffId] });
    let changed = 0;
    this.templates.forEach((t, index) => {
      if (t.module !== module || t.active === active) return;
      this.templates[index] = { ...t, active, updatedByStaffId: staffId };
      changed += 1;
    });
    return Promise.resolve(changed);
  }

  /** Filters like the repository (`status-test` is a null key), newest first unless asked. */
  listSent(request: SentEmailListRequest): Promise<SentEmailPage> {
    this.calls.push({ method: 'listSent', args: [request] });
    const direction = request.order === 'asc' ? 1 : -1;
    const keys = request.templates;
    const items = this.sent
      .filter(
        (row) =>
          keys.length === 0 ||
          (row.templateKey === null
            ? keys.includes(STATUS_TEST_FILTER)
            : keys.includes(row.templateKey)),
      )
      .filter((row) => request.statuses.length === 0 || request.statuses.includes(row.status))
      .filter(
        (row) =>
          request.recipientPrefix === null ||
          row.recipientEmail.startsWith(request.recipientPrefix),
      )
      .sort((a, b) => direction * (a.queuedAt.getTime() - b.queuedAt.getTime() || a.id - b.id));
    return Promise.resolve(pageOf(items.slice(0, request.limit), items.length));
  }

  lastFinished(): Promise<SentEmail | null> {
    this.calls.push({ method: 'lastFinished', args: [] });
    const finished = this.sent.filter((row) => row.status === 'sent' || row.status === 'failed');
    return Promise.resolve(finished.sort((a, b) => b.id - a.id)[0] ?? null);
  }

  /** The methods called, in order. */
  methods(): string[] {
    return this.calls.map((call) => call.method);
  }

  private patch(id: number, changes: Partial<SentEmail>): void {
    const index = this.sent.findIndex((row) => row.id === id);
    const current = this.sent[index];
    if (current !== undefined) this.sent[index] = { ...current, ...changes };
  }
}

/** A template as a list row. */
function listItemOf(template: MailTemplate): MailTemplateListItem {
  return {
    id: template.id,
    key: template.key,
    module: template.module,
    active: template.active,
    locales: template.versions.map((version) => version.locale),
  };
}

/** One page with no further page: the fake never pages. */
function pageOf<T>(
  items: readonly T[],
  total: number,
): {
  items: readonly T[];
  nextCursor: null;
  prevCursor: null;
  total: number;
  rangeStart: number;
} {
  return { items, nextCursor: null, prevCursor: null, total, rangeStart: items.length > 0 ? 1 : 0 };
}

/** A stored sent-email row as the repository answers it. */
export function sentOf(id: number, row: NewSentEmail, now: Date): SentEmail {
  return {
    id,
    ...row,
    attempts: 0,
    nextTryAt: null,
    serverReply: null,
    queuedAt: now,
    sentAt: null,
    updatedAt: now,
  };
}

/** One `QueueService.add` call. */
export interface AddedJob {
  readonly queue: string;
  readonly name: string;
  readonly data: unknown;
  readonly options: { readonly jobId?: string; readonly delayMs?: number };
}

/**
 * Stands in for `QueueService` (and `ProcessorRegistry`): records every `add`, also into `log` when
 * given (the repository fake's `calls`, so a spec sees the order), and rejects with `failWith`.
 */
export class FakeQueueService {
  readonly added: AddedJob[] = [];
  readonly registered: string[] = [];
  failWith: Error | null = null;

  constructor(private readonly log?: { method: string; args: readonly unknown[] }[]) {}

  add(
    queue: string,
    name: string,
    data: unknown,
    options: { readonly jobId?: string; readonly delayMs?: number } = {},
  ): Promise<string> {
    this.log?.push({ method: 'add', args: [queue, name, data, options] });
    if (this.failWith !== null) return Promise.reject(this.failWith);
    this.added.push({ queue, name, data, options });
    return Promise.resolve(options.jobId ?? String(this.added.length));
  }

  registerProcessor(processor: { readonly queue: string }): void {
    this.registered.push(processor.queue);
  }
}

/** A stub `IdentityFacade` answering `contactOf` from `contacts` (synthetic addresses only). */
export function identityFacadeOf(
  contacts: ReadonlyMap<number, StaffContact> = new Map(),
): IdentityFacade {
  const stub = { contactOf: (staffId: number) => Promise.resolve(contacts.get(staffId) ?? null) };
  return stub as unknown as IdentityFacade;
}

/** A stored template as the repository answers it (stamps fixed, versions ordered by locale). */
export function templateOf(
  id: number,
  input: {
    readonly key: string;
    readonly module: string;
    readonly active: boolean;
    readonly formattingDropped: boolean;
    readonly versions: readonly MailTemplateVersion[];
  },
): MailTemplate {
  const at = new Date('2026-10-02T08:00:00.000Z');
  return {
    id,
    ...input,
    versions: [...input.versions].sort((a, b) => a.locale.localeCompare(b.locale)),
    updatedByStaffId: null,
    createdAt: at,
    updatedAt: at,
  };
}

/** One logger call: its level, message and meta. */
export interface LoggedLine {
  readonly level: 'log' | 'warn' | 'error';
  readonly message: string;
  readonly meta: LogMeta | undefined;
}

/** Silent, and records every log, warn and error line so a spec can assert what a line carries. */
export class RecordingLogger extends LoggerService {
  readonly lines: LoggedLine[] = [];

  override log(message: string, meta?: LogMeta): void {
    this.lines.push({ level: 'log', message, meta });
  }
  override warn(message: string, meta?: LogMeta): void {
    this.lines.push({ level: 'warn', message, meta });
  }
  override error(message: string, meta?: LogMeta): void {
    this.lines.push({ level: 'error', message, meta });
  }
  override debug(): void {
    /* silent */
  }
}

/** The public base URL the test config carries. */
export const TEST_PUBLIC_BASE_URL = 'http://localhost:8088';

/** A synthetic brand: no customer's name or logo. */
export const TEST_BRANDING: Branding = {
  companyName: 'Company One',
  logoFile: 'logo.png',
  logoDarkFile: null,
  defaultLocale: 'en',
  formats: {
    dateFormat: 'Y-m-d',
    timeFormat: '24',
    thousandSeparator: ',',
    decimalSeparator: '.',
    decimalPlaces: 2,
    removeDecimalsOnZero: false,
    timeZone: null,
    currency: null,
  },
};

/** The real `BrandingFacade` (its own `logoPathOf`) over a stub service answering `branding`. */
export function brandingFacadeOf(branding: Branding = TEST_BRANDING): BrandingFacade {
  const service = { current: () => Promise.resolve(branding) };
  return new BrandingFacade(service as unknown as ConstructorParameters<typeof BrandingFacade>[0]);
}

/** What the state-store contract drives: a store, its window, a way to let time pass, its keys. */
export interface MailStateHarness {
  readonly store: MailStateStore;
  /** The test-send window this store counts in. */
  readonly testWindowMs: number;
  /** Lets `ms` pass for the store (a fake clock, or a real wait). */
  readonly elapse: (ms: number) => Promise<void>;
  /** Whether the store holds `key` now. */
  readonly has: (key: string) => Promise<boolean>;
}

/**
 * The `MailStateStore` contract (BE-17 "Instead"): the in-memory twin and the Redis adapter both
 * pass it. Staff 7 and the server flag are the only keys it writes.
 */
export function mailStateStoreContract(make: () => MailStateHarness): void {
  const STAFF = 7;

  it('spells the keys exactly', () => {
    expect(mailKeys.serverUnreachableSince()).toBe('mail:server:unreachableSince');
    expect(mailKeys.testCount(STAFF)).toBe('mail:test:7');
  });

  it('marks the server unreachable once: a second mark keeps the first time; clear forgets it', async () => {
    const { store, has } = make();
    const t1 = new Date('2026-10-02T08:00:00.000Z');
    const t2 = new Date('2026-10-02T08:05:00.000Z');
    expect(await store.serverUnreachableSince()).toBeNull();
    await store.markServerUnreachable(t1);
    await store.markServerUnreachable(t2);
    expect(await store.serverUnreachableSince()).toEqual(t1);
    expect(await has('mail:server:unreachableSince')).toBe(true);
    await store.clearServerUnreachable();
    expect(await store.serverUnreachableSince()).toBeNull();
    expect(await has('mail:server:unreachableSince')).toBe(false);
  });

  it('counts test sends 1, 2, 3 inside the window, then restarts at 1', async () => {
    const { store, testWindowMs, elapse, has } = make();
    const counts: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { count, retryAfterMs } = await store.countTest(STAFF);
      counts.push(count);
      expect(retryAfterMs).toBeGreaterThan(0);
      expect(retryAfterMs).toBeLessThanOrEqual(testWindowMs);
    }
    expect(counts).toEqual([1, 2, 3]);
    expect(await has('mail:test:7')).toBe(true);
    await elapse(testWindowMs + 1);
    expect((await store.countTest(STAFF)).count).toBe(1);
  });

  it('keeps the window fixed from the first count: a later count never extends it', async () => {
    const { store, testWindowMs, elapse } = make();
    expect((await store.countTest(STAFF)).count).toBe(1);
    await elapse(testWindowMs / 2);
    const second = await store.countTest(STAFF);
    expect(second.count).toBe(2);
    expect(second.retryAfterMs).toBeLessThanOrEqual(testWindowMs / 2);
    await elapse(testWindowMs / 2 + 1);
    expect((await store.countTest(STAFF)).count).toBe(1);
  });
}

/** The in-memory twin of `RedisMailStateStore`: the same keys and expiries over an injected clock. */
export class InMemoryMailStateStore implements MailStateStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly testWindowMs: number = TIMINGS.mail.testWindowMs,
  ) {}

  /** The live keys, for the contract's `has`. */
  keys(): string[] {
    return [...this.entries.keys()].filter((key) => this.read(key) !== null);
  }

  markServerUnreachable(at: Date): Promise<void> {
    const key = mailKeys.serverUnreachableSince();
    if (this.read(key) === null) {
      this.entries.set(key, {
        value: at.toISOString(),
        expiresAt: this.now() + TIMINGS.mail.serverStateTtlMs,
      });
    }
    return Promise.resolve();
  }

  clearServerUnreachable(): Promise<void> {
    this.entries.delete(mailKeys.serverUnreachableSince());
    return Promise.resolve();
  }

  serverUnreachableSince(): Promise<Date | null> {
    const raw = this.read(mailKeys.serverUnreachableSince());
    return Promise.resolve(raw === null ? null : new Date(raw));
  }

  countTest(staffId: number): Promise<{ readonly count: number; readonly retryAfterMs: number }> {
    const key = mailKeys.testCount(staffId);
    const current = this.read(key);
    const expiresAt =
      current === null
        ? this.now() + this.testWindowMs
        : (this.entries.get(key)?.expiresAt ?? this.now());
    const count = (current === null ? 0 : Number(current)) + 1;
    this.entries.set(key, { value: String(count), expiresAt });
    return Promise.resolve({ count, retryAfterMs: Math.max(0, expiresAt - this.now()) });
  }

  private read(key: string): string | null {
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }
}
