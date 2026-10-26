import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { parseExportOptions, runExport, type ExportFile } from '../../../shared/http/export.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import {
  TICKET_STATUSES_EXPORT_COLUMNS,
  TICKET_STATUSES_EXPORT_FILE_STEM,
} from '../ticket-statuses.routes.js';
import type {
  TicketStatusResponseDto,
  TicketStatusesListResponseDto,
} from '../dto/ticket-statuses.dto.js';
import type { TicketStatus, TicketStatusPatch } from '../model/ticket-statuses.model.js';
import { TicketStatusesRepository } from '../repository/ticket-statuses.repository.js';
import {
  TicketStatusCreatedV1,
  TicketStatusDeletedV1,
  TicketStatusUpdatedV1,
} from '../events/published.js';
import {
  TICKET_STATUSES_EXPORT_CELLS,
  TicketStatusesTransformer,
} from './ticket-statuses.transformer.js';
import { TicketStatusesTransport } from './ticket-statuses.transport.js';
import { TicketStatusesValidator } from './ticket-statuses.validator.js';

const ADMIN_ONLY = 'ticket statuses are managed by administrators only';

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

function referenced(): AppError {
  return new AppError('ERP-TICKETSTATUSES-0001', 'is_referenced');
}

function builtIn(): AppError {
  return new AppError('ERP-TICKETSTATUSES-0002', 'default ticket statuses cannot be deleted');
}

@Injectable()
export class TicketStatusesService {
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: TicketStatusesValidator,
    private readonly repository: TicketStatusesRepository,
    private readonly transformer: TicketStatusesTransformer,
    private readonly transport: TicketStatusesTransport,
    private readonly logger: LoggerService,
  ) {}

  async list(actor: AuthenticatedUser, query: unknown): Promise<TicketStatusesListResponseDto> {
    this.assertAdministrator(actor);
    this.validator.parseListQuery(query);
    return this.transformer.toListResponse(await this.repository.list());
  }

  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor);
    const query = this.validator.parseExportQuery(input);
    const options = parseExportOptions(input, {
      columns: TICKET_STATUSES_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const search = query.q?.toLocaleLowerCase();
    let statuses = (await this.repository.list()).filter(
      (status) =>
        search === undefined ||
        String(status.ticketstatusid).toLocaleLowerCase().includes(search) ||
        status.name.toLocaleLowerCase().includes(search),
    );
    if (query.sort !== undefined) {
      const descending = query.sort.startsWith('-');
      const field = descending ? query.sort.slice(1) : query.sort;
      statuses = [...statuses].sort((left, right) => {
        const order =
          field === 'id'
            ? left.ticketstatusid - right.ticketstatusid
            : left.name.localeCompare(right.name, undefined, {
                numeric: true,
                sensitivity: 'base',
              });
        return descending ? -order : order;
      });
    }
    const rows = statuses.map((status) => this.transformer.toExportRow(status));
    const request = { sortField: 'id' as const, cursor: null };
    return runExport({
      stem: TICKET_STATUSES_EXPORT_FILE_STEM,
      cells: TICKET_STATUSES_EXPORT_CELLS,
      options,
      request,
      count: () => Promise.resolve(rows.length),
      page: () => Promise.resolve({ items: rows, nextCursor: null }),
      now: this.now(),
    });
  }

  async get(actor: AuthenticatedUser, params: unknown): Promise<TicketStatusResponseDto> {
    this.assertAdministrator(actor);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.transformer.toResponse(row);
  }

  async create(actor: AuthenticatedUser, body: unknown): Promise<TicketStatusResponseDto> {
    this.assertAdministrator(actor);
    const input = this.validator.parseCreateBody(body);
    const row = await this.repository.create({
      name: input.name,
      statuscolor: input.statuscolor ?? null,
      statusorder: input.statusorder ?? null,
    });
    const at = this.now().toISOString();
    await this.transport.publish(new TicketStatusCreatedV1({ id: row.ticketstatusid, at }));
    this.logger.log('ticket status created', { id: row.ticketstatusid });
    return this.transformer.toResponse(row);
  }

  async update(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<TicketStatusResponseDto> {
    this.assertAdministrator(actor);
    const { id } = this.validator.parseParams(params);
    const input = this.validator.parseUpdateBody(body);
    const patch: TicketStatusPatch = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.statuscolor === undefined ? {} : { statuscolor: input.statuscolor }),
      ...(input.statusorder === undefined ? {} : { statusorder: input.statusorder }),
    };
    const row = await this.repository.update(id, patch);
    if (row === null) throw notFound();
    const at = this.now().toISOString();
    await this.transport.publish(new TicketStatusUpdatedV1({ id, at }));
    this.logger.log('ticket status updated', { id });
    return this.transformer.toResponse(row);
  }

  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    if (row.isdefault === 1) throw builtIn();
    if (await this.repository.hasTicketReferences(id)) throw referenced();
    const defaultStatus = await this.transport.defaultTicketReplyStatus();
    if (defaultStatus === String(id)) throw referenced();
    const at = this.now().toISOString();
    if (!(await this.repository.remove(id))) throw notFound();
    await this.transport.publish(new TicketStatusDeletedV1({ id, at }));
    this.logger.log('ticket status deleted', { id });
  }

  /** Module-to-module reads have no actor and return stored fields, not HTTP DTOs. */
  findById(id: number): Promise<TicketStatus | null> {
    return this.repository.findById(id);
  }

  listAll(): Promise<readonly TicketStatus[]> {
    return this.repository.list();
  }

  private assertAdministrator(actor: AuthenticatedUser): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', ADMIN_ONLY);
  }
}
