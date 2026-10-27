import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CSV_BOM } from '../../../shared/http/csv.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import type { SettingsFacade } from '../../settings/index.js';
import {
  TicketStatusCreatedV1,
  TicketStatusDeletedV1,
  TicketStatusUpdatedV1,
} from '../events/published.js';
import type {
  NewTicketStatus,
  TicketStatus,
  TicketStatusPatch,
} from '../model/ticket-statuses.model.js';
import { TicketStatusesFacade } from '../facade/ticket-statuses.facade.js';
import { TicketStatusesRepository } from '../repository/ticket-statuses.repository.js';
import { TicketStatusesService } from '../service/ticket-statuses.service.js';
import { TicketStatusesTransformer } from '../service/ticket-statuses.transformer.js';
import { TicketStatusesTransport } from '../service/ticket-statuses.transport.js';
import { TicketStatusesValidator } from '../service/ticket-statuses.validator.js';

const FAR_FUTURE = 4_102_444_800;
const NOW = new Date('2026-10-24T10:30:00.000Z');
const ADMIN: AuthenticatedUser = {
  staffId: 1,
  sessionId: 'admin-session',
  jti: 'admin-jti',
  isAdmin: true,
  roleId: null,
  tokenVersion: 0,
  expiresAt: FAR_FUTURE,
};
const MEMBER: AuthenticatedUser = { ...ADMIN, staffId: 2, isAdmin: false };

const ROWS: readonly TicketStatus[] = [
  {
    ticketstatusid: 1,
    name: 'Open',
    isdefault: 1,
    statuscolor: '#03a9f4',
    statusorder: 1,
    ticket_count: 0,
  },
  {
    ticketstatusid: 2,
    name: 'In progress',
    isdefault: 0,
    statuscolor: '#ff2d42',
    statusorder: 2,
    ticket_count: 0,
  },
  {
    ticketstatusid: 3,
    name: 'Closed',
    isdefault: 0,
    statuscolor: null,
    statusorder: 3,
    ticket_count: 0,
  },
];

type RepositoryPort = Pick<
  TicketStatusesRepository,
  'list' | 'findById' | 'create' | 'update' | 'hasTicketReferences' | 'remove'
>;

class MemoryRepository implements RepositoryPort {
  readonly rows = new Map(ROWS.map((row) => [row.ticketstatusid, row]));
  readonly ticketReferences = new Set<number>();
  lastId = 3;
  referenceChecks = 0;
  removals = 0;
  referenceFailure: Error | null = null;

  list(): Promise<readonly TicketStatus[]> {
    return Promise.resolve(
      [...this.rows.values()].sort(
        (left, right) =>
          (left.statusorder ?? 0) - (right.statusorder ?? 0) ||
          left.ticketstatusid - right.ticketstatusid,
      ),
    );
  }

  findById(id: number): Promise<TicketStatus | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  create(input: NewTicketStatus): Promise<TicketStatus> {
    this.lastId += 1;
    const row: TicketStatus = {
      ticketstatusid: this.lastId,
      isdefault: 0,
      ...input,
      ticket_count: 0,
    };
    this.rows.set(row.ticketstatusid, row);
    return Promise.resolve(row);
  }

  update(id: number, patch: TicketStatusPatch): Promise<TicketStatus | null> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(null);

    const updated: TicketStatus = { ...row, ...patch };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  hasTicketReferences(id: number): Promise<boolean> {
    this.referenceChecks += 1;
    if (this.referenceFailure !== null) {
      return Promise.reject(this.referenceFailure);
    }
    return Promise.resolve(this.ticketReferences.has(id));
  }

  remove(id: number): Promise<boolean> {
    this.removals += 1;
    return Promise.resolve(this.rows.delete(id));
  }
}

class RecordingLogger extends LoggerService {
  readonly lines: {
    message: string;
    meta: Record<string, unknown> | undefined;
  }[] = [];

  override log(message: string, meta?: Record<string, unknown>): void {
    this.lines.push({ message, meta });
  }
}

function build(defaultReplyStatus: string | null = null) {
  const repository = new MemoryRepository();
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();
  const getOption = vi.fn().mockResolvedValue(defaultReplyStatus);
  const settings = {
    getOption,
  } as unknown as SettingsFacade;
  const transport = new TicketStatusesTransport(events, settings);
  const service = new TicketStatusesService(
    new TicketStatusesValidator(),
    repository as unknown as TicketStatusesRepository,
    new TicketStatusesTransformer(),
    transport,
    logger,
  );
  service.now = () => NOW;
  return { service, repository, events, logger, settings, getOption, transport };
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

describe('TicketStatusesService: administrator gate', () => {
  it.each([
    ['list', (service: TicketStatusesService) => service.list(MEMBER, { bad: true })],
    ['exportCsv', (service: TicketStatusesService) => service.exportCsv(MEMBER, {})],
    ['get', (service: TicketStatusesService) => service.get(MEMBER, { id: 'bad' })],
    ['create', (service: TicketStatusesService) => service.create(MEMBER, { bad: true })],
    ['update', (service: TicketStatusesService) => service.update(MEMBER, { id: 'bad' }, {})],
    ['remove', (service: TicketStatusesService) => service.remove(MEMBER, { id: 'bad' })],
  ])(
    '%s refuses before validation, repository, settings, event, or log access',
    async (_name, call) => {
      const { service, repository, events, logger, getOption } = build();
      const error = await rejection(call(service));
      expect(error.code).toBe('ERP-AUTH-0005');
      expect(error.message).toBe('ticket statuses are managed by administrators only');
      expect(repository.rows.size).toBe(ROWS.length);
      expect(getOption).not.toHaveBeenCalled();
      expect(events.count).toBe(0);
      expect(logger.lines).toEqual([]);
    },
  );
});

describe('TicketStatusesService: CRUD', () => {
  it('lists in statusorder and gets a status, using the standard missing-record error', async () => {
    const { service } = build();
    expect((await service.list(ADMIN, {})).data.map((row) => row.ticketstatusid)).toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(await service.get(ADMIN, { id: '2' })).toMatchObject({
      ticketstatusid: '2',
      name: 'In progress',
    });
    expect((await rejection(service.get(ADMIN, { id: '404' }))).code).toBe('ERP-CORE-0004');
  });

  it('exports the visible columns with local search and sort applied', async () => {
    const { service } = build();
    const { body } = await service.exportCsv(ADMIN, {
      format: 'csv',
      column: ['id', 'name'],
      header: ['Status ID', 'Status Name'],
      q: 'o',
      sort: '-name',
    });
    if (typeof body !== 'string') throw new Error('the export answered no CSV text');
    expect(body.replace(CSV_BOM, '')).toBe(
      'Status ID,Status Name\r\n1,Open\r\n2,In progress\r\n3,Closed\r\n',
    );
  });

  it('creates a non-default status with nullable fields and publishes after the write', async () => {
    const { service, repository, events, logger } = build();
    const created = await service.create(ADMIN, {
      name: '  Waiting  ',
      statuscolor: '#aabbcc',
    });
    expect(created).toEqual({
      ticketstatusid: '4',
      name: 'Waiting',
      isdefault: 0,
      statuscolor: '#aabbcc',
      statusorder: null,
      ticket_count: 0,
    });
    expect(repository.rows.get(4)?.isdefault).toBe(0);
    expect(events.drain().map((event) => event.constructor)).toEqual([TicketStatusCreatedV1]);
    expect(logger.lines).toEqual([{ message: 'ticket status created', meta: { id: 4 } }]);
  });

  it('updates editable fields without allowing a caller to change isdefault', async () => {
    const { service, repository, events } = build();
    const updated = await service.update(
      ADMIN,
      { id: '2' },
      { name: 'Waiting', statuscolor: '#112233', statusorder: 4 },
    );
    expect(updated).toMatchObject({
      ticketstatusid: '2',
      name: 'Waiting',
      isdefault: 0,
      statuscolor: '#112233',
      statusorder: 4,
      ticket_count: 0,
    });
    expect(repository.rows.get(2)?.isdefault).toBe(0);
    expect(events.drain().map((event) => event.constructor)).toEqual([TicketStatusUpdatedV1]);
    expect((await rejection(service.update(ADMIN, { id: '404' }, { name: 'Missing' }))).code).toBe(
      'ERP-CORE-0004',
    );
  });

  it('refuses deletion of built-in statuses before checking references or settings', async () => {
    const { service, repository, getOption, events } = build();
    const error = await rejection(service.remove(ADMIN, { id: '1' }));
    expect(error.code).toBe('ERP-TICKETSTATUSES-0002');
    expect(repository.referenceChecks).toBe(0);
    expect(getOption).not.toHaveBeenCalled();
    expect(repository.rows.has(1)).toBe(true);
    expect(events.count).toBe(0);
  });

  it('refuses a status referenced by a ticket with the Perfex is_referenced detail', async () => {
    const { service, repository, getOption, events } = build();
    repository.ticketReferences.add(2);
    const error = await rejection(service.remove(ADMIN, { id: '2' }));
    expect([error.code, error.status, error.message]).toEqual([
      'ERP-TICKETSTATUSES-0001',
      409,
      'is_referenced',
    ]);
    expect(getOption).not.toHaveBeenCalled();
    expect(repository.rows.has(2)).toBe(true);
    expect(events.count).toBe(0);
  });

  it('refuses the configured default reply status before deleting', async () => {
    const { service, repository, getOption, events } = build('2');
    const error = await rejection(service.remove(ADMIN, { id: '2' }));
    expect([error.code, error.message]).toEqual(['ERP-TICKETSTATUSES-0001', 'is_referenced']);
    expect(getOption).toHaveBeenCalledWith('default_ticket_reply_status');
    expect(repository.removals).toBe(0);
    expect(events.count).toBe(0);
  });

  it('does not delete if the ticket-reference check or the settings read fails', async () => {
    const ticketFailure = build();
    ticketFailure.repository.referenceFailure = new Error('ticket count failed');
    await expect(ticketFailure.service.remove(ADMIN, { id: '2' })).rejects.toThrow(
      'ticket count failed',
    );
    expect(ticketFailure.repository.referenceChecks).toBe(1);
    expect(ticketFailure.repository.removals).toBe(0);

    const settingFailure = build();
    settingFailure.getOption.mockRejectedValueOnce(new Error('settings read failed'));
    await expect(settingFailure.service.remove(ADMIN, { id: '2' })).rejects.toThrow(
      'settings read failed',
    );
    expect(settingFailure.repository.removals).toBe(0);
  });

  it('returns 404 for a missing delete id and deletes an unused status successfully', async () => {
    const { service, repository, getOption, events, logger } = build('999');
    expect((await rejection(service.remove(ADMIN, { id: '404' }))).code).toBe('ERP-CORE-0004');
    expect(getOption).not.toHaveBeenCalled();
    expect(repository.removals).toBe(0);

    await service.remove(ADMIN, { id: '3' });
    expect(repository.rows.has(3)).toBe(false);
    expect(events.drain().map((event) => event.constructor)).toEqual([TicketStatusDeletedV1]);
    expect(logger.lines).toEqual([{ message: 'ticket status deleted', meta: { id: 3 } }]);
  });
});

describe('TicketStatusesFacade', () => {
  it('exposes model reads without actor-facing administrator checks', async () => {
    const { service } = build();
    const facade = new TicketStatusesFacade(service);
    expect(await facade.findById(2)).toEqual(ROWS[1]);
    expect(await facade.findById(404)).toBeNull();
    expect((await facade.listAll()).map((status) => status.ticketstatusid)).toEqual([1, 2, 3]);
  });
});
