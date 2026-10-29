import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import type {
  TicketPrioritiesListResponseDto,
  TicketPrioritiesResponseDto,
} from '../dto/ticket-priorities.dto.js';
import {
  TicketPrioritiesCreatedV1,
  TicketPrioritiesDeletedV1,
  TicketPrioritiesUpdatedV1,
} from '../events/published.js';
import type { TicketPriority } from '../model/ticket-priority.model.js';
import { TicketPrioritiesRepository } from '../repository/ticket-priorities.repository.js';
import {
  TICKET_PRIORITIES_EXPORT_CELLS,
  TicketPrioritiesTransformer,
  toExportRow,
} from './ticket-priorities.transformer.js';
import { TicketPrioritiesTransport } from './ticket-priorities.transport.js';
import { TicketPrioritiesValidator } from './ticket-priorities.validator.js';
import { parseExportOptions, runExport, type ExportFile } from '../../../shared/http/export.js';
import {
  TICKET_PRIORITIES_EXPORT_COLUMNS,
  TICKET_PRIORITIES_EXPORT_FILE_STEM,
} from '../ticket-priorities.routes.js';

const ADMIN_ONLY = 'ticket priorities are managed by administrators only';

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

@Injectable()
export class TicketPrioritiesService {
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: TicketPrioritiesValidator,
    private readonly repository: TicketPrioritiesRepository,
    private readonly transformer: TicketPrioritiesTransformer,
    private readonly transport: TicketPrioritiesTransport,
    private readonly logger: LoggerService,
  ) {}

  async list(actor: AuthenticatedUser, input: unknown): Promise<TicketPrioritiesListResponseDto> {
    this.assertAdministrator(actor);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    return this.transformer.toListResponse(page);
  }

  async get(actor: AuthenticatedUser, params: unknown): Promise<TicketPrioritiesResponseDto> {
    this.assertAdministrator(actor);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.transformer.toResponse(row);
  }

  async create(actor: AuthenticatedUser, body: unknown): Promise<TicketPrioritiesResponseDto> {
    this.assertAdministrator(actor);
    const input = this.validator.parseCreateBody(body);
    const row = await this.repository.create({ name: input.name });
    await this.transport.publish(
      new TicketPrioritiesCreatedV1({ id: row.id, at: this.now().toISOString() }),
    );
    this.logger.log('ticket priority created', { id: row.id });
    return this.transformer.toResponse(row);
  }

  async update(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<TicketPrioritiesResponseDto> {
    this.assertAdministrator(actor);
    const { id } = this.validator.parseParams(params);
    const { name } = this.validator.parseUpdateBody(body);
    const updated = await this.repository.update(id, { name });
    if (updated === null) throw notFound();
    await this.transport.publish(
      new TicketPrioritiesUpdatedV1({ id, at: this.now().toISOString() }),
    );
    this.logger.log('ticket priority updated', { id });
    return this.transformer.toResponse(updated);
  }

  /**
   * 404 for a missing id; 409 `ERP-TICKETPRIORITIES-0001` while a ticket uses it; 409
   * `ERP-TICKETPRIORITIES-0002` when it is the email-piping default or the setting cannot be read.
   */
  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor);
    const { id } = this.validator.parseParams(params);
    if ((await this.repository.findById(id)) === null) throw notFound();

    if (await this.repository.isReferenced(id)) {
      throw new AppError('ERP-TICKETPRIORITIES-0001', 'Priority in use by a ticket');
    }

    let defaultPriority: string | null;
    try {
      defaultPriority = await this.transport.emailPipingDefaultPriority();
    } catch {
      throw new AppError('ERP-TICKETPRIORITIES-0002', 'Cannot verify default priority setting');
    }
    if (defaultPriority !== null && Number(defaultPriority) === id) {
      throw new AppError('ERP-TICKETPRIORITIES-0002', 'Priority is the email-piping default');
    }

    const at = this.now().toISOString();
    if (!(await this.repository.remove(id))) throw notFound();
    await this.transport.publish(new TicketPrioritiesDeletedV1({ id, at }));
    this.logger.log('ticket priority deleted', { id });
  }

  /** Facade read: no actor, no assertion. */
  async findById(id: number): Promise<TicketPriority | null> {
    return this.repository.findById(id);
  }

  /** Facade read: every priority, the name ascending. */
  async listAll(): Promise<readonly TicketPriority[]> {
    return this.repository.listAll();
  }
  /** `GET export`: administrators first, then every row the list's query matches. */
  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor);
    const options = parseExportOptions(input, {
      columns: TICKET_PRIORITIES_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    return runExport({
      stem: TICKET_PRIORITIES_EXPORT_FILE_STEM,
      cells: TICKET_PRIORITIES_EXPORT_CELLS,
      options,
      request,
      count: (list) => this.repository.count(list),
      page: async (list) => {
        const page = await this.repository.list(list);
        return { items: page.items.map(toExportRow), nextCursor: page.nextCursor };
      },
      now: this.now(),
    });
  }

  private assertAdministrator(actor: AuthenticatedUser): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', ADMIN_ONLY);
  }
}
