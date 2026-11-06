/**
 * Use-case orchestrator of the module. Every step is a call into a rule layer (validator,
 * transformer), the repository or the transport; the controller receives the DTO from here and
 * never imports the transformer (BE-08). Failures are `AppError`s the shared filter maps to
 * problem details.
 *
 * Administrators only. Every use case a handler calls asserts the administrator flag as its FIRST
 * statement, before the input is parsed or a row is read (`__tests__/route-gates.spec.ts` reads it
 * from each method's source). The facade reads (`findById`, `listAll`, `findByIds`) assert nothing:
 * a module-to-module read has no actor.
 *
 * Perfex's flow, reproduced: the list in Perfex's order (the date added descending); a create
 * stores the trimmed name, message and switches with the current time; an update changes the same
 * five fields and never the date; a delete is unconditional (Perfex's `Announcements_model::delete`
 * also removes the matching rows from `tbldismissed_announcements`).
 *
 * Every change publishes its event through the transport AFTER the write (id and time only), then
 * writes one `log` line with the id only.
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { parseExportOptions, runExport, type ExportFile } from '../../../shared/http/export.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import {
  ANNOUNCEMENTS_EXPORT_COLUMNS,
  ANNOUNCEMENTS_EXPORT_FILE_STEM,
} from '../announcements.routes.js';
import {
  ANNOUNCEMENTS_USERID_MAX,
  type AnnouncementsListResponseDto,
  type AnnouncementsResponseDto,
} from '../dto/announcements.dto.js';
import {
  AnnouncementsCreatedV1,
  AnnouncementsDeletedV1,
  AnnouncementsUpdatedV1,
} from '../events/published.js';
import type { Announcement } from '../model/announcements.model.js';
import { AnnouncementsRepository } from '../repository/announcements.repository.js';
import {
  ANNOUNCEMENTS_EXPORT_CELLS,
  AnnouncementsTransformer,
  toAnnouncement,
  toExportRow,
} from './announcements.transformer.js';
import { AnnouncementsTransport } from './announcements.transport.js';
import { AnnouncementsValidator } from './announcements.validator.js';

export interface AnnouncementsDescription {
  readonly module: 'announcements';
  readonly version: 1;
}

/** The detail of every administrator refusal: plain, and the same for every use case. */
const ADMIN_ONLY = 'announcements are managed by administrators only';

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

@Injectable()
export class AnnouncementsService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; a use case reads `this.now()`, never `new Date()`. */
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: AnnouncementsValidator,
    private readonly repository: AnnouncementsRepository,
    private readonly transformer: AnnouncementsTransformer,
    private readonly transport: AnnouncementsTransport,
    private readonly logger: LoggerService,
  ) {}

  describe(): AnnouncementsDescription {
    return { module: 'announcements', version: 1 };
  }

  /** `GET /api/v1/announcements?limit&cursor&q&sort`: one keyset page (the date descending by default). */
  async list(actor: AuthenticatedUser, input: unknown): Promise<AnnouncementsListResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    return this.transformer.toListResponse(page.items, page);
  }

  /**
   * `GET /api/v1/announcements/export?format&column&header&q&sort`: every row the list's query
   * matches, as CSV, Excel, PDF or print rows (ADR-0043). Administrators first, for every format,
   * before any parse or count. No row selection: a `key` is a 400.
   */
  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const options = parseExportOptions(input, {
      columns: ANNOUNCEMENTS_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    return runExport({
      stem: ANNOUNCEMENTS_EXPORT_FILE_STEM,
      cells: ANNOUNCEMENTS_EXPORT_CELLS,
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

  /** `GET /api/v1/announcements/:id`: one announcement with wire-named fields; missing id is `ERP-CORE-0004`. */
  async get(actor: AuthenticatedUser, params: unknown): Promise<AnnouncementsResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.transformer.toResponse(row);
  }

  /** `POST /api/v1/announcements`: the strict body; the trimmed fields, dated now. */
  async create(actor: AuthenticatedUser, body: unknown): Promise<AnnouncementsResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const input = this.validator.parseCreateBody(body);
    const names = await this.transport.nameOf(actor.staffId);
    const userid = (names.get(actor.staffId) ?? '').slice(0, ANNOUNCEMENTS_USERID_MAX);
    const row = await this.repository.create(
      {
        name: input.name,
        message: input.message ?? '',
        showtousers: input.showToUsers ? 1 : 0,
        showtostaff: input.showToStaff ? 1 : 0,
        showname: input.showName ? 1 : 0,
      },
      this.now(),
      userid,
    );
    await this.transport.publish(
      new AnnouncementsCreatedV1({ id: row.id, at: this.now().toISOString() }),
    );
    this.logger.log('announcement created', { id: row.id });
    return this.transformer.toResponse(row);
  }

  /** `PATCH /api/v1/announcements/:id`: the five fields, never the date; message is required. */
  async update(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<AnnouncementsResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const input = this.validator.parseUpdateBody(body);
    const updated = await this.repository.update(id, {
      name: input.name,
      message: input.message,
      showtousers: input.showToUsers ? 1 : 0,
      showtostaff: input.showToStaff ? 1 : 0,
      showname: input.showName ? 1 : 0,
    });
    if (updated === null) throw notFound();
    await this.transport.publish(new AnnouncementsUpdatedV1({ id, at: this.now().toISOString() }));
    this.logger.log('announcement updated', { id });
    return this.transformer.toResponse(updated);
  }

  /** `DELETE /api/v1/announcements/:id`: a missing id is `ERP-CORE-0004`; otherwise the row is deleted. */
  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const at = this.now().toISOString();
    if (!(await this.repository.remove(id))) throw notFound();
    await this.transport.publish(new AnnouncementsDeletedV1({ id, at }));
    this.logger.log('announcement deleted', { id });
  }

  /** The facade's read: one announcement, or `null`. No assertion: a module-to-module read. */
  async findById(id: number): Promise<Announcement | null> {
    const row = await this.repository.findById(id);
    return row === null ? null : toAnnouncement(row);
  }

  /** The facade's read: every announcement, the date descending, then the id descending. */
  async listAll(): Promise<readonly Announcement[]> {
    return (await this.repository.listAll()).map(toAnnouncement);
  }

  /** The facade's read: the announcements with these ids, in the order given, each once, absent ids skipped. */
  async findByIds(ids: readonly number[]): Promise<readonly Announcement[]> {
    const unique = [...new Set(ids)];
    const rows = new Map((await this.repository.findByIds(unique)).map((row) => [row.id, row]));
    return unique.flatMap((id) => {
      const row = rows.get(id);
      return row === undefined ? [] : [toAnnouncement(row)];
    });
  }

  /** The administrator flag, never a permission code; `ERP-AUTH-0005`. */
  private assertAdministrator(actor: AuthenticatedUser, detail: string): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', detail);
  }
}
