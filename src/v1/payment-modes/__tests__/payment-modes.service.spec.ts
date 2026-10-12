/**
 * PaymentModesService over the real validator, transformer and transport, the seeded in-memory
 * fake, a fixed clock, the recording logger and the settings fake answering
 * `expense_credit_payment_mode`. Administrators first: on a 403 neither the repository nor the
 * settings facade is called. D-34: a create stores the description through `nl2br_save_html` and
 * each box as 0 or 1; an update rewrites all seven. Each change publishes exactly one event AFTER
 * the write and writes exactly one `log` line with `{ id }` (D-36, F1: `log`, never `info`); a 400,
 * 403, 404 or 409 publishes and logs nothing, and an unchanged switch writes, publishes and logs
 * nothing. The delete reads the credit option BEFORE the usage (D-37: the usage is never read when
 * 0002 answers), refuses with 0001 naming the non-zero groups in order, and fails closed when the
 * usage answer does not name the id. The facade reads assert nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CSV_BOM } from '../../../shared/http/csv.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import type { SettingsFacade } from '../../settings/index.js';
import {
  PaymentModesActiveChangedV1,
  PaymentModesCreatedV1,
  PaymentModesDeletedV1,
  PaymentModesUpdatedV1,
} from '../events/published.js';
import { PaymentModesService } from '../service/payment-modes.service.js';
import { PaymentModesTransformer } from '../service/payment-modes.transformer.js';
import { PaymentModesTransport } from '../service/payment-modes.transport.js';
import { PaymentModesValidator } from '../service/payment-modes.validator.js';
import {
  RecordingLogger,
  settingsWithCreditMode,
  TEST_NOW,
} from './create-payment-modes-test-app.js';
import {
  asRepository,
  seededStore,
  ZERO_USAGE,
  type InMemoryPaymentModesRepository,
} from './fakes.js';

const AT = TEST_NOW.toISOString();
const EXPIRY_S = 4_102_444_800;
const SWITCH_OFF = 'switch it off instead to stop offering it';

function actor(isAdmin: boolean): AuthenticatedUser {
  return {
    staffId: isAdmin ? 5 : 2,
    sessionId: 'sid',
    jti: 'jti',
    isAdmin,
    roleId: null,
    tokenVersion: 0,
    expiresAt: EXPIRY_S,
  };
}

const ADMIN = actor(true);
const MEMBER = actor(false);

function build(credit: string | null = null) {
  const repo = seededStore();
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();
  const settings = settingsWithCreditMode(credit);
  const service = new PaymentModesService(
    new PaymentModesValidator(),
    asRepository(repo),
    new PaymentModesTransformer(),
    new PaymentModesTransport(events, settings as unknown as SettingsFacade),
    logger,
  );
  service.now = () => TEST_NOW;
  return { service, repo, events, logger, settings };
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

/** Every repository method spied, so a case can assert none was called. */
function spyAll(repo: InMemoryPaymentModesRepository) {
  return [
    vi.spyOn(repo, 'list'),
    vi.spyOn(repo, 'count'),
    vi.spyOn(repo, 'findById'),
    vi.spyOn(repo, 'create'),
    vi.spyOn(repo, 'update'),
    vi.spyOn(repo, 'setActive'),
    vi.spyOn(repo, 'remove'),
    vi.spyOn(repo, 'usageByPaymentMode'),
    vi.spyOn(repo, 'listAll'),
    vi.spyOn(repo, 'findByIds'),
  ];
}

describe('PaymentModesService: administrators only (D-06, D-32)', () => {
  const calls: readonly (readonly [string, (service: PaymentModesService) => Promise<unknown>])[] =
    [
      ['list', (service) => service.list(MEMBER, {})],
      ['get', (service) => service.get(MEMBER, { id: '1' })],
      ['create', (service) => service.create(MEMBER, { name: 'X' })],
      ['update', (service) => service.update(MEMBER, { id: '1' }, { name: 'X' })],
      ['setActive', (service) => service.setActive(MEMBER, { id: '1' }, { active: false })],
      ['remove', (service) => service.remove(MEMBER, { id: '1' })],
      ['exportCsv', (service) => service.exportCsv(MEMBER, {})],
    ];

  it.each(calls)(
    '%s refuses a non-administrator with ERP-AUTH-0005 before any repository or settings call, publishing and logging nothing',
    async (_name, call) => {
      const { service, repo, events, logger, settings } = build('1');
      const spies = spyAll(repo);
      const error = await refusal(call(service));
      expect(error.code).toBe('ERP-AUTH-0005');
      expect(error.message).toBe('payment modes are managed by administrators only');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(settings.calls).toEqual([]);
      expect(events.count).toBe(0);
      expect(logger.lines).toEqual([]);
    },
  );
});

describe('PaymentModesService: reads', () => {
  it('lists the name ascending with each row usage and lock, reading the usage and the setting once per page', async () => {
    const { service, repo, settings } = build('3');
    repo.usage.set(1, { ...ZERO_USAGE, expenses: 2 });
    const usage = vi.spyOn(repo, 'usageByPaymentMode');
    const page = await service.list(ADMIN, {});
    expect(page.data.map((row) => [row.id, row.usage.expenses, row.isCreditExpenseMode])).toEqual([
      ['1', 2, false],
      ['3', 0, true],
      ['2', 0, false],
    ]);
    expect(usage).toHaveBeenCalledTimes(1);
    expect(usage).toHaveBeenCalledWith([1, 3, 2]);
    expect(settings.calls).toEqual([['expense_credit_payment_mode']]);
  });

  it('get answers the record with its usage and lock, or ERP-CORE-0004', async () => {
    const { service, repo } = build(' 2');
    repo.usage.set(2, { ...ZERO_USAGE, fixedEquipmentRefunds: 4 });
    expect(await service.get(ADMIN, { id: '2' })).toEqual({
      id: '2',
      name: 'Cash',
      description: '',
      active: false,
      showOnPdf: false,
      selectedByDefault: false,
      invoicesOnly: false,
      expensesOnly: true,
      usage: { ...ZERO_USAGE, fixedEquipmentRefunds: 4 },
      isCreditExpenseMode: true,
    });
    expect((await refusal(service.get(ADMIN, { id: '404' }))).code).toBe('ERP-CORE-0004');
  });

  it('exports the four columns in list order, never reading the usage or the setting', async () => {
    const { service, repo, settings } = build('1');
    const usage = vi.spyOn(repo, 'usageByPaymentMode');
    const { body } = await service.exportCsv(ADMIN, {});
    if (typeof body !== 'string') throw new Error('the export answered no CSV text');
    expect(body.replace(CSV_BOM, '').split('\r\n').slice(0, 4)).toEqual([
      'id,name,description,active',
      '1,Bank,,1',
      '3,Bank,"Line one\nline two",1',
      '2,Cash,,0',
    ]);
    expect(usage).not.toHaveBeenCalled();
    expect(settings.calls).toEqual([]);
  });
});

describe('PaymentModesService: create and update (D-34)', () => {
  it('create stores the description through nl2br_save_html and the five boxes as 0 or 1; one event after the write, one log line', async () => {
    const { service, repo, events, logger } = build();
    const create = vi.spyOn(repo, 'create');
    const created = await service.create(ADMIN, {
      name: 'Cash < 50',
      description: 'One\ntwo',
      showOnPdf: true,
      expensesOnly: true,
    });
    expect(create).toHaveBeenCalledWith({
      name: 'Cash < 50',
      description: 'One<br />\ntwo',
      active: false,
      showOnPdf: 1,
      selectedByDefault: 0,
      invoicesOnly: 0,
      expensesOnly: 1,
    });
    expect(created).toMatchObject({ description: 'One\ntwo', usage: ZERO_USAGE });
    const id = Number(created.id);
    const published = events.drain();
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(PaymentModesCreatedV1);
    expect(published[0]?.payload).toEqual({ id, at: AT });
    expect(logger.lines).toEqual([{ message: 'payment mode created', meta: { id } }]);
  });

  it('a body with no description stores the empty string; a duplicate name is accepted', async () => {
    const { service, repo } = build();
    const create = vi.spyOn(repo, 'create');
    expect((await service.create(ADMIN, { name: 'Bank', active: true })).name).toBe('Bank');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ description: '', active: true }));
  });

  it('a body carrying showToClient is a 400: nothing written, nothing published or logged', async () => {
    const { service, repo, events, logger } = build();
    const create = vi.spyOn(repo, 'create');
    const error = await refusal(service.create(ADMIN, { name: 'X', showToClient: true }));
    expect(error.code).toBe('ERP-VALIDATION-0001');
    expect(create).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });

  it('update rewrites all seven fields: exactly one event after the write and one log line', async () => {
    const { service, repo, events, logger } = build();
    const update = vi.spyOn(repo, 'update');
    await service.update(ADMIN, { id: '1' }, { name: 'Bank 2', invoicesOnly: true });
    expect(update).toHaveBeenCalledWith(1, {
      name: 'Bank 2',
      description: '',
      active: false,
      showOnPdf: 0,
      selectedByDefault: 0,
      invoicesOnly: 1,
      expensesOnly: 0,
    });
    const published = events.drain();
    expect(published.map((event) => event.constructor)).toEqual([PaymentModesUpdatedV1]);
    expect(published[0]?.payload).toEqual({ id: 1, at: AT });
    expect(logger.lines).toEqual([{ message: 'payment mode updated', meta: { id: 1 } }]);
  });

  it('update of the credit-expense mode or a mode in use is allowed (D-37 guards the delete only)', async () => {
    const { service, repo } = build('3');
    repo.usage.set(3, { ...ZERO_USAGE, expenses: 9 });
    expect(await service.update(ADMIN, { id: '3' }, { name: 'Renamed' })).toMatchObject({
      name: 'Renamed',
      isCreditExpenseMode: true,
    });
  });

  it('a missing id is 404 and neither publishes nor logs; {} is a 400 before the row is touched', async () => {
    const { service, repo, events, logger } = build();
    expect((await refusal(service.update(ADMIN, { id: '404' }, { name: 'X' }))).code).toBe(
      'ERP-CORE-0004',
    );
    const update = vi.spyOn(repo, 'update');
    expect((await refusal(service.update(ADMIN, { id: '1' }, {}))).code).toBe(
      'ERP-VALIDATION-0001',
    );
    expect(update).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });
});

describe('PaymentModesService: setActive (D-34)', () => {
  it('a changed flag writes active only, publishes one ActiveChanged and logs once', async () => {
    const { service, repo, events, logger } = build();
    const write = vi.spyOn(repo, 'setActive');
    expect(await service.setActive(ADMIN, { id: '1' }, { active: false })).toEqual({
      id: '1',
      active: false,
    });
    expect(write).toHaveBeenCalledWith(1, false);
    const published = events.drain();
    expect(published.map((event) => event.constructor)).toEqual([PaymentModesActiveChangedV1]);
    expect(published[0]?.payload).toEqual({ id: 1, active: false, at: AT });
    expect(logger.lines).toEqual([{ message: 'payment mode deactivated', meta: { id: 1 } }]);
    await service.setActive(ADMIN, { id: '1' }, { active: true });
    expect(logger.lines.at(-1)).toEqual({ message: 'payment mode activated', meta: { id: 1 } });
  });

  it('an unchanged flag answers { id, active } with no write, no event and no log line', async () => {
    const { service, repo, events, logger } = build();
    const write = vi.spyOn(repo, 'setActive');
    expect(await service.setActive(ADMIN, { id: '2' }, { active: false })).toEqual({
      id: '2',
      active: false,
    });
    expect(write).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });

  it('a missing id is 404, and a row gone before the write is 404 too; a bad body is 400', async () => {
    const { service, repo, events } = build();
    expect((await refusal(service.setActive(ADMIN, { id: '404' }, { active: true }))).code).toBe(
      'ERP-CORE-0004',
    );
    vi.spyOn(repo, 'setActive').mockResolvedValueOnce(false);
    expect((await refusal(service.setActive(ADMIN, { id: '1' }, { active: false }))).code).toBe(
      'ERP-CORE-0004',
    );
    expect((await refusal(service.setActive(ADMIN, { id: '1' }, { active: 'no' }))).code).toBe(
      'ERP-VALIDATION-0001',
    );
    expect(events.count).toBe(0);
  });
});

describe('PaymentModesService: remove (D-33, D-37)', () => {
  it('deletes an unused mode the option does not name: exactly one event after the delete and one log line with { id }', async () => {
    const { service, repo, events, logger } = build('3');
    await service.remove(ADMIN, { id: '2' });
    expect(await repo.findById(2)).toBeNull();
    const published = events.drain();
    expect(published.map((event) => event.constructor)).toEqual([PaymentModesDeletedV1]);
    expect(published[0]?.payload).toEqual({ id: 2, at: AT });
    expect(logger.lines).toEqual([{ message: 'payment mode deleted', meta: { id: 2 } }]);
  });

  it('the credit lock is read before the usage: 0002 answers and the usage is never read', async () => {
    const { service, repo, events, logger, settings } = build('2');
    const usage = vi.spyOn(repo, 'usageByPaymentMode');
    const remove = vi.spyOn(repo, 'remove');
    const error = await refusal(service.remove(ADMIN, { id: '2' }));
    expect(error.code).toBe('ERP-PAYMENTMODES-0002');
    expect(error.message).toBe(
      `expenses use this payment mode to mark a credit expense (a Perfex setting), so it cannot be deleted; ${SWITCH_OFF}`,
    );
    expect(usage).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(settings.calls).toEqual([['expense_credit_payment_mode']]);
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });

  it('a usage answer without the id fails closed: 409 ERP-PAYMENTMODES-0001, nothing deleted', async () => {
    const { service, repo, events, logger } = build();
    vi.spyOn(repo, 'usageByPaymentMode').mockResolvedValueOnce(new Map());
    const remove = vi.spyOn(repo, 'remove');
    const error = await refusal(service.remove(ADMIN, { id: '2' }));
    expect(error.code).toBe('ERP-PAYMENTMODES-0001');
    expect(error.message).toBe('its use could not be counted');
    expect(remove).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });

  it('a usage read that rejects refuses too: nothing deleted', async () => {
    const { service, repo } = build();
    vi.spyOn(repo, 'usageByPaymentMode').mockRejectedValueOnce(new Error('lock wait timeout'));
    const remove = vi.spyOn(repo, 'remove');
    await expect(service.remove(ADMIN, { id: '2' })).rejects.toThrow('lock wait timeout');
    expect(remove).not.toHaveBeenCalled();
  });

  it('in use: 409 naming only the non-zero groups, in order, then the switch-off advice; nothing deleted', async () => {
    const { service, repo, events } = build();
    repo.usage.set(2, {
      invoicePayments: 1,
      expenses: 2,
      creditNoteRefunds: 3,
      purchaseInvoicePayments: 4,
      purchaseOrderPayments: 5,
      debitNoteRefunds: 6,
      fixedEquipmentRefunds: 7,
      orderReturnRefunds: 8,
    });
    const all = await refusal(service.remove(ADMIN, { id: '2' }));
    expect(all.code).toBe('ERP-PAYMENTMODES-0001');
    expect(all.message).toBe(
      `used by 1 invoice payment(s), 2 expense(s), 3 credit note refund(s), 4 purchase invoice payment(s), 5 purchase order payment(s), 6 debit note refund(s), 7 fixed equipment refund(s) and 8 order return refund(s); ${SWITCH_OFF}`,
    );
    repo.usage.set(2, { ...ZERO_USAGE, debitNoteRefunds: 1 });
    expect((await refusal(service.remove(ADMIN, { id: '2' }))).message).toBe(
      `used by 1 debit note refund(s); ${SWITCH_OFF}`,
    );
    expect(await repo.findById(2)).not.toBeNull();
    expect(events.count).toBe(0);
  });

  it('a missing id is 404 before the option or the usage is read, and a row gone at the delete is 404 too', async () => {
    const { service, repo, events, logger, settings } = build();
    const usage = vi.spyOn(repo, 'usageByPaymentMode');
    expect((await refusal(service.remove(ADMIN, { id: '404' }))).code).toBe('ERP-CORE-0004');
    expect(usage).not.toHaveBeenCalled();
    expect(settings.calls).toEqual([]);
    vi.spyOn(repo, 'remove').mockResolvedValueOnce(false);
    expect((await refusal(service.remove(ADMIN, { id: '2' }))).code).toBe('ERP-CORE-0004');
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });
});

describe('PaymentModesService: the facade reads assert nothing', () => {
  it('findById, listAll and findByIds answer PaymentMode without an actor', async () => {
    const { service, settings } = build();
    expect(service.describe()).toEqual({ module: 'payment-modes', version: 1 });
    expect(await service.findById(2)).toEqual({
      id: 2,
      name: 'Cash',
      active: false,
      invoicesOnly: false,
      expensesOnly: true,
      selectedByDefault: false,
      showOnPdf: false,
    });
    expect(await service.findById(404)).toBeNull();
    expect((await service.listAll()).map((mode) => mode.id)).toEqual([1, 3, 2]);
    expect((await service.findByIds([3, 404, 2, 3])).map((mode) => mode.id)).toEqual([3, 2]);
    expect(await service.findByIds([])).toEqual([]);
    expect(settings.calls).toEqual([]);
  });
});

describe('the fake repository', () => {
  it('pages the name ascending both ways with limit 1, ties on the id', async () => {
    const repo = seededStore();
    const base = { search: null, sortField: 'name', order: 'asc', limit: 1 } as const;
    const first = await repo.list({ ...base, cursor: null });
    const second = await repo.list({ ...base, cursor: decodeCursor(first.nextCursor, 'name') });
    const third = await repo.list({ ...base, cursor: decodeCursor(second.nextCursor, 'name') });
    expect([first, second, third].map((page) => page.items[0]?.id)).toEqual([1, 3, 2]);
    const back = await repo.list({ ...base, cursor: decodeCursor(third.prevCursor, 'name') });
    expect(back.items[0]?.id).toBe(3);
  });

  it('accepts a duplicate name, and setActive changes only active', async () => {
    const repo = seededStore();
    const twin = await repo.create({
      name: 'Bank',
      description: '',
      active: true,
      showOnPdf: 1,
      selectedByDefault: 0,
      invoicesOnly: 0,
      expensesOnly: 0,
    });
    expect(twin.id).toBe(4);
    const before = await repo.findById(3);
    expect(await repo.setActive(3, false)).toBe(true);
    expect(await repo.findById(3)).toEqual({ ...before, active: false });
    expect(await repo.setActive(404, false)).toBe(false);
  });
});
