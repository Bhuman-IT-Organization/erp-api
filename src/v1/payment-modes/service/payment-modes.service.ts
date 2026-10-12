/**
 * Use-case orchestrator of the module. Every step is a call into a rule layer (validator,
 * transformer), the repository or the transport; nothing here touches a database client, `fetch`
 * or a breaker directly, and the controller receives the DTO from here: it never imports the
 * transformer (BE-08). Failures are `AppError`s the shared filter maps to problem details.
 *
 * Administrators only (D-06, D-32, BE-25). Every use case a handler calls asserts the administrator
 * flag as its FIRST statement, before the input is parsed, a row is read or the settings facade is
 * asked, so a refused caller learns nothing: `PermissionGuard` admits a handler that declares no
 * code, and this assertion is the only gate (T-4.1-111; `__tests__/route-gates.spec.ts` reads it
 * from each method's source). Perfex's own screen was administrator-only too (`Paymentmodes.php:11`).
 * The facade reads (`findById`, `listAll`, `findByIds`) assert nothing: a module-to-module read has
 * no actor.
 *
 * Perfex's Payment Modes flow, reproduced (D-34, D-29): the list in Perfex's order (the name
 * ascending), each row with its usage and whether Perfex's credit-expense option names it; a create
 * and an update write the seven fields of Perfex's form (the description stored as Perfex's
 * `nl2br_save_html` stores it, an absent box saved 0, every field rewritten on an update, a
 * duplicate name accepted); the one-click switch writes `active` only and is allowed for every mode;
 * a delete is refused for the mode Perfex's `expense_credit_payment_mode` names
 * (`ERP-PAYMENTMODES-0002`, D-37, checked first) and while anything in `PAYMENT_MODE_REFERENCES`
 * holds the mode or its use cannot be counted (`ERP-PAYMENTMODES-0001`, D-33). Each 409 detail
 * names counts or the reason only, never a name or the setting's value (T-4.1-121), and points to
 * switching the mode off.
 *
 * Every change publishes its event through the transport AFTER the write, then writes one `log`
 * line with the id only (D-36; BE-10 merges `requestId` and `staffId` from the request context).
 * Node writes nothing to Perfex's activity log (D-18).
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { parseExportOptions, runExport, type ExportFile } from '../../../shared/http/export.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import type {
  PaymentModesActiveResponseDto,
  PaymentModesBody,
  PaymentModesListResponseDto,
  PaymentModesResponseDto,
} from '../dto/payment-modes.dto.js';
import {
  PaymentModesActiveChangedV1,
  PaymentModesCreatedV1,
  PaymentModesDeletedV1,
  PaymentModesUpdatedV1,
} from '../events/published.js';
import type {
  NewPaymentMode,
  PaymentMode,
  PaymentModeRow,
  PaymentModeUsage,
} from '../model/payment-modes.model.js';
import {
  PAYMENT_MODES_EXPORT_COLUMNS,
  PAYMENT_MODES_EXPORT_FILE_STEM,
} from '../payment-modes.routes.js';
import { PaymentModesRepository } from '../repository/payment-modes.repository.js';
import {
  fromFlag,
  isCreditExpenseMode,
  PAYMENT_MODES_EXPORT_CELLS,
  PaymentModesTransformer,
  toExportRow,
  toPaymentMode,
  toStoredDescription,
} from './payment-modes.transformer.js';
import { PaymentModesTransport } from './payment-modes.transport.js';
import { PaymentModesValidator } from './payment-modes.validator.js';

export interface PaymentModesDescription {
  readonly module: 'payment-modes';
  readonly version: 1;
}

/** The detail of every administrator refusal: plain, and the same for every use case. */
const ADMIN_ONLY = 'payment modes are managed by administrators only';

/** The way out every delete refusal names: a mode in use, or the credit mode, is retired by switching it off. */
const SWITCH_OFF = 'switch it off instead to stop offering it';

/** The detail when the usage answer does not name the id: an unknown count refuses. */
const NOT_COUNTED = 'its use could not be counted';

/** The D-37 refusal: why, and that switching it off stays allowed. */
const CREDIT_MODE = `expenses use this payment mode to mark a credit expense (a Perfex setting), so it cannot be deleted; ${SWITCH_OFF}`;

/** Each usage group's words in a 409 detail, in the order the detail lists them. */
const GROUP_WORDS = [
  ['invoicePayments', 'invoice payment(s)'],
  ['expenses', 'expense(s)'],
  ['creditNoteRefunds', 'credit note refund(s)'],
  ['purchaseInvoicePayments', 'purchase invoice payment(s)'],
  ['purchaseOrderPayments', 'purchase order payment(s)'],
  ['debitNoteRefunds', 'debit note refund(s)'],
  ['fixedEquipmentRefunds', 'fixed equipment refund(s)'],
  ['orderReturnRefunds', 'order return refund(s)'],
] as const satisfies readonly (readonly [keyof PaymentModeUsage, string])[];

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

/**
 * The D-33 refusal: unknown usage, or `used by 2 invoice payment(s), 1 expense(s) and 4 order
 * return refund(s); switch it off ...` over the non-zero groups only, in `GROUP_WORDS` order;
 * `null` when nothing uses the payment mode.
 */
function inUse(usage: PaymentModeUsage | undefined): AppError | null {
  if (usage === undefined) return new AppError('ERP-PAYMENTMODES-0001', NOT_COUNTED);
  const parts = GROUP_WORDS.filter(([group]) => usage[group] > 0).map(
    ([group, words]) => `${String(usage[group])} ${words}`,
  );
  const last = parts.pop();
  if (last === undefined) return null;
  const list = parts.length === 0 ? last : `${parts.join(', ')} and ${last}`;
  return new AppError('ERP-PAYMENTMODES-0001', `used by ${list}; ${SWITCH_OFF}`);
}

/** The seven columns from a parsed body, as Perfex saves them: the stored description, each box 0 or 1. */
function storedOf(body: PaymentModesBody): NewPaymentMode {
  return {
    name: body.name,
    description: toStoredDescription(body.description ?? ''),
    active: body.active === true,
    showOnPdf: fromFlag(body.showOnPdf),
    selectedByDefault: fromFlag(body.selectedByDefault),
    invoicesOnly: fromFlag(body.invoicesOnly),
    expensesOnly: fromFlag(body.expensesOnly),
  };
}

@Injectable()
export class PaymentModesService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; a use case reads `this.now()`, never `new Date()`. */
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: PaymentModesValidator,
    private readonly repository: PaymentModesRepository,
    private readonly transformer: PaymentModesTransformer,
    private readonly transport: PaymentModesTransport,
    private readonly logger: LoggerService,
  ) {}

  describe(): PaymentModesDescription {
    return { module: 'payment-modes', version: 1 };
  }

  /**
   * `GET /api/v1/payment-modes?limit&cursor&q&sort`: one keyset page (the name ascending by
   * default), the page's usage read once and the credit-expense option read once.
   */
  async list(actor: AuthenticatedUser, input: unknown): Promise<PaymentModesListResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    const usage = await this.repository.usageByPaymentMode(page.items.map((row) => row.id));
    const setting = await this.transport.creditExpenseMode();
    return this.transformer.toListResponse(page.items, usage, setting, page);
  }

  /** `GET /api/v1/payment-modes/:id`: the payment mode with its usage and lock; a missing id is `ERP-CORE-0004`. */
  async get(actor: AuthenticatedUser, params: unknown): Promise<PaymentModesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.record(row);
  }

  /**
   * `POST /api/v1/payment-modes`: the seven fields as Perfex saves them (D-34). One
   * `PaymentModesCreatedV1` after the write, then the log line; the new row's usage is zero.
   */
  async create(actor: AuthenticatedUser, body: unknown): Promise<PaymentModesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const input = this.validator.parseCreateBody(body);
    const row = await this.repository.create(storedOf(input));
    await this.transport.publish(
      new PaymentModesCreatedV1({ id: row.id, at: this.now().toISOString() }),
    );
    this.logger.log('payment mode created', { id: row.id });
    return this.transformer.toResponse(row, new Map(), await this.transport.creditExpenseMode());
  }

  /**
   * `PATCH /api/v1/payment-modes/:id`: all seven rewritten, as Perfex's edit does; no lock (Perfex
   * has none; D-37 guards the delete only). A missing id is `ERP-CORE-0004`. One
   * `PaymentModesUpdatedV1` after the write, then the log line.
   */
  async update(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<PaymentModesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const input = this.validator.parseUpdateBody(body);
    const updated = await this.repository.update(id, storedOf(input));
    if (updated === null) throw notFound();
    await this.transport.publish(new PaymentModesUpdatedV1({ id, at: this.now().toISOString() }));
    this.logger.log('payment mode updated', { id });
    return this.record(updated);
  }

  /**
   * `PATCH /api/v1/payment-modes/:id/active`: the one-click switch (D-34). The row is read first: a
   * missing id is `ERP-CORE-0004`; a flag already so answers `{ id, active }` with no write, no event
   * and no log line; otherwise `active` alone is written, one `PaymentModesActiveChangedV1` follows
   * and one log line. Allowed for the credit-expense mode and a mode in use: switching off is how
   * either is retired (D-37, D-33).
   */
  async setActive(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<PaymentModesActiveResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const { active } = this.validator.parseActiveBody(body);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    if (row.active === active) return this.transformer.toActiveResponse(id, active);
    if (!(await this.repository.setActive(id, active))) throw notFound();
    await this.transport.publish(
      new PaymentModesActiveChangedV1({ id, active, at: this.now().toISOString() }),
    );
    this.logger.log(active ? 'payment mode activated' : 'payment mode deactivated', { id });
    return this.transformer.toActiveResponse(id, active);
  }

  /**
   * `DELETE /api/v1/payment-modes/:id`: a missing id is `ERP-CORE-0004`; the mode Perfex's
   * `expense_credit_payment_mode` names is `ERP-PAYMENTMODES-0002` (D-37, checked BEFORE the usage,
   * which is then never read); a mode anything in `PAYMENT_MODE_REFERENCES` still holds (or whose
   * use cannot be counted) is `ERP-PAYMENTMODES-0001`, naming the non-zero groups (D-33). Nothing is
   * deleted on a refusal. A row gone between the read and the delete is the same 404. One
   * `PaymentModesDeletedV1` after the delete, then the log line. The check-then-delete window is
   * accepted (T-4.1-122): Perfex's own delete checked two of the eight columns.
   */
  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    if ((await this.repository.findById(id)) === null) throw notFound();
    if (isCreditExpenseMode(id, await this.transport.creditExpenseMode())) {
      throw new AppError('ERP-PAYMENTMODES-0002', CREDIT_MODE);
    }
    const usage = await this.repository.usageByPaymentMode([id]);
    const refusal = inUse(usage.get(id));
    if (refusal !== null) throw refusal;
    const at = this.now().toISOString();
    if (!(await this.repository.remove(id))) throw notFound();
    await this.transport.publish(new PaymentModesDeletedV1({ id, at }));
    this.logger.log('payment mode deleted', { id });
  }

  /**
   * `GET /api/v1/payment-modes/export?format&column&header&q&sort`: every row the list's query
   * matches, as CSV, Excel, PDF or print rows (ADR-0043). **Administrators first**, for every format,
   * before any parse or count. No row selection here: a `key` is a 400. The cells are the id, the
   * name, the description's read form and `active`; neither the usage nor the setting is read. The
   * generated handler name is kept.
   */
  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const options = parseExportOptions(input, {
      columns: PAYMENT_MODES_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    return runExport({
      stem: PAYMENT_MODES_EXPORT_FILE_STEM,
      cells: PAYMENT_MODES_EXPORT_CELLS,
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

  /** The facade's read: one payment mode, or `null`. No assertion: a module-to-module read. */
  async findById(id: number): Promise<PaymentMode | null> {
    const row = await this.repository.findById(id);
    return row === null ? null : toPaymentMode(row);
  }

  /** The facade's read: every payment mode, the name ascending, then the id. */
  async listAll(): Promise<readonly PaymentMode[]> {
    return (await this.repository.listAll()).map(toPaymentMode);
  }

  /** The facade's read: the payment modes with these ids, in the order given, each once, absent ids skipped. */
  async findByIds(ids: readonly number[]): Promise<readonly PaymentMode[]> {
    const unique = [...new Set(ids)];
    const rows = new Map((await this.repository.findByIds(unique)).map((row) => [row.id, row]));
    return unique.flatMap((id) => {
      const row = rows.get(id);
      return row === undefined ? [] : [toPaymentMode(row)];
    });
  }

  /** One record with its usage and the credit-expense option. */
  private async record(row: PaymentModeRow): Promise<PaymentModesResponseDto> {
    const usage = await this.repository.usageByPaymentMode([row.id]);
    return this.transformer.toResponse(row, usage, await this.transport.creditExpenseMode());
  }

  /** D-06: the administrator flag, never a permission code; `ERP-AUTH-0005` (never identity's code). */
  private assertAdministrator(actor: AuthenticatedUser, detail: string): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', detail);
  }
}
