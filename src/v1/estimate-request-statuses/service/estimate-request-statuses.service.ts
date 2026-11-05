import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { parseExportOptions, runExport, type ExportFile } from '../../../shared/http/export.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import {
  ESTIMATE_REQUEST_STATUSES_EXPORT_COLUMNS,
  ESTIMATE_REQUEST_STATUSES_EXPORT_FILE_STEM,
} from '../estimate-request-statuses.routes.js';
import type {
  EstimateRequestStatusResponseDto,
  EstimateRequestStatusesListResponseDto,
} from '../dto/estimate-request-statuses.dto.js';
import {
  EstimateRequestStatusCreatedV1,
  EstimateRequestStatusDeletedV1,
  EstimateRequestStatusUpdatedV1,
} from '../events/published.js';
import type { EstimateRequestStatusRow } from '../model/estimate-request-statuses.model.js';
import { EstimateRequestStatusesRepository } from '../repository/estimate-request-statuses.repository.js';
import {
  ESTIMATE_REQUEST_STATUSES_EXPORT_CELLS,
  EstimateRequestStatusesTransformer,
} from './estimate-request-statuses.transformer.js';
import { EstimateRequestStatusesTransport } from './estimate-request-statuses.transport.js';
import { EstimateRequestStatusesValidator } from './estimate-request-statuses.validator.js';

const ADMIN_ONLY = 'estimate request statuses are managed by administrators only';

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

function inUse(): AppError {
  return new AppError(
    'ERP-ESTIMATEREQUESTSTATUSES-0001',
    'estimate request status is still referenced',
  );
}

function useCouldNotBeCounted(): AppError {
  return new AppError('ERP-ESTIMATEREQUESTSTATUSES-0001', 'its use could not be counted');
}

function builtIn(): AppError {
  return new AppError(
    'ERP-ESTIMATEREQUESTSTATUSES-0002',
    'built-in estimate request statuses cannot be deleted',
  );
}

@Injectable()
export class EstimateRequestStatusesService {
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: EstimateRequestStatusesValidator,
    private readonly repository: EstimateRequestStatusesRepository,
    private readonly transformer: EstimateRequestStatusesTransformer,
    private readonly transport: EstimateRequestStatusesTransport,
    private readonly logger: LoggerService,
  ) {}

  describe(): { readonly module: 'estimate-request-statuses'; readonly version: 1 } {
    return { module: 'estimate-request-statuses', version: 1 };
  }

  async list(
    actor: AuthenticatedUser,
    input: unknown,
  ): Promise<EstimateRequestStatusesListResponseDto> {
    this.assertAdministrator(actor);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    return this.transformer.toListResponse(page.items, page);
  }

  async get(actor: AuthenticatedUser, params: unknown): Promise<EstimateRequestStatusResponseDto> {
    this.assertAdministrator(actor);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.transformer.toResponse(row);
  }

  async create(actor: AuthenticatedUser, body: unknown): Promise<EstimateRequestStatusResponseDto> {
    this.assertAdministrator(actor);
    const input = this.validator.parseCreateBody(body);
    const statusorder =
      input.statusorder === undefined
        ? (await this.repository.count({
            search: null,
            sortField: 'name',
            order: 'asc',
            cursor: null,
            limit: 1,
          })) + 1
        : input.statusorder;
    const row = await this.repository.create({
      name: input.name,
      color: input.color === '' ? '#757575' : (input.color ?? null),
      statusorder,
    });
    await this.transport.publish(
      new EstimateRequestStatusCreatedV1({ id: row.id, at: this.now().toISOString() }),
    );
    this.logger.log('estimate request status created', { id: row.id });
    return this.transformer.toResponse(row);
  }

  async update(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<EstimateRequestStatusResponseDto> {
    this.assertAdministrator(actor);
    const { id } = this.validator.parseParams(params);
    const input = this.validator.parseUpdateBody(body);
    const patch = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.color === undefined ? {} : { color: input.color }),
      ...(input.statusorder === undefined ? {} : { statusorder: input.statusorder }),
    };
    const row = await this.repository.update(id, patch);
    if (row === null) throw notFound();
    await this.transport.publish(
      new EstimateRequestStatusUpdatedV1({ id, at: this.now().toISOString() }),
    );
    this.logger.log('estimate request status updated', { id });
    return this.transformer.toResponse(row);
  }

  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();

    let references: number;
    try {
      references = await this.repository.deleteReferenceCount(id);
    } catch {
      throw useCouldNotBeCounted();
    }
    if (references > 0) throw inUse();
    if (row.flag !== null && row.flag !== '') throw builtIn();

    if (!(await this.repository.remove(id))) throw notFound();
    await this.transport.publish(
      new EstimateRequestStatusDeletedV1({ id, at: this.now().toISOString() }),
    );
    this.logger.log('estimate request status deleted', { id });
  }

  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor);
    const options = parseExportOptions(input, {
      columns: ESTIMATE_REQUEST_STATUSES_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    return runExport({
      stem: ESTIMATE_REQUEST_STATUSES_EXPORT_FILE_STEM,
      cells: ESTIMATE_REQUEST_STATUSES_EXPORT_CELLS,
      options,
      request,
      count: (list) => this.repository.count(list),
      page: async (list) => {
        const page = await this.repository.list(list);
        return {
          items: page.items.map((row) => this.transformer.toExportRow(row)),
          nextCursor: page.nextCursor,
        };
      },
      now: this.now(),
    });
  }

  async findById(id: number): Promise<EstimateRequestStatusRow | null> {
    return this.repository.findById(id);
  }

  listAll(): Promise<readonly EstimateRequestStatusRow[]> {
    return this.repository.listAll();
  }

  private assertAdministrator(actor: AuthenticatedUser): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', ADMIN_ONLY);
  }
}
