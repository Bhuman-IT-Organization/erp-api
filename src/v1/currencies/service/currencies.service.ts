/**
 * Use-case orchestrator of the module. Every step is a call into a rule layer (validator,
 * transformer), the repository, the usage registry or the transport; nothing here touches a
 * database client, `fetch` or a breaker directly, and the controller receives the DTO from here: it
 * never imports the transformer (BE-08). Failures are `AppError`s the shared filter maps to problem
 * details.
 *
 * Administrators only (D-06, D-38, BE-25). Every use case a handler calls asserts the administrator
 * flag as its FIRST statement, before the input is parsed, a row is read or a registered counter is
 * asked, so a refused caller learns nothing: `PermissionGuard` admits a handler that declares no
 * code, and this assertion is the only gate (T-4.1-145; `__tests__/route-gates.spec.ts` reads it
 * from each method's source). Perfex's own screen was administrator-only too (`Currencies.php:11`).
 * The facade paths (`listAll`, `baseCurrency`, `registerUsage`) assert nothing: a module-to-module
 * call has no actor.
 *
 * Perfex's Currencies flow, reproduced (D-38, D-29): the list in Perfex's order (the code
 * descending), each row with what uses it (`usage`, `lockUsage`, the counters other modules
 * registered) and whether it can be made the base; a create and an update write Perfex's five form
 * fields (the code through the shared schema, an update rewriting all five, a code another currency
 * holds accepted). Make-base keeps Perfex's rule (D-39, `Currencies_model.php:142-151`): refused
 * (`ERP-CURRENCIES-0004`) while the CURRENT base has a use in Perfex's seven core columns; a row
 * already the base is a no-op. A delete is refused, in this order: while any delete-counting register
 * line holds the currency (`0001`, D-40), for the base (`0002`, Perfex), while a registered counter
 * answers more than 0 (`0003`, D-41). A code change (the stored code against the shared schema's
 * output, as bytes) is refused (`0005`) while ANY use holds the currency: a register line of either
 * half or a registered counter (D-42 widened, answers 2 and 8 c); the rule is permanent. A count
 * nobody could read refuses with `its use could not be counted` (fail closed). Each 409 detail names
 * counts and plain words only.
 *
 * Every change publishes its event through the transport AFTER the write, then writes one `log`
 * line with the id only (D-43; BE-10 merges `requestId` and `staffId` from the request context).
 * Node writes nothing to Perfex's activity log (D-18).
 *
 * The registered counters (D-41 inverted): every counter `CurrencyUsageRegistry` holds is asked for
 * each id in one `Promise.all`; a counter that rejects or answers anything but a non-negative integer
 * fails the read closed.
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { parseExportOptions, runExport, type ExportFile } from '../../../shared/http/export.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { CURRENCIES_EXPORT_COLUMNS, CURRENCIES_EXPORT_FILE_STEM } from '../currencies.routes.js';
import type {
  CurrenciesBaseResponseDto,
  CurrenciesBody,
  CurrenciesListResponseDto,
  CurrenciesResponseDto,
} from '../dto/currencies.dto.js';
import {
  CurrenciesBaseChangedV1,
  CurrenciesCreatedV1,
  CurrenciesDeletedV1,
  CurrenciesUpdatedV1,
} from '../events/published.js';
import type { Currency, CurrencyRow, NewCurrency } from '../model/currencies.model.js';
import { CurrenciesRepository } from '../repository/currencies.repository.js';
import {
  BASE_DETAIL,
  baseLockedDetail,
  codeLockedDetail,
  coreInUse,
  CURRENCIES_EXPORT_CELLS,
  CurrenciesTransformer,
  inUseDetail,
  NO_CURRENCY_REFERENCES,
  NOT_COUNTED,
  registeredDetail,
  toCurrency,
  toExportRow,
  toResponse,
  type RegisteredCount,
} from './currencies.transformer.js';
import { CurrenciesTransport } from './currencies.transport.js';
import { CurrenciesValidator } from './currencies.validator.js';
import { CurrencyUsageRegistry, type CurrencyUsageCounter } from './currency-usage.registry.js';

export interface CurrenciesDescription {
  readonly module: 'currencies';
  readonly version: 1;
}

/** One counter asked about one id: the pair the registered read runs. */
interface CounterQuestion {
  readonly id: number;
  readonly counter: CurrencyUsageCounter;
}

/** The detail of every administrator refusal: plain, and the same for every use case. */
const ADMIN_ONLY = 'currencies are managed by administrators only';

/** A refusal code whose read can fail: an unknown count refuses with that code (fail closed). */
type CountedRefusal =
  'ERP-CURRENCIES-0001' | 'ERP-CURRENCIES-0003' | 'ERP-CURRENCIES-0004' | 'ERP-CURRENCIES-0005';

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

/** `read`'s answer; any failure becomes `code` with `its use could not be counted`. */
async function counted<T>(read: Promise<T>, code: CountedRefusal): Promise<T> {
  try {
    return await read;
  } catch {
    throw new AppError(code, NOT_COUNTED);
  }
}

/** The five columns from a parsed body; the code is already the shared schema's output. */
function storedOf(body: CurrenciesBody): NewCurrency {
  return {
    name: body.name,
    symbol: body.symbol,
    decimalSeparator: body.decimalSeparator,
    thousandSeparator: body.thousandSeparator,
    placement: body.placement,
  };
}

/** Every counter asked about one id (named, so the caller's `flatMap` holds no nested callback). */
function questionsFor(
  id: number,
  counters: readonly CurrencyUsageCounter[],
): readonly CounterQuestion[] {
  return counters.map((counter) => ({ id, counter }));
}

/** A counter's answer, refused unless it is a non-negative integer (fail closed). */
async function countOf(question: CounterQuestion): Promise<number> {
  const answer: unknown = await question.counter.count(question.id);
  if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0) {
    throw new Error(`currency usage ${question.counter.key} answered something other than a count`);
  }
  return answer;
}

@Injectable()
export class CurrenciesService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; a use case reads `this.now()`, never `new Date()`. */
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: CurrenciesValidator,
    private readonly repository: CurrenciesRepository,
    private readonly transformer: CurrenciesTransformer,
    private readonly transport: CurrenciesTransport,
    private readonly registry: CurrencyUsageRegistry,
    private readonly logger: LoggerService,
  ) {}

  describe(): CurrenciesDescription {
    return { module: 'currencies', version: 1 };
  }

  /**
   * `GET /api/v1/currencies?limit&cursor&q&sort`: one keyset page (the code descending by default);
   * the page's register counts, the registered counters for its ids and the base state read in one
   * `Promise.all`.
   */
  async list(actor: AuthenticatedUser, input: unknown): Promise<CurrenciesListResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    const [counts, registered, baseLocked] = await Promise.all([
      this.repository.usageByCurrency(page.items),
      this.registeredFor(page.items.map((row) => row.id)),
      this.baseLocked(),
    ]);
    return this.transformer.toListResponse(page.items, counts, registered, baseLocked, page);
  }

  /** `GET /api/v1/currencies/:id`: the currency with every count; a missing id is `ERP-CORE-0004`. */
  async get(actor: AuthenticatedUser, params: unknown): Promise<CurrenciesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.record(row);
  }

  /** `POST /api/v1/currencies`: the five fields (D-38). One `CurrenciesCreatedV1` after the write, then the log line. */
  async create(actor: AuthenticatedUser, body: unknown): Promise<CurrenciesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const input = this.validator.parseCreateBody(body);
    const row = await this.repository.create(storedOf(input));
    await this.transport.publish(
      new CurrenciesCreatedV1({ id: row.id, at: this.now().toISOString() }),
    );
    this.logger.log('currency created', { id: row.id });
    return this.record(row);
  }

  /**
   * `PATCH /api/v1/currencies/:id`: all five rewritten, as Perfex's edit does. A missing id is
   * `ERP-CORE-0004`. When the code changes (the stored bytes against the shared schema's output),
   * the register counts and the registered counters are read first, and any use refuses with
   * `ERP-CURRENCIES-0005` before the write (D-42 widened); the symbol, the separators and the
   * placement are never locked. One `CurrenciesUpdatedV1` after the write, then the log line.
   */
  async update(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<CurrenciesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const input = this.validator.parseUpdateBody(body);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    if (input.name !== row.name) await this.assertCodeFree(row);
    const updated = await this.repository.update(id, storedOf(input));
    if (updated === null) throw notFound();
    await this.transport.publish(new CurrenciesUpdatedV1({ id, at: this.now().toISOString() }));
    this.logger.log('currency updated', { id });
    return this.record(updated);
  }

  /**
   * `PATCH /api/v1/currencies/:id/base`: Perfex's make-base (D-39). A missing id is `ERP-CORE-0004`;
   * a row already the base answers `{ id, isBase: true }` with no write, no event and no log line;
   * while the current base has a use in Perfex's seven core columns, `ERP-CURRENCIES-0004` naming
   * them; otherwise the row becomes the base and every other row is cleared in one transaction, one
   * `CurrenciesBaseChangedV1 { id, previousId, at }` follows and one log line.
   */
  async makeBase(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<CurrenciesBaseResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    this.validator.parseBaseBody(body);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    if (row.isBase) return this.transformer.toBaseResponse(id);
    const base = await this.repository.findBase();
    if (base !== null) {
      const counts = await counted(this.repository.usageByCurrency([base]), 'ERP-CURRENCIES-0004');
      const locked = baseLockedDetail((counts.get(base.id) ?? NO_CURRENCY_REFERENCES).usage);
      if (locked !== null) throw new AppError('ERP-CURRENCIES-0004', locked);
    }
    if (!(await this.repository.setBase(id))) throw notFound();
    const previousId = base?.id ?? null;
    await this.transport.publish(
      new CurrenciesBaseChangedV1({ id, previousId, at: this.now().toISOString() }),
    );
    this.logger.log('base currency changed', { id, previousId });
    return this.transformer.toBaseResponse(id);
  }

  /**
   * `DELETE /api/v1/currencies/:id`: a missing id is `ERP-CORE-0004`; then, in order, 409
   * `ERP-CURRENCIES-0001` while a delete-counting register line holds the currency (D-40; the
   * exchange rates never count), `0002` for the base (Perfex), `0003` while a registered counter
   * answers more than 0 (D-41; read only after the first two pass). An unknown count refuses with
   * its code. Nothing is deleted and nothing published on a refusal; a row gone between the read
   * and the delete is the same 404. One `CurrenciesDeletedV1` after the delete, then the log line.
   * The check-then-delete window is accepted (T-4.1-158).
   */
  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    const counts = await counted(this.repository.usageByCurrency([row]), 'ERP-CURRENCIES-0001');
    const usage = counts.get(id);
    if (usage === undefined) throw new AppError('ERP-CURRENCIES-0001', NOT_COUNTED);
    const inUse = inUseDetail(usage.usage);
    if (inUse !== null) throw new AppError('ERP-CURRENCIES-0001', inUse);
    if (row.isBase) throw new AppError('ERP-CURRENCIES-0002', BASE_DETAIL);
    const registered = await counted(this.registeredFor([id]), 'ERP-CURRENCIES-0003');
    const used = registeredDetail(registered.get(id) ?? []);
    if (used !== null) throw new AppError('ERP-CURRENCIES-0003', used);
    const at = this.now().toISOString();
    if (!(await this.repository.remove(id))) throw notFound();
    await this.transport.publish(new CurrenciesDeletedV1({ id, at }));
    this.logger.log('currency deleted', { id });
  }

  /**
   * `GET /api/v1/currencies/export?format&column&header&q&sort`: every row the list's query
   * matches, as CSV, Excel, PDF or print rows (ADR-0043). No row selection: a `key` is a 400. The
   * cells are the code, the symbol and `isBase`; no count is read.
   */
  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const options = parseExportOptions(input, {
      columns: CURRENCIES_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    return runExport({
      stem: CURRENCIES_EXPORT_FILE_STEM,
      cells: CURRENCIES_EXPORT_CELLS,
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

  /** The facade's read: every currency, the id ascending (D-44). No assertion: a module-to-module read. */
  async listAll(): Promise<readonly Currency[]> {
    return (await this.repository.listAll()).map(toCurrency);
  }

  /** The facade's read: the first `isdefault` row by id, or `null` (D-44; branding's base). */
  async baseCurrency(): Promise<Currency | null> {
    const row = await this.repository.findBase();
    return row === null ? null : toCurrency(row);
  }

  /** The facade's registration (D-41 inverted): throws on a malformed or duplicate counter. */
  registerUsage(counter: CurrencyUsageCounter): void {
    this.registry.register(counter);
  }

  /**
   * Every registered counter's answer for each id, in key order, in one `Promise.all`; a rejecting
   * counter or a malformed answer rejects (fail closed).
   *
   * @complexity O(i * c) calls over the ids and the counters
   */
  private async registeredFor(
    ids: readonly number[],
  ): Promise<ReadonlyMap<number, readonly RegisteredCount[]>> {
    const questions = ids.flatMap((id) => questionsFor(id, this.registry.counters()));
    const answers = await Promise.all(questions.map(countOf));
    const byId = new Map<number, RegisteredCount[]>(ids.map((id) => [id, []]));
    questions.forEach((question, index) => {
      byId.get(question.id)?.push({
        key: question.counter.key,
        noun: question.counter.noun,
        count: answers[index] ?? 0,
      });
    });
    return byId;
  }

  /** Perfex's make-base rule (D-39): the current base has a use in its seven core columns. */
  private async baseLocked(): Promise<boolean> {
    const base = await this.repository.findBase();
    if (base === null) return false;
    const counts = await this.repository.usageByCurrency([base]);
    return coreInUse((counts.get(base.id) ?? NO_CURRENCY_REFERENCES).usage) > 0;
  }

  /**
   * D-42 widened (answers 2 and 8 c): refuses a code change with `ERP-CURRENCIES-0005` while any
   * register line of either half or any registered counter holds the currency, or when a count
   * cannot be read.
   */
  private async assertCodeFree(row: CurrencyRow): Promise<void> {
    const [counts, registered] = await counted(
      Promise.all([this.repository.usageByCurrency([row]), this.registeredFor([row.id])]),
      'ERP-CURRENCIES-0005',
    );
    const own = counts.get(row.id);
    if (own === undefined) throw new AppError('ERP-CURRENCIES-0005', NOT_COUNTED);
    const locked = codeLockedDetail(own, registered.get(row.id) ?? []);
    if (locked !== null) throw new AppError('ERP-CURRENCIES-0005', locked);
  }

  /** D-06: the administrator flag, never a permission code; `ERP-AUTH-0005` (never identity's code). */
  private assertAdministrator(actor: AuthenticatedUser, detail: string): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', detail);
  }

  /** One record with every count and its `canMakeBase`. */
  private async record(row: CurrencyRow): Promise<CurrenciesResponseDto> {
    const [counts, registered, baseLocked] = await Promise.all([
      this.repository.usageByCurrency([row]),
      this.registeredFor([row.id]),
      this.baseLocked(),
    ]);
    return toResponse(
      row,
      counts.get(row.id) ?? NO_CURRENCY_REFERENCES,
      registered.get(row.id) ?? [],
      baseLocked,
    );
  }
}
