import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import {
  PRINT_MAX_ROWS,
  parseExportOptions,
  runExport,
  type ExportFile,
} from '../../../shared/http/export.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import {
  PredefinedRepliesCreatedV1,
  PredefinedRepliesDeletedV1,
  PredefinedRepliesUpdatedV1,
} from '../events/published.js';
import type {
  PredefinedReplyResponseDto,
  PredefinedRepliesListResponseDto,
} from '../dto/predefined-replies.dto.js';
import type { PredefinedReply } from '../model/predefined-replies.model.js';
import {
  PREDEFINED_REPLIES_EXPORT_COLUMNS,
  PREDEFINED_REPLIES_EXPORT_FILE_STEM,
} from '../predefined-replies.routes.js';
import { PredefinedRepliesRepository } from '../repository/predefined-replies.repository.js';
import {
  PREDEFINED_REPLIES_EXPORT_CELLS,
  toPredefinedReplyExportRow,
} from './predefined-replies.export.js';
import { PredefinedRepliesTransport } from './predefined-replies.transport.js';
import { PredefinedRepliesValidator } from './predefined-replies.validator.js';
import { toStoredHtml } from './reply-html.js';
import { PredefinedRepliesTransformer } from './predefined-replies.transformer.js';

const ADMIN_ONLY = 'Predefined replies are available to administrators only';

@Injectable()
export class PredefinedRepliesService {
  constructor(
    private readonly repository: PredefinedRepliesRepository,
    private readonly validator: PredefinedRepliesValidator,
    private readonly transport: PredefinedRepliesTransport,
    private readonly logger: LoggerService,
    private readonly transformer: PredefinedRepliesTransformer,
  ) {}

  async list(actor: AuthenticatedUser, query: unknown): Promise<PredefinedRepliesListResponseDto> {
    this.assertAdministrator(actor);

    const request = this.validator.parseListQuery(query);
    const page = await this.repository.list(request);

    return {
      data: page.items.map((reply) => ({
        id: String(reply.id),
        name: reply.name,
      })),
      meta: {
        nextCursor: page.nextCursor,
        prevCursor: page.prevCursor,
        total: page.total,
        rangeStart: page.rangeStart,
        exportLimit: EXPORT_MAX_ROWS,
        printLimit: PRINT_MAX_ROWS,
      },
    };
  }

  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor);

    const options = parseExportOptions(input, {
      columns: PREDEFINED_REPLIES_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);

    return runExport({
      stem: PREDEFINED_REPLIES_EXPORT_FILE_STEM,
      cells: PREDEFINED_REPLIES_EXPORT_CELLS,
      options,
      request,
      count: (list) => this.repository.count(list),
      page: async (list) => {
        const page = await this.repository.list(list);
        return {
          items: page.items.map(toPredefinedReplyExportRow),
          nextCursor: page.nextCursor,
        };
      },
      now: new Date(),
    });
  }

  async get(actor: AuthenticatedUser, input: unknown): Promise<PredefinedReplyResponseDto> {
    this.assertAdministrator(actor);

    const { id } = this.validator.parseParams(this.paramsInput(input));
    const reply = await this.repository.findById(id);

    if (reply === null) {
      throw new AppError('ERP-CORE-0004', 'Predefined reply not found');
    }

    return this.transformer.toResponse(reply);
  }

  async create(actor: AuthenticatedUser, input: unknown): Promise<PredefinedReplyResponseDto> {
    this.assertAdministrator(actor);

    const body = this.validator.parseCreateBody(input);
    const reply = await this.repository.create({
      name: body.name,
      message: toStoredHtml(body.message ?? ''),
    });

    await this.transport.publish(new PredefinedRepliesCreatedV1({ id: reply.id }));
    this.logger.log('predefined reply created', { id: reply.id });

    return this.transformer.toResponse(reply);
  }

  async update(
    actor: AuthenticatedUser,
    idInput: unknown,
    input: unknown,
  ): Promise<PredefinedReplyResponseDto> {
    this.assertAdministrator(actor);

    const { id } = this.validator.parseParams(this.paramsInput(idInput));
    const body = this.validator.parseUpdateBody(input);

    const existing = await this.repository.findById(id);
    if (existing === null) {
      throw new AppError('ERP-CORE-0004', 'Predefined reply not found');
    }

    const update: { name?: string; message?: string } = {};

    if (body.name !== undefined) {
      update.name = body.name;
    }

    if (body.message !== undefined) {
      update.message = toStoredHtml(body.message);
    }

    const reply = await this.repository.update(id, update);

    if (reply === null) {
      throw new AppError('ERP-CORE-0004', 'Predefined reply not found');
    }

    await this.transport.publish(new PredefinedRepliesUpdatedV1({ id: reply.id }));
    this.logger.log('predefined reply updated', { id: reply.id });

    return this.transformer.toResponse(reply);
  }

  async remove(actor: AuthenticatedUser, idInput: unknown): Promise<void> {
    this.assertAdministrator(actor);

    const { id } = this.validator.parseParams(this.paramsInput(idInput));
    const removed = await this.repository.remove(id);

    if (!removed) {
      throw new AppError('ERP-CORE-0004', 'Predefined reply not found');
    }

    await this.transport.publish(new PredefinedRepliesDeletedV1({ id }));
    this.logger.log('predefined reply deleted', { id });
  }

  /** Module-to-module read: all stored records ordered by name then ID. */
  async listAll(): Promise<readonly PredefinedReply[]> {
    return this.repository.listAll();
  }

  /** Module-to-module read: stored HTML, with no actor or administrator check. */
  async findById(id: number): Promise<PredefinedReply | null> {
    return this.repository.findById(id);
  }

  /** Module-to-module read: requested ids, preserving order and skipping absent ids. */
  async findByIds(ids: readonly number[]): Promise<readonly PredefinedReply[]> {
    const unique = [...new Set(ids)];
    const rows = await this.repository.findByIds(unique);
    const byId = new Map(rows.map((row) => [row.id, row] as const));

    return unique.flatMap((id) => {
      const row = byId.get(id);
      return row === undefined ? [] : [row];
    });
  }

  private paramsInput(input: unknown): unknown {
    if (typeof input === 'object' && input !== null && 'id' in input) {
      return input;
    }

    return { id: input };
  }

  private assertAdministrator(actor: AuthenticatedUser): void {
    if (!actor.isAdmin) {
      throw new AppError('ERP-AUTH-0005', ADMIN_ONLY);
    }
  }
}
