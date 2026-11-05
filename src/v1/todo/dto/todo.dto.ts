import { z } from 'zod';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
export const TODO_DESCRIPTION_MAX = 10_000;
export const TODO_DEFAULT_LIMIT = 1;

/** `GET ?status=unfinished|finished&limit&cursor`. */
export const listTodoQuerySchema = z.object({
  status: z.enum(['unfinished', 'finished']),
  limit: z.coerce
    .number()
    .int()
    .min(LIST_QUERY_LIMITS.min)
    .max(LIST_QUERY_LIMITS.max)
    .default(TODO_DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

export const todoParamsSchema = z.object({ id: z.coerce.number().int().positive() });

/** `POST` and `PATCH :id`: strict, so any other key (`staffid`, `finished`, ...) is a 400. */
export const createTodoBodySchema = z.strictObject({
  description: z.string().trim().min(1).max(TODO_DESCRIPTION_MAX),
});
export const updateTodoBodySchema = createTodoBodySchema;

/** `PATCH :id/finished`. */
export const finishTodoBodySchema = z.strictObject({ finished: z.boolean() });

export const todoResponseSchema = z
  .object({
    id: z.string(),
    description: z.string(),
    finished: z.boolean(),
    dateAdded: z.iso.datetime().nullable(),
    dateFinished: z.iso.datetime().nullable(),
  })
  .readonly();

export const todoListResponseSchema = z
  .object({
    data: z.array(todoResponseSchema),
    meta: z.object({
      nextCursor: z.string().nullable(),
      total: z.number().int().nonnegative(),
    }),
  })
  .readonly();

export type ListTodoQuery = z.infer<typeof listTodoQuerySchema>;
export type TodoParams = z.infer<typeof todoParamsSchema>;
export type CreateTodoBody = z.infer<typeof createTodoBodySchema>;
export type UpdateTodoBody = z.infer<typeof updateTodoBodySchema>;
export type FinishTodoBody = z.infer<typeof finishTodoBodySchema>;
export type TodoResponseDto = z.infer<typeof todoResponseSchema>;
export type TodoListResponseDto = z.infer<typeof todoListResponseSchema>;
