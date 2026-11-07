import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import {
  createTodoBodySchema,
  finishTodoBodySchema,
  listTodoQuerySchema,
  reorderTodoBodySchema,
  todoParamsSchema,
  updateTodoBodySchema,
  type CreateTodoBody,
  type FinishTodoBody,
  type ReorderTodoBody,
  type TodoParams,
  type UpdateTodoBody,
} from '../dto/todo.dto.js';
import type { TodoListRequest } from '../model/todo.model.js';
import { decodeTodoCursor } from '../repository/todo.cursor.js';

/** `safeParse` -> `AppError('ERP-VALIDATION-0001')` with the zod issues (BE-09). */
function parse<T>(schema: z.ZodType<T>, input: unknown, detail: string): T {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    throw new AppError('ERP-VALIDATION-0001', detail, {
      issues: parsed.error.issues,
    });
  }

  return parsed.data;
}

@Injectable()
export class TodoValidator {
  /** `GET` list: status is required, limit defaults to 10, cursor starts after the last row. */
  parseListQuery(input: unknown): TodoListRequest {
    const query = parse(listTodoQuerySchema, input, 'Query is invalid');

    return {
      status: query.status,
      limit: query.limit,
      cursor: decodeTodoCursor(query.cursor),
    };
  }

  /** `:id`: a non-numeric or non-positive id is a 400, never a 404 probe. */
  parseParams(input: unknown): TodoParams {
    return parse(todoParamsSchema, input, 'Path parameter is invalid');
  }

  /** `POST`: `{ description }`, strict. */
  parseCreateBody(input: unknown): CreateTodoBody {
    return parse(createTodoBodySchema, input, 'Request body is invalid');
  }

  /** `PATCH :id`: the same body. */
  parseUpdateBody(input: unknown): UpdateTodoBody {
    return parse(updateTodoBodySchema, input, 'Request body is invalid');
  }

  /** `PATCH :id/finished`: `{ finished }`, strict. */
  parseFinishBody(input: unknown): FinishTodoBody {
    return parse(finishTodoBodySchema, input, 'Request body is invalid');
  }

  /** `PATCH /order`: ordered ids and their finished panel. */
  parseReorderBody(input: unknown): ReorderTodoBody {
    return parse(reorderTodoBodySchema, input, 'Request body is invalid');
  }
}
