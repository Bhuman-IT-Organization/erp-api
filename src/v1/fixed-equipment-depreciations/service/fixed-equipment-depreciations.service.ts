import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { ReadScope } from '../../../shared/http/decorators/scope.decorator.js';
import { parseExportOptions, runExport, type ExportFile } from '../../../shared/http/export.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import type {
  FixedEquipmentDepreciationsListResponseDto,
  FixedEquipmentDepreciationsResponseDto,
} from '../dto/fixed-equipment-depreciations.dto.js';
import {
  FixedEquipmentDepreciationsCreatedV1,
  FixedEquipmentDepreciationsDeletedV1,
  FixedEquipmentDepreciationsUpdatedV1,
} from '../events/published.js';
import {
  FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_COLUMNS,
  FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_FILE_STEM,
} from '../fixed-equipment-depreciations.routes.js';
import type {
  FixedEquipmentDepreciation,
  FixedEquipmentDepreciationUsage,
  FixedEquipmentDepreciationsDescription,
} from '../model/fixed-equipment-depreciations.model.js';
import { FixedEquipmentDepreciationsRepository } from '../repository/fixed-equipment-depreciations.repository.js';
import {
  FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_CELLS,
  FixedEquipmentDepreciationsTransformer,
  toExportRow,
} from './fixed-equipment-depreciations.transformer.js';
import { FixedEquipmentDepreciationsTransport } from './fixed-equipment-depreciations.transport.js';
import { FixedEquipmentDepreciationsValidator } from './fixed-equipment-depreciations.validator.js';

/** A facade read under `all` names no owner. */
const ANY_OWNER = 0;

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

/**
 * The permission gate is the controller's (`PermissionGuard`); the row scope travels with the read
 * and is never re-decided here: the repository narrows `own` to the rows the member created.
 */
@Injectable()
export class FixedEquipmentDepreciationsService {
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: FixedEquipmentDepreciationsValidator,
    private readonly repository: FixedEquipmentDepreciationsRepository,
    private readonly transformer: FixedEquipmentDepreciationsTransformer,
    private readonly transport: FixedEquipmentDepreciationsTransport,
    private readonly logger: LoggerService,
  ) {}

  async list(
    input: unknown,
    scope: ReadScope,
    staffId: number,
  ): Promise<FixedEquipmentDepreciationsListResponseDto> {
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request, scope, staffId);
    return this.transformer.toListResponse(page);
  }

  /** Missing and hidden by `own` are the same 404. */
  async get(
    params: unknown,
    scope: ReadScope,
    staffId: number,
  ): Promise<FixedEquipmentDepreciationsResponseDto> {
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id, scope, staffId);
    if (row === null) throw notFound();
    return this.transformer.toResponse(row);
  }

  /** The creator is the actor, never the caller's body (Perfex sets `creator_id` the same way). */
  async create(
    actor: AuthenticatedUser,
    body: unknown,
  ): Promise<FixedEquipmentDepreciationsResponseDto> {
    const input = this.validator.parseCreateBody(body);
    const row = await this.repository.create({
      name: input.name,
      term: input.term,
      creatorId: actor.staffId,
    });
    await this.transport.publish(
      new FixedEquipmentDepreciationsCreatedV1({ id: row.id, at: this.now().toISOString() }),
    );
    this.logger.log('depreciation created', { id: row.id });
    return this.transformer.toResponse(row);
  }

  async update(params: unknown, body: unknown): Promise<FixedEquipmentDepreciationsResponseDto> {
    const { id } = this.validator.parseParams(params);
    const { name, term } = this.validator.parseUpdateBody(body);
    const updated = await this.repository.update(id, { name, term });
    if (updated === null) throw notFound();
    await this.transport.publish(
      new FixedEquipmentDepreciationsUpdatedV1({ id, at: this.now().toISOString() }),
    );
    this.logger.log('depreciation updated', { id });
    return this.transformer.toResponse(updated);
  }

  /**
   * 404 for a missing id; 409 `ERP-FEDEPRECIATIONS-0001` while an asset model or an asset uses it
   * (the detail names both counts); 409 `ERP-FEDEPRECIATIONS-0002` when its use could not be counted.
   */
  async remove(params: unknown): Promise<void> {
    const { id } = this.validator.parseParams(params);
    if ((await this.repository.findById(id, 'all', ANY_OWNER)) === null) throw notFound();

    let usage: FixedEquipmentDepreciationUsage;
    try {
      usage = await this.repository.usage(id);
    } catch {
      throw new AppError('ERP-FEDEPRECIATIONS-0002', 'its use could not be counted');
    }
    if (usage.models > 0 || usage.assets > 0) {
      throw new AppError(
        'ERP-FEDEPRECIATIONS-0001',
        `Depreciation is still in use. Usage counts: models=${String(usage.models)}, assets=${String(usage.assets)}`,
      );
    }

    const at = this.now().toISOString();
    if (!(await this.repository.remove(id))) throw notFound();
    await this.transport.publish(new FixedEquipmentDepreciationsDeletedV1({ id, at }));
    this.logger.log('depreciation deleted', { id });
  }

  describe(): FixedEquipmentDepreciationsDescription {
    return { module: 'fixed-equipment-depreciations', version: 1 };
  }

  /** Facade read: no actor, every owner. */
  findById(id: number): Promise<FixedEquipmentDepreciation | null> {
    return this.repository.findById(id, 'all', ANY_OWNER);
  }

  /** Facade read: every depreciation, the name ascending. */
  listAll(): Promise<readonly FixedEquipmentDepreciation[]> {
    return this.repository.listAll();
  }

  /** `GET export`: every row the list's query and the row scope match. */
  async exportCsv(input: unknown, scope: ReadScope, staffId: number): Promise<ExportFile> {
    const options = parseExportOptions(input, {
      columns: FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    return runExport({
      stem: FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_FILE_STEM,
      cells: FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_CELLS,
      options,
      request,
      count: (list) => this.repository.count(list, scope, staffId),
      page: async (list) => {
        const page = await this.repository.list(list, scope, staffId);
        return { items: page.items.map(toExportRow), nextCursor: page.nextCursor };
      },
      now: this.now(),
    });
  }
}
