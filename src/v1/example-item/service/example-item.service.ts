/**
 * Use-case orchestrator of the module. Every step is a call into a rule layer (validator,
 * enricher, transformer), the repository or the transport; nothing here touches a database client,
 * `fetch` or a breaker directly, and the controller receives the DTO from here — it never imports
 * the transformer (BE-08). Failures are `AppError`s the shared filter maps to problem details.
 *
 * The five use cases are the ones the screens of erp-docs `05-templates/frontend-feature` call: `list`, `get`, `create`, `update`
 * and `exportCsv`. A real module keeps the order — validator → repository → enricher → transformer,
 * and the event through the transport after a write — and adds its own rules in the validator.
 *
 * The row scope travels with the actor and is never re-decided here: `PermissionGuard` resolved it
 * from the code that admitted the caller (ADR-0033 decision 5), and the repository filters on it.
 * A missing row and a row the scope hides are the SAME `ERP-CORE-0004`, so an id reveals nothing.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { ReadScope } from '../../../shared/http/decorators/scope.decorator.js';
import {
  parseExportOptions,
  runExport,
  type ExportCell,
  type ExportFile,
} from '../../../shared/http/export.js';
import type {
  ExampleItemListResponseDto,
  ExampleItemResponseDto,
} from '../dto/example-item.dto.js';
import { ExampleItemCreatedV1, ExampleItemUpdatedV1 } from '../events/published.js';
import {
  EXAMPLE_ITEM_EXPORT_COLUMNS,
  EXAMPLE_ITEM_EXPORT_FILE_STEM,
} from '../example-item.routes.js';
import type { ExampleItem } from '../model/example-item.model.js';
import { ExampleItemRepository } from '../repository/example-item.repository.js';
import { ExampleItemEnricher } from './example-item.enricher.js';
import { ExampleItemTransformer } from './example-item.transformer.js';
import { ExampleItemTransport } from './example-item.transport.js';
import { ExampleItemValidator } from './example-item.validator.js';

export interface ExampleItemDescription {
  readonly module: 'example-item';
  readonly version: 1;
}

/** A read under `all` names no owner. */
const ANY_OWNER = 0;

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

/**
 * Each export column's cell over the response DTO, keyed by the column name, so the column list in
 * `example-item.routes.ts` and what is written under it cannot drift (`satisfies`); nothing the
 * wire hides reaches a file. `createdAt` reads in the reader's date format in PDF and Print.
 */
const EXAMPLE_ITEM_EXPORT_CELLS = {
  id: { value: (dto) => dto.id },
  name: { value: (dto) => dto.name },
  label: { value: (dto) => dto.label },
  createdAt: { value: (dto) => dto.createdAt, kind: 'dateTime' },
} as const satisfies Record<
  (typeof EXAMPLE_ITEM_EXPORT_COLUMNS)[number],
  ExportCell<ExampleItemResponseDto>
>;

@Injectable()
export class ExampleItemService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; a use case reads `this.now()`, never `Date.now()`. */
  now: () => number = () => Date.now();

  constructor(
    private readonly validator: ExampleItemValidator,
    private readonly repository: ExampleItemRepository,
    private readonly enricher: ExampleItemEnricher,
    private readonly transformer: ExampleItemTransformer,
    private readonly transport: ExampleItemTransport,
  ) {}

  describe(): ExampleItemDescription {
    return { module: 'example-item', version: 1 };
  }

  /** `GET /api/v1/example-item?limit&cursor&q&sort` — one keyset page and its pager meta. */
  async list(
    input: unknown,
    scope: ReadScope,
    staffId: number,
  ): Promise<ExampleItemListResponseDto> {
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request, scope, staffId);
    return this.transformer.toListResponse(
      page.items.map((item) => this.enricher.enrich(item)),
      page,
    );
  }

  /** `GET /api/v1/example-item/:id` — missing and hidden by the scope are the same 404. */
  async get(params: unknown, scope: ReadScope, staffId: number): Promise<ExampleItemResponseDto> {
    const { id } = this.validator.parseParams(params);
    const item = await this.repository.findById(id, scope, staffId);
    if (item === null) throw notFound();
    return this.toDto(item);
  }

  /** The model for the facade (never the DTO), whoever owns it. */
  findById(id: number): Promise<ExampleItem | null> {
    return this.repository.findById(id, 'all', ANY_OWNER);
  }

  /**
   * `POST /api/v1/example-item` — the strict body; the owner is the actor and the time is the
   * clock's, never the caller's (T-3.2-93). One `ExampleItemCreatedV1` after the write.
   */
  async create(actor: AuthenticatedUser, body: unknown): Promise<ExampleItemResponseDto> {
    const input = this.validator.parseCreateBody(body);
    const item = await this.repository.create({
      name: input.name,
      ownerStaffId: actor.staffId,
      createdAt: new Date(this.now()).toISOString(),
      internalRef: randomUUID(),
    });
    await this.transport.publish(new ExampleItemCreatedV1({ id: item.id, at: item.createdAt }));
    return this.toDto(item);
  }

  /**
   * `PATCH /api/v1/example-item/:id` — `edit` is a full grant, so the row is found under `all`; a
   * missing id is `ERP-CORE-0004`. One `ExampleItemUpdatedV1` after the write.
   */
  async update(params: unknown, body: unknown): Promise<ExampleItemResponseDto> {
    const { id } = this.validator.parseParams(params);
    const patch = this.validator.parseUpdateBody(body);
    const item = await this.repository.update(id, patch);
    if (item === null) throw notFound();
    const at = new Date(this.now()).toISOString();
    await this.transport.publish(new ExampleItemUpdatedV1({ id: item.id, at }));
    return this.toDto(item);
  }

  /**
   * `GET /api/v1/example-item/export?format&column&header&key&q&sort`: every row the list's query
   * matches, as CSV, Excel, PDF or print rows (D-26, D-42, ADR-0043). The shared core parses the
   * export parameters, counts first and refuses over the format's cap before any row is read, then
   * follows the list's own keyset read, so the rows and their order are the list's. This list takes
   * the ticked rows (D-27): the keys become the request's `ids`, AND-ed with `q` and the row scope
   * in the repository, so a key only ever narrows (D-03).
   */
  async exportCsv(input: unknown, scope: ReadScope, staffId: number): Promise<ExportFile> {
    const options = parseExportOptions(input, {
      columns: EXAMPLE_ITEM_EXPORT_COLUMNS,
      keys: 'accept',
    });
    const list = this.validator.parseExportList(input);
    const request = options.keys === null ? list : { ...list, ids: options.keys.map(Number) };
    return runExport({
      stem: EXAMPLE_ITEM_EXPORT_FILE_STEM,
      cells: EXAMPLE_ITEM_EXPORT_CELLS,
      options,
      request,
      count: (read) => this.repository.count(read, scope, staffId),
      page: async (read) => {
        const page = await this.repository.list(read, scope, staffId);
        return { items: page.items.map((item) => this.toDto(item)), nextCursor: page.nextCursor };
      },
      now: new Date(this.now()),
    });
  }

  private toDto(item: ExampleItem): ExampleItemResponseDto {
    return this.transformer.toResponse(this.enricher.enrich(item));
  }
}
