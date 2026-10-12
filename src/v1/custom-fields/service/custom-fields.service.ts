/**
 * Use-case orchestrator of the module. Every step is a call into a rule layer (validator,
 * transformer, the values read codec) or the repository; nothing here touches a database client,
 * `fetch` or a breaker directly (BE-08). Failures are `AppError`s.
 *
 * Read-only: `tblcustomfields` and `tblcustomfieldsvalues` are Perfex's. Perfex's Setup > Custom
 * Fields page creates, edits, switches and deletes a field, and Perfex's `handle_custom_fields_post`
 * writes the values; nothing here writes either table.
 *
 * Administrators only (Perfex's `Custom_fields` controller is `is_admin()` only). Every use case a
 * handler calls asserts the administrator flag as its FIRST statement, before the input is parsed or
 * a row is read, so a refused caller learns nothing (T-4.2-66). The facade's methods are
 * module-to-module calls, not handlers: the calling module's own permission decides, and they
 * assert nothing.
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import {
  parseExportOptions,
  runExport,
  type ExportCell,
  type ExportFile,
} from '../../../shared/http/export.js';
import {
  CUSTOM_FIELDS_EXPORT_COLUMNS,
  CUSTOM_FIELDS_EXPORT_FILE_STEM,
} from '../custom-fields.routes.js';
import type {
  CustomFieldsListResponseDto,
  CustomFieldsResponseDto,
} from '../dto/custom-fields.dto.js';
import type {
  CustomField,
  CustomFieldDefinition,
  CustomFieldEntity,
  CustomFieldValue,
} from '../model/custom-fields.model.js';
import { CustomFieldsRepository } from '../repository/custom-fields.repository.js';
import { fromStoredValue } from './custom-field-values.js';
import { CustomFieldsTransformer } from './custom-fields.transformer.js';
import { CustomFieldsValidator } from './custom-fields.validator.js';

export interface CustomFieldsDescription {
  readonly module: 'custom-fields';
  readonly version: 1;
}

/** The detail of every administrator refusal. */
const ADMIN_ONLY = 'custom fields are managed by administrators only';

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

/** Each export column's cell over a stored row. */
const CUSTOM_FIELDS_EXPORT_CELLS = {
  id: { value: (row) => String(row.id) },
  name: { value: (row) => row.name },
  fieldto: { value: (row) => row.fieldto },
  type: { value: (row) => row.type },
  slug: { value: (row) => row.slug },
  active: { value: (row) => row.active },
} as const satisfies Record<(typeof CUSTOM_FIELDS_EXPORT_COLUMNS)[number], ExportCell<CustomField>>;

@Injectable()
export class CustomFieldsService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; a use case reads `this.now()`. */
  now: () => number = () => Date.now();

  constructor(
    private readonly validator: CustomFieldsValidator,
    private readonly repository: CustomFieldsRepository,
    private readonly transformer: CustomFieldsTransformer,
  ) {}

  describe(): CustomFieldsDescription {
    return { module: 'custom-fields', version: 1 };
  }

  /** `GET /api/v1/custom-fields`: one keyset page and each row's value count, read once for the page. */
  async list(actor: AuthenticatedUser, input: unknown): Promise<CustomFieldsListResponseDto> {
    this.assertAdministrator(actor);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    const counts = await this.repository.valuesCountOf(page.items.map((row) => row.id));
    return this.transformer.toListResponse(page.items, counts, page);
  }

  /** `GET /api/v1/custom-fields/:id`: the record with its value count and fingerprint. */
  async get(actor: AuthenticatedUser, params: unknown): Promise<CustomFieldsResponseDto> {
    this.assertAdministrator(actor);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    const counts = await this.repository.valuesCountOf([id]);
    return this.transformer.toResponse(row, counts.get(id) ?? 0);
  }

  /** `GET /api/v1/custom-fields/export`: the shared export (ADR-0043), no row selection. */
  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor);
    const options = parseExportOptions(input, {
      columns: CUSTOM_FIELDS_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    return runExport({
      stem: CUSTOM_FIELDS_EXPORT_FILE_STEM,
      cells: CUSTOM_FIELDS_EXPORT_CELLS,
      options,
      request,
      count: (list) => this.repository.count(list),
      page: async (list) => {
        const page = await this.repository.list(list);
        return { items: page.items, nextCursor: page.nextCursor };
      },
      now: new Date(this.now()),
    });
  }

  // --- the facade's reads (module-to-module; no handler calls these) ----------------------------

  /** The definitions of an entity in Perfex's order; the active ones only when asked. */
  async definitionsFor(
    fieldto: CustomFieldEntity,
    options: { readonly activeOnly?: boolean } = {},
  ): Promise<readonly CustomFieldDefinition[]> {
    const rows = await this.repository.definitionsOf(fieldto);
    return rows
      .filter((row) => options.activeOnly !== true || row.active)
      .map((row) => this.transformer.toDefinition(row))
      .filter((definition): definition is CustomFieldDefinition => definition !== null);
  }

  /** `relId -> fieldId -> value` (the read codec); values of fields the entity does not define are skipped. */
  async valuesFor(
    fieldto: CustomFieldEntity,
    relIds: readonly number[],
  ): Promise<ReadonlyMap<number, ReadonlyMap<number, CustomFieldValue>>> {
    const [definitions, rows] = await Promise.all([
      this.definitionsFor(fieldto),
      this.repository.valuesOf(fieldto, relIds),
    ]);
    const types = new Map(definitions.map((definition) => [definition.id, definition.type]));
    const answer = new Map<number, Map<number, CustomFieldValue>>();
    for (const row of rows) {
      const type = types.get(row.fieldId);
      if (type === undefined) continue;
      const values = answer.get(row.relId) ?? new Map<number, CustomFieldValue>();
      values.set(row.fieldId, fromStoredValue(type, row.value));
      answer.set(row.relId, values);
    }
    return answer;
  }

  /** The administrator flag, never a permission code; `ERP-AUTH-0005`. */
  private assertAdministrator(actor: AuthenticatedUser): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', ADMIN_ONLY);
  }
}
