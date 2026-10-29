import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { SettingsFacade } from '../../settings/index.js';
import {
  TicketStatusCreatedV1,
  TicketStatusDeletedV1,
  TicketStatusUpdatedV1,
} from '../events/published.js';
import type {
  NewTicketStatus,
  TicketStatus,
  TicketStatusPatch,
  TicketStatusesListRequest,
  TicketStatusesPage,
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
  'list' | 'count' | 'listAll' | 'findById' | 'create' | 'update' | 'hasTicketReferences' | 'remove'
>;

class MemoryRepository implements RepositoryPort {
  readonly rows = new Map(ROWS.map((row) => [row.ticketstatusid, row]));
  readonly ticketReferences = new Set<number>();
  lastId = 3;
  referenceChecks = 0;
  removals = 0;
  referenceFailure: Error | null = null;

  private matching(request: TicketStatusesListRequest): TicketStatus[] {
    if (request.search === null) return [...this.rows.values()];
    const search = request.search.toLowerCase();
    const id = /^\d+$/.test(request.search) ? Number(request.search) : null;
    return [...this.rows.values()].filter(
      (row) =>
        row.name.toLowerCase().includes(search) || (id !== null && row.ticketstatusid === id),
    );
  }

  list(request: TicketStatusesListRequest): Promise<TicketStatusesPage> {
    const items = this.matching(request)
      .sort((left, right) => {
        const comparison =
          request.sortField === 'name'
            ? left.name.localeCompare(right.name)
            : left.ticketstatusid - right.ticketstatusid;
        return (
          (request.order === 'asc' ? comparison : -comparison) ||
          (request.order === 'asc'
            ? left.ticketstatusid - right.ticketstatusid
            : right.ticketstatusid - left.ticketstatusid)
        );
      })
      .slice(0, request.limit);
    return Promise.resolve({
      items,
      nextCursor: null,
      prevCursor: null,
      total: this.matching(request).length,
      rangeStart: items.length === 0 ? 0 : 1,
    });
  }

  count(request: TicketStatusesListRequest): Promise<number> {
    return Promise.resolve(this.matching(request).length);
  }

  listAll(): Promise<readonly TicketStatus[]> {
    return Promise.resolve([...this.rows.values()]);
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
    if (this.referenceFailure !== null) return Promise.reject(this.referenceFailure);
    return Promise.resolve(this.ticketReferences.has(id));
  }

  remove(id: number): Promise<boolean> {
    this.removals += 1;
    return Promise.resolve(this.rows.delete(id));
  }
}

class RecordingLogger extends LoggerService {
  readonly lines: { message: string; meta: Record<string, unknown> | undefined }[] = [];
  override log(message: string, meta?: Record<string, unknown>): void {
    this.lines.push({ message, meta });
  }
}

function build(defaultReplyStatus: string | null = null) {
  const repository = new MemoryRepository();
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();
  const getOption = vi.fn().mockResolvedValue(defaultReplyStatus);
  const settings = { getOption } as unknown as SettingsFacade;
  const transport = new TicketStatusesTransport(events, settings);
  const service = new TicketStatusesService(
    new TicketStatusesValidator(),
    repository as unknown as TicketStatusesRepository,
    new TicketStatusesTransformer(),
    transport,
    logger,
  );
  service.now = () => NOW;
  return { service, repository, events, logger, getOption };
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
  ])('%s refuses before validation or data access', async (_name, call) => {
    const { service, repository, events, logger, getOption } = build();
    const error = await rejection(call(service));
    expect(error.code).toBe('ERP-AUTH-0005');
    expect(error.message).toBe('ticket statuses are managed by administrators only');
    expect(repository.rows.size).toBe(ROWS.length);
    expect(getOption).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });
});

describe('TicketStatusesService: CRUD', () => {
  it('lists pages and reads a status by id', async () => {
    const { service } = build();
    const list = await service.list(ADMIN, {});
    expect(list.data.map((row) => row.ticketstatusid)).toEqual(['3', '2', '1']);
    expect(await service.get(ADMIN, { id: '2' })).toMatchObject({
      ticketstatusid: '2',
      name: 'In progress',
    });
    expect((await rejection(service.get(ADMIN, { id: '404' }))).code).toBe('ERP-CORE-0004');
  });

  it('exports the ticket count column with local sort', async () => {
    const { service } = build();
    const exportFile = await service.exportCsv(ADMIN, {
      format: 'csv',
      column: ['id', 'name', 'ticket_count'],
      header: ['ID', 'Name', 'Tickets'],
      q: 'o',
      sort: '-name',
    });
    expect(typeof exportFile.body).toBe('string');
    expect(exportFile.body).toContain('ID,Name,Tickets');
  });

  it('creates a status and publishes the event', async () => {
    const { service, repository, events, logger } = build();
    const created = await service.create(ADMIN, {
      name: '  Waiting  ',
      statuscolor: '#aabbcc',
      statusorder: '4',
    });
    expect(created).toEqual({
      ticketstatusid: '4',
      name: 'Waiting',
      isdefault: 0,
      statuscolor: '#aabbcc',
      statusorder: 4,
      ticket_count: 0,
    });
    expect(repository.rows.get(4)?.isdefault).toBe(0);
    expect(events.drain().map((event) => event.constructor)).toEqual([TicketStatusCreatedV1]);
    expect(logger.lines).toEqual([{ message: 'ticket status created', meta: { id: 4 } }]);
  });

  it('updates editable fields without changing the default flag', async () => {
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
  });

  it('refuses built-in deletes and ticket-referenced deletes', async () => {
    const { service, repository, getOption, events } = build();
    const builtIn = await rejection(service.remove(ADMIN, { id: '1' }));
    expect(builtIn.code).toBe('ERP-TICKETSTATUSES-0002');
    expect(getOption).not.toHaveBeenCalled();
    expect(repository.rows.has(1)).toBe(true);
    expect(events.count).toBe(0);

    const ticketRef = build();
    ticketRef.repository.ticketReferences.add(2);
    expect((await rejection(ticketRef.service.remove(ADMIN, { id: '2' }))).code).toBe(
      'ERP-TICKETSTATUSES-0001',
    );
  });

  it('refuses the configured default reply status before deleting', async () => {
    const { service, repository, getOption, events } = build('2');
    const error = await rejection(service.remove(ADMIN, { id: '2' }));
    expect([error.code, error.message]).toEqual([
      'ERP-TICKETSTATUSES-0003',
      'default ticket reply status cannot be deleted',
    ]);
    expect(getOption).toHaveBeenCalledWith('default_ticket_reply_status');
    expect(repository.removals).toBe(0);
    expect(events.count).toBe(0);
  });

  it.each(['03', ' 3'])(
    'coerces PHP-style default reply setting %j before comparing',
    async (setting) => {
      const { service, repository } = build(setting);
      const error = await rejection(service.remove(ADMIN, { id: '3' }));
      expect(error.code).toBe('ERP-TICKETSTATUSES-0003');
      expect(repository.removals).toBe(0);
    },
  );

  it('does not treat a non-numeric default reply setting as a status id', async () => {
    const { service, repository } = build('not numeric');
    await service.remove(ADMIN, { id: '3' });
    expect(repository.rows.has(3)).toBe(false);
  });

  it('maps count failures to a 409 and cleans up on a successful delete', async () => {
    const ticketFailure = build();
    ticketFailure.repository.referenceFailure = new AppError('ERP-CORE-0004');
    const countError = await rejection(ticketFailure.service.remove(ADMIN, { id: '2' }));
    expect([countError.code, countError.status, countError.message]).toEqual([
      'ERP-TICKETSTATUSES-0001',
      409,
      'its use could not be counted',
    ]);
    expect(ticketFailure.repository.referenceChecks).toBe(1);
    expect(ticketFailure.repository.removals).toBe(0);

    const { service, repository, events, logger } = build('999');
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
