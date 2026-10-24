import { Injectable } from '@nestjs/common';

import { AppError } from '../../../shared/errors/app-error.js';

import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';

import { parseExportOptions, runExport, type ExportFile } from '../../../shared/http/export.js';

import { LoggerService } from '../../../shared/logger/logger.service.js';

import type {
  LeadStatusesListResponseDto,
  LeadStatusesResponseDto,
} from '../dto/lead-statuses.dto.js';

import {
  LeadStatusesCreatedV1,
  LeadStatusesDeletedV1,
  LeadStatusesUpdatedV1,
} from '../events/published.js';

import type { LeadStatus, LeadStatusRow } from '../model/lead-statuses.model.js';

import { LeadStatusesRepository } from '../repository/lead-statuses.repository.js';

import {
  LeadStatusesTransformer,
  LEAD_STATUSES_EXPORT_CELLS,
  toExportRow,
  toLeadStatus,
} from './lead-statuses.transformer.js';

import {
  LEAD_STATUSES_EXPORT_COLUMNS,
  LEAD_STATUSES_EXPORT_FILE_STEM,
} from '../lead-statuses.routes.js';

import { LeadStatusesTransport } from './lead-statuses.transport.js';

import { LeadStatusesValidator } from './lead-statuses.validator.js';

export interface LeadStatusesDescription {
  readonly module: 'lead-statuses';
  readonly version: 1;
}

const ADMIN_ONLY = 'lead statuses are managed by administrators only';

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

@Injectable()
export class LeadStatusesService {
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: LeadStatusesValidator,
    private readonly repository: LeadStatusesRepository,
    private readonly transformer: LeadStatusesTransformer,
    private readonly transport: LeadStatusesTransport,
    private readonly logger: LoggerService,
  ) {}

  // Module information
  describe(): LeadStatusesDescription {
    return {
      module: 'lead-statuses',
      version: 1,
    };
  }

  // GET all statuses with pagination
  async list(actor: AuthenticatedUser, input: unknown): Promise<LeadStatusesListResponseDto> {
    this.assertAdministrator(actor);

    const query = this.validator.parseListQuery(input);

    const page = await this.repository.list(query);

    const [usage, defaultId] = await Promise.all([
      this.repository.usageByStatuses(page.items.map((row) => row.id)),
      this.configuredDefaultId(),
    ]);

    return this.transformer.toListResponse(page.items, usage, defaultId, page);
  }

  // GET one status
  async get(actor: AuthenticatedUser, params: unknown): Promise<LeadStatusesResponseDto> {
    this.assertAdministrator(actor);

    const { id } = this.validator.parseParams(params);

    const row = await this.repository.findById(id);

    if (row === null) {
      throw notFound();
    }

    return this.record(row);
  }

  // CREATE status
  async create(actor: AuthenticatedUser, body: unknown): Promise<LeadStatusesResponseDto> {
    this.assertAdministrator(actor);

    const input = this.validator.parseCreateBody(body);

    const statusorder = input.statusorder ?? (await this.repository.count()) + 1;

    const row = await this.repository.create({
      name: input.name,
      ...(input.color !== undefined ? { color: input.color } : {}),
      statusorder,
    });
    await this.transport.publish(
      new LeadStatusesCreatedV1({
        id: row.id,
        at: this.now().toISOString(),
      }),
    );

    this.logger.log('lead status created', { id: row.id });

    return this.record(row);
  }

  // UPDATE status
  async update(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<LeadStatusesResponseDto> {
    this.assertAdministrator(actor);

    const { id } = this.validator.parseParams(params);

    const input = this.validator.parseUpdateBody(body);

    const row = await this.repository.update(id, {
      name: input.name,
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.statusorder !== undefined ? { statusorder: input.statusorder } : {}),
    });

    if (row === null) {
      throw notFound();
    }

    await this.transport.publish(
      new LeadStatusesUpdatedV1({
        id,
        at: this.now().toISOString(),
      }),
    );

    this.logger.log('lead status updated', { id });

    return this.record(row);
  }

  // DELETE status with protection rules
  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor);

    const { id } = this.validator.parseParams(params);

    const row = await this.repository.findById(id);

    if (row === null) {
      throw notFound();
    }

    // Protect built-in status
    if (row.isdefault === 1) {
      throw new AppError('ERP-LEADSTATUSES-0002', 'Built-in lead status cannot be deleted');
    }

    // Protect configured default status
    const defaultId = await this.configuredDefaultId();

    if (defaultId === id) {
      throw new AppError('ERP-LEADSTATUSES-0003', 'Default lead status cannot be deleted');
    }

    // Protect statuses used by other records
    const usage = await this.repository.usageByStatus(id);

    if (usage.leads > 0 || usage.emailIntegration > 0) {
      throw new AppError('ERP-LEADSTATUSES-0001', 'Lead status is still referenced');
    }

    const deleted = await this.repository.remove(id);

    if (!deleted) {
      throw notFound();
    }

    await this.transport.publish(
      new LeadStatusesDeletedV1({
        id,
        at: this.now().toISOString(),
      }),
    );

    this.logger.log('lead status deleted', { id });
  }

  // Read one status for other ERP modules
  async findById(id: number): Promise<LeadStatus | null> {
    const row = await this.repository.findById(id);

    return row === null ? null : toLeadStatus(row);
  }

  // Read all statuses for other ERP modules
  async listAll(): Promise<readonly LeadStatus[]> {
    const rows = await this.repository.listAll();

    return rows.map(toLeadStatus);
  }

  // Read multiple statuses by ID
  async findByIds(ids: readonly number[]): Promise<readonly LeadStatus[]> {
    const unique = [...new Set(ids)];

    const rows = await this.repository.findByIds(unique);

    const byId = new Map(rows.map((row) => [row.id, row]));

    return unique.flatMap((id) => {
      const row = byId.get(id);

      return row === undefined ? [] : [toLeadStatus(row)];
    });
  }

  // Export lead statuses using the shared export system
  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor);

    const options = parseExportOptions(input, {
      columns: LEAD_STATUSES_EXPORT_COLUMNS,
      keys: 'refuse',
    });

    const request = this.validator.parseExportList(input);

    const result = await runExport({
      stem: LEAD_STATUSES_EXPORT_FILE_STEM,
      cells: LEAD_STATUSES_EXPORT_CELLS,
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

    return result;
  }

  // Convert a database row to an API response
  private async record(row: LeadStatusRow): Promise<LeadStatusesResponseDto> {
    const [usage, defaultId] = await Promise.all([
      this.repository.usageByStatuses([row.id]),
      this.configuredDefaultId(),
    ]);

    return this.transformer.toResponse(row, usage, defaultId);
  }

  // Read configured default status from Settings
  private async configuredDefaultId(): Promise<number | null> {
    const raw = await this.transport.configuredDefaultStatus();

    if (raw === null || raw.trim() === '') {
      return null;
    }

    const trimmed = raw.trim();

    if (!/^\d+$/.test(trimmed)) {
      throw new AppError('ERP-INTERNAL-0001', 'Default lead status setting is invalid');
    }

    const id = Number(trimmed);

    if (!Number.isSafeInteger(id) || id < 1) {
      throw new AppError('ERP-INTERNAL-0001', 'Default lead status setting is invalid');
    }

    return id;
  }

  // Administrator permission check
  private assertAdministrator(actor: AuthenticatedUser): void {
    if (!actor.isAdmin) {
      throw new AppError('ERP-AUTH-0005', ADMIN_ONLY);
    }
  }
}
