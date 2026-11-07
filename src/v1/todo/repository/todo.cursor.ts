import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import type { TodoCursor } from '../model/todo.model.js';

const todoCursorSchema = z.strictObject({
  itemOrder: z.number().int().nullable(),
  todoid: z.number().int().positive(),
});

function invalidCursor(): never {
  throw new AppError('ERP-VALIDATION-0001', 'Query is invalid', {
    issues: [
      {
        path: ['cursor'],
        message: 'cursor is not a valid todo cursor',
      },
    ],
  });
}

export function encodeTodoCursor(todo: TodoCursor): string {
  return Buffer.from(JSON.stringify(todo), 'utf8').toString('base64url');
}

export function decodeTodoCursor(raw: string | null | undefined): TodoCursor | null {
  if (raw === null || raw === undefined) return null;

  try {
    const decoded: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const parsed = todoCursorSchema.safeParse(decoded);

    if (!parsed.success) return invalidCursor();

    return parsed.data;
  } catch {
    return invalidCursor();
  }
}

/**
 * MySQL ascending order:
 * 1. NULL item_order values
 * 2. Non-NULL item_order values
 * 3. todoid breaks ties
 */
export function todoCursorWhere(cursor: TodoCursor) {
  if (cursor.itemOrder === null) {
    return {
      OR: [
        { item_order: { not: null } },
        {
          item_order: null,
          todoid: { gt: cursor.todoid },
        },
      ],
    };
  }

  return {
    OR: [
      { item_order: { gt: cursor.itemOrder } },
      {
        item_order: cursor.itemOrder,
        todoid: { gt: cursor.todoid },
      },
    ],
  };
}
