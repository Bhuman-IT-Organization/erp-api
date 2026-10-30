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
 * Perfex's flow, reproduced: the list in Perfex's order (the name descending); a create stores the
 * trimmed name; an update changes the name only, with no duplicate check. A delete counts the
 * customers of the group in `tblcustomer_groups` (read only: Perfex owns that table and keeps
 * writing it, so Node never writes or deletes a link) and refuses with 409
 * `ERP-CUSTOMERGROUPS-0001` while any customer is in the group; an empty group is deleted.
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
  CUSTOMER_GROUPS_EXPORT_COLUMNS,
  CUSTOMER_GROUPS_EXPORT_FILE_STEM,
} from '../customer-groups.routes.js';
import type {
  CustomerGroupsListResponseDto,
  CustomerGroupsResponseDto,
} from '../dto/customer-groups.dto.js';
import {
  CustomerGroupsCreatedV1,
  CustomerGroupsDeletedV1,
  CustomerGroupsUpdatedV1,
} from '../events/published.js';
import type { CustomerGroup } from '../model/customer-groups.model.js';
import { CustomerGroupsRepository } from '../repository/customer-groups.repository.js';
import {
  CUSTOMER_GROUPS_EXPORT_CELLS,
  CustomerGroupsTransformer,
  toCustomerGroup,
  toExportRow,
} from './customer-groups.transformer.js';
import { CustomerGroupsTransport } from './customer-groups.transport.js';
import { CustomerGroupsValidator } from './customer-groups.validator.js';

export interface CustomerGroupsDescription {
  readonly module: 'customer-groups';
  readonly version: 1;
}

/** The detail of every administrator refusal: plain, and the same for every use case. */
const ADMIN_ONLY = 'customer groups are managed by administrators only';

/** The detail of the in-use refusal (409 `ERP-CUSTOMERGROUPS-0001`). */
const IN_USE = 'The customer group is still in use';

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

@Injectable()
export class CustomerGroupsService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; a use case reads `this.now()`, never `new Date()`. */
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: CustomerGroupsValidator,
    private readonly repository: CustomerGroupsRepository,
    private readonly transformer: CustomerGroupsTransformer,
    private readonly transport: CustomerGroupsTransport,
    private readonly logger: LoggerService,
  ) {}

  describe(): CustomerGroupsDescription {
    return { module: 'customer-groups', version: 1 };
  }

  /** `GET /api/v1/customer-groups?limit&cursor&q&sort`: one keyset page (the name descending by default). */
  async list(actor: AuthenticatedUser, input: unknown): Promise<CustomerGroupsListResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    return this.transformer.toListResponse(page.items, page);
  }

  /**
   * `GET /api/v1/customer-groups/export?format&column&header&q&sort`: every row the list's query
   * matches, as CSV, Excel, PDF or print rows (ADR-0043). Administrators first, for every format,
   * before any parse or count. No row selection: a `key` is a 400.
   */
  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const options = parseExportOptions(input, {
      columns: CUSTOMER_GROUPS_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    return runExport({
      stem: CUSTOMER_GROUPS_EXPORT_FILE_STEM,
      cells: CUSTOMER_GROUPS_EXPORT_CELLS,
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

  /** `GET /api/v1/customer-groups/:id`: one customer group; a missing id is `ERP-CORE-0004`. */
  async get(actor: AuthenticatedUser, params: unknown): Promise<CustomerGroupsResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.transformer.toResponse(row);
  }

  /** `POST /api/v1/customer-groups`: the strict body; the trimmed name is stored. */
  async create(actor: AuthenticatedUser, body: unknown): Promise<CustomerGroupsResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const input = this.validator.parseCreateBody(body);
    const row = await this.repository.create({ name: input.name });
    await this.transport.publish(
      new CustomerGroupsCreatedV1({ id: row.id, at: this.now().toISOString() }),
    );
    this.logger.log('customer group created', { id: row.id });
    return this.transformer.toResponse(row);
  }

  /** `PATCH /api/v1/customer-groups/:id`: the name and nothing else; a missing id is `ERP-CORE-0004`. */
  async update(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<CustomerGroupsResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const { name } = this.validator.parseUpdateBody(body);
    const updated = await this.repository.update(id, { name });
    if (updated === null) throw notFound();
    await this.transport.publish(new CustomerGroupsUpdatedV1({ id, at: this.now().toISOString() }));
    this.logger.log('customer group updated', { id });
    return this.transformer.toResponse(updated);
  }

  /**
   * `DELETE /api/v1/customer-groups/:id`: a missing id is `ERP-CORE-0004`; a group any customer is
   * still in is `ERP-CUSTOMERGROUPS-0001` (409) and nothing is deleted. The customers are counted in
   * `tblcustomer_groups`, which Perfex owns, so this module never writes it. One
   * `CustomerGroupsDeletedV1` after the delete.
   */
  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    if ((await this.repository.findById(id)) === null) throw notFound();
    let customerCount: number;
    try {
      customerCount = await this.repository.countCustomers(id);
    } catch {
      throw new AppError('ERP-CUSTOMERGROUPS-0001', 'its use could not be counted');
    }
    if (customerCount > 0) {
      throw new AppError('ERP-CUSTOMERGROUPS-0001', IN_USE);
    }
    const at = this.now().toISOString();
    if (!(await this.repository.remove(id))) throw notFound();
    await this.transport.publish(new CustomerGroupsDeletedV1({ id, at }));
    this.logger.log('customer group deleted', { id });
  }

  /** The facade's read: one customer group, or `null`. No assertion: a module-to-module read. */
  async findById(id: number): Promise<CustomerGroup | null> {
    const row = await this.repository.findById(id);
    return row === null ? null : toCustomerGroup(row);
  }

  /** The facade's read: every customer group, the name ascending, then the id. */
  async listAll(): Promise<readonly CustomerGroup[]> {
    return (await this.repository.listAll()).map(toCustomerGroup);
  }

  /** The facade's read: the groups with these ids, in the order given, each once, absent ids skipped. */
  async findByIds(ids: readonly number[]): Promise<readonly CustomerGroup[]> {
    const unique = [...new Set(ids)];
    const rows = new Map((await this.repository.findByIds(unique)).map((row) => [row.id, row]));
    return unique.flatMap((id) => {
      const row = rows.get(id);
      return row === undefined ? [] : [toCustomerGroup(row)];
    });
  }

  /** The administrator flag, never a permission code; `ERP-AUTH-0005`. */
  private assertAdministrator(actor: AuthenticatedUser, detail: string): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', detail);
  }
}
