/**
 * Use-case orchestrator of the module. Every step is a call into a rule layer (validator,
 * transformer) or the repository; the controller receives the DTO from here and never imports the
 * transformer (BE-08). Failures are `AppError`s the shared filter maps to problem details.
 *
 * Administrators only. Every use case a handler calls asserts the administrator flag as its FIRST
 * statement, before the input is parsed or a row is read (`__tests__/route-gates.spec.ts` reads it
 * from each method's source). The facade reads (`findById`, `listAll`, `findByIds`) assert nothing:
 * a module-to-module read has no actor.
 *
 * Perfex's flow, reproduced: the list; a create stores the trimmed name; an update changes the
 * name only, with no duplicate check; a delete removes the group and its rows in
 * `tblcustomer_groups` in ONE transaction (the repository). The quick add on the customer profile
 * stays on Perfex and is not touched.
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import type {
  CustomerGroupsListResponseDto,
  CustomerGroupsResponseDto,
} from '../dto/customer-groups.dto.js';
import type { CustomerGroup } from '../model/customer-groups.model.js';
import { CustomerGroupsRepository } from '../repository/customer-groups.repository.js';
import { CustomerGroupsTransformer, toCustomerGroup } from './customer-groups.transformer.js';
import { CustomerGroupsValidator } from './customer-groups.validator.js';

export interface CustomerGroupsDescription {
  readonly module: 'customer-groups';
  readonly version: 1;
}

/** The detail of every administrator refusal: plain, and the same for every use case. */
const ADMIN_ONLY = 'customer groups are managed by administrators only';

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

@Injectable()
export class CustomerGroupsService {
  constructor(
    private readonly validator: CustomerGroupsValidator,
    private readonly repository: CustomerGroupsRepository,
    private readonly transformer: CustomerGroupsTransformer,
    private readonly logger: LoggerService,
  ) {}

  describe(): CustomerGroupsDescription {
    return { module: 'customer-groups', version: 1 };
  }

  /** `GET /api/v1/customer-groups?limit&cursor&q&sort`: one keyset page (the id descending by default). */
  async list(actor: AuthenticatedUser, input: unknown): Promise<CustomerGroupsListResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    return this.transformer.toListResponse(page.items, page);
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
    this.logger.log('customer group updated', { id });
    return this.transformer.toResponse(updated);
  }

  /**
   * `DELETE /api/v1/customer-groups/:id`: a missing id is `ERP-CORE-0004`. The group and its rows
   * in `tblcustomer_groups` are deleted in ONE transaction (the repository).
   */
  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    if ((await this.repository.findById(id)) === null) throw notFound();
    if (!(await this.repository.remove(id))) throw notFound();
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
