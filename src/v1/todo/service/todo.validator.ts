import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import {
  createTodoBodySchema,
  finishTodoBodySchema,
  listTodoQuerySchema,
  todoParamsSchema,
  updateTodoBodySchema,
  type CreateTodoBody,
  type FinishTodoBody,
  type TodoParams,
  type UpdateTodoBody,
} from '../dto/todo.dto.js';
import type { TodoListRequest } from '../model/todo.model.js';

/** `safeParse` -> `AppError('ERP-VALIDATION-0001')` with the zod issues (BE-09). */
function parse<T>(schema: z.ZodType<T>, input: unknown, detail: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new AppError('ERP-VALIDATION-0001', detail, { issues: parsed.error.issues });
  return parsed.data;
}

function refuseCursor(): never {
  throw new AppError('ERP-VALIDATION-0001', 'Query is invalid', {
    issues: [{ path: ['cursor'], message: 'cursor is not a cursor of this list' }],
  });
}

/** The offset an opaque cursor names; anything that is not one of ours is a 400 on `cursor`. */
function decodeOffsetCursor(cursor: string): number {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));

    if (typeof value !== 'object' || value === null || !('o' in value)) {
      return refuseCursor();
    }

    const offset = value.o;

    if (typeof offset === 'number' && Number.isInteger(offset) && offset >= 0) {
      return offset;
    }
  } catch {
    return refuseCursor();
  }

  return refuseCursor();
}

@Injectable()
export class TodoValidator {
  /** `GET` list: `status` is required, `limit` defaults to 20, a missing `cursor` is offset 0. */
  parseListQuery(input: unknown): TodoListRequest {
    const query = parse(listTodoQuerySchema, input, 'Query is invalid');
    return {
      status: query.status,
      limit: query.limit,
      offset: query.cursor === undefined ? 0 : decodeOffsetCursor(query.cursor),
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
}
