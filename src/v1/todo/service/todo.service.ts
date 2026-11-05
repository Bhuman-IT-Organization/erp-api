import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import type { TodoListResponseDto, TodoResponseDto } from '../dto/todo.dto.js';
import { TodoCreatedV1, TodoDeletedV1, TodoUpdatedV1 } from '../events/published.js';
import { TodoRepository } from '../repository/todo.repository.js';
import { companyZone, TodoTransformer, wallClockAt } from './todo.transformer.js';
import { TodoTransport } from './todo.transport.js';
import { TodoValidator } from './todo.validator.js';

export interface TodoDescription {
  readonly module: 'todo';
  readonly version: 1;
}

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

@Injectable()
export class TodoService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; a use case reads `this.now()`. */
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: TodoValidator,
    private readonly repository: TodoRepository,
    private readonly transformer: TodoTransformer,
    private readonly transport: TodoTransport,
    private readonly logger: LoggerService,
  ) {}

  describe(): TodoDescription {
    return { module: 'todo', version: 1 };
  }

  /** `GET /api/v1/todo?status&limit&cursor`: one page of the caller's own to do's. */
  async list(actor: AuthenticatedUser, input: unknown): Promise<TodoListResponseDto> {
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(actor.staffId, request);
    return this.transformer.toListResponse(
      page.items,
      page.total,
      request.offset,
      await this.zone(),
    );
  }

  /** `GET /api/v1/todo/:id`: one of the caller's to do's; anyone else's is `ERP-CORE-0004`. */
  async get(actor: AuthenticatedUser, params: unknown): Promise<TodoResponseDto> {
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(actor.staffId, id);
    if (row === null) throw notFound();
    return this.transformer.toResponse(row, await this.zone());
  }

  /** `POST /api/v1/todo`: `{ description }`; `dateadded` is the wall clock now. */
  async create(actor: AuthenticatedUser, body: unknown): Promise<TodoResponseDto> {
    const input = this.validator.parseCreateBody(body);
    const zone = await this.zone();
    const now = this.now();
    const row = await this.repository.create({
      staffId: actor.staffId,
      description: input.description,
      dateAdded: wallClockAt(now, zone),
    });
    await this.transport.publish(
      new TodoCreatedV1({ id: row.id, staffId: actor.staffId, at: now.toISOString() }),
    );
    this.logger.log('to do created', { id: row.id });
    return this.transformer.toResponse(row, zone);
  }

  /** `PATCH /api/v1/todo/:id`: the description and nothing else. */
  async update(actor: AuthenticatedUser, params: unknown, body: unknown): Promise<TodoResponseDto> {
    const { id } = this.validator.parseParams(params);
    const { description } = this.validator.parseUpdateBody(body);
    const row = await this.repository.updateDescription(actor.staffId, id, description);
    if (row === null) throw notFound();
    await this.publishUpdated(actor, id);
    this.logger.log('to do updated', { id });
    return this.transformer.toResponse(row, await this.zone());
  }

  /** `PATCH /api/v1/todo/:id/finished`: finish (wall clock now) or reopen (`datefinished` NULL). */
  async setFinished(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<TodoResponseDto> {
    const { id } = this.validator.parseParams(params);
    const { finished } = this.validator.parseFinishBody(body);
    const zone = await this.zone();
    const dateFinished = finished ? wallClockAt(this.now(), zone) : null;
    const row = await this.repository.setFinished(actor.staffId, id, finished, dateFinished);
    if (row === null) throw notFound();
    await this.publishUpdated(actor, id);
    this.logger.log(finished ? 'to do finished' : 'to do reopened', { id });
    return this.transformer.toResponse(row, zone);
  }

  /** `DELETE /api/v1/todo/:id`: 204; another member's or a missing to do is `ERP-CORE-0004`. */
  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    const { id } = this.validator.parseParams(params);
    if (!(await this.repository.remove(actor.staffId, id))) throw notFound();
    await this.transport.publish(
      new TodoDeletedV1({ id, staffId: actor.staffId, at: this.now().toISOString() }),
    );
    this.logger.log('to do deleted', { id });
  }

  /** The facade's read: no actor, the caller names the staff member. */
  countUnfinished(staffId: number): Promise<number> {
    return this.repository.countUnfinished(staffId);
  }

  private publishUpdated(actor: AuthenticatedUser, id: number): Promise<void> {
    return this.transport.publish(
      new TodoUpdatedV1({ id, staffId: actor.staffId, at: this.now().toISOString() }),
    );
  }

  /** Perfex's zone: `default_timezone` through the settings facade, `UTC` when unusable (D-31). */
  private async zone(): Promise<string> {
    return companyZone(await this.transport.companyTimeZone());
  }
}
