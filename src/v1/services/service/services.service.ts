/**
 * Use-case orchestrator of the module. Every step is a call into a rule layer (validator,
 * transformer), the repository or the transport; nothing here touches a database client directly,
 * and the controller receives the DTO from here (BE-08). Failures are `AppError`s.
 *
 * Administrators only (D-06, D-26, BE-25). Every use case a handler calls asserts the administrator
 * flag as its FIRST statement, before the input is parsed or a row is read. The facade reads
 * (`findById`, `listAll`, `findByIds`) assert nothing: a module-to-module read has no actor.
 *
 * Perfex's Services (tickets) flow: the list in Perfex's order (the id descending); a create and an
 * update write the name only; a delete is refused while a ticket uses the service
 * (`ERP-SERVICES-0001`, Perfex's `is_referenced`). Every change publishes its event after the
 * write, then writes one `log` line with the id only.
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { parseExportOptions, runExport, type ExportFile } from '../../../shared/http/export.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import type { ServicesListResponseDto, ServicesResponseDto } from '../dto/services.dto.js';
import { ServicesCreatedV1, ServicesDeletedV1, ServicesUpdatedV1 } from '../events/published.js';
import type { Service } from '../model/services.model.js';
import { ServicesRepository } from '../repository/services.repository.js';
import { SERVICES_EXPORT_COLUMNS, SERVICES_EXPORT_FILE_STEM } from '../services.routes.js';
import {
  SERVICES_EXPORT_CELLS,
  ServicesTransformer,
  toExportRow,
  toService,
} from './services.transformer.js';
import { ServicesTransport } from './services.transport.js';
import { ServicesValidator } from './services.validator.js';

export interface ServicesDescription {
  readonly module: 'services';
  readonly version: 1;
}

/** The detail of every administrator refusal: plain, and the same for every use case. */
const ADMIN_ONLY = 'services are managed by administrators only';

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

/** The delete refusal: `null` when no ticket uses the service, else a 409 naming the count only. */
function inUse(tickets: number): AppError | null {
  return tickets > 0
    ? new AppError('ERP-SERVICES-0001', `used by ${String(tickets)} ticket(s)`)
    : null;
}
function ticketCountFailed(): AppError {
  return new AppError('ERP-SERVICES-0001', 'its use could not be counted');
}

@Injectable()
export class ServicesService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; a use case reads `this.now()`. */
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: ServicesValidator,
    private readonly repository: ServicesRepository,
    private readonly transformer: ServicesTransformer,
    private readonly transport: ServicesTransport,
    private readonly logger: LoggerService,
  ) {}

  describe(): ServicesDescription {
    return { module: 'services', version: 1 };
  }

  /** `GET /api/v1/services?limit&cursor&q&sort`: one keyset page (the id descending by default). */
  async list(actor: AuthenticatedUser, input: unknown): Promise<ServicesListResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    return this.transformer.toListResponse(page.items, page);
  }

  /** `GET /api/v1/services/:id`: one service; a missing id is `ERP-CORE-0004`. */
  async get(actor: AuthenticatedUser, params: unknown): Promise<ServicesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.transformer.toResponse(row);
  }

  /** `POST /api/v1/services`: the strict body `{ name }`. One event after the write, then the log line. */
  async create(actor: AuthenticatedUser, body: unknown): Promise<ServicesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const input = this.validator.parseCreateBody(body);
    const row = await this.repository.create({ name: input.name });
    await this.transport.publish(
      new ServicesCreatedV1({ id: row.id, at: this.now().toISOString() }),
    );
    this.logger.log('service created', { id: row.id });
    return this.transformer.toResponse(row);
  }

  /** `PATCH /api/v1/services/:id`: the name and nothing else; a missing id is `ERP-CORE-0004`. */
  async update(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<ServicesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const { name } = this.validator.parseUpdateBody(body);
    const updated = await this.repository.update(id, { name });
    if (updated === null) throw notFound();
    await this.transport.publish(new ServicesUpdatedV1({ id, at: this.now().toISOString() }));
    this.logger.log('service updated', { id });
    return this.transformer.toResponse(updated);
  }

  /**
   * `DELETE /api/v1/services/:id`: a missing id is `ERP-CORE-0004`; a service a ticket uses is
   * `ERP-SERVICES-0001` (409) and nothing is deleted. A row gone between the read and the delete is
   * the same 404. One event after the delete, then the log line.
   */
  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    if ((await this.repository.findById(id)) === null) throw notFound();
    let tickets: number;

    try {
      tickets = await this.repository.countTickets(id);
    } catch {
      throw ticketCountFailed();
    }
    const refusal = inUse(tickets);
    if (refusal !== null) throw refusal;
    const at = this.now().toISOString();
    if (!(await this.repository.remove(id))) throw notFound();
    await this.transport.publish(new ServicesDeletedV1({ id, at }));
    this.logger.log('service deleted', { id });
  }

  /**
   * `GET /api/v1/services/export?format&column&header&q&sort`: every row the list's query matches,
   * as CSV, Excel, PDF or print rows (ADR-0043). **Administrators first**, for every format, before
   * any parse or count. No row selection here: a `key` is a 400. The cells are the id and the name.
   */
  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const options = parseExportOptions(input, {
      columns: SERVICES_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    return runExport({
      stem: SERVICES_EXPORT_FILE_STEM,
      cells: SERVICES_EXPORT_CELLS,
      options,
      request,
      count: (list) => this.repository.count(list),
      page: async (list) => {
        const page = await this.repository.list(list);
        return {
          items: page.items.map((row) => toExportRow(row)),
          nextCursor: page.nextCursor,
        };
      },
      now: this.now(),
    });
  }

  /** The facade's read: one service, or `null`. No assertion: a module-to-module read. */
  async findById(id: number): Promise<Service | null> {
    const row = await this.repository.findById(id);
    return row === null ? null : toService(row);
  }

  /** The facade's read: every service, the name ascending, then the id. */
  async listAll(): Promise<readonly Service[]> {
    return (await this.repository.listAll()).map(toService);
  }

  /** The facade's read: the services with these ids, in the order given, each once, absent ids skipped. */
  async findByIds(ids: readonly number[]): Promise<readonly Service[]> {
    const unique = [...new Set(ids)];
    const rows = new Map((await this.repository.findByIds(unique)).map((row) => [row.id, row]));
    return unique.flatMap((id) => {
      const row = rows.get(id);
      return row === undefined ? [] : [toService(row)];
    });
  }

  /** D-06: the administrator flag, never a permission code; `ERP-AUTH-0005`. */
  private assertAdministrator(actor: AuthenticatedUser, detail: string): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', detail);
  }
}
