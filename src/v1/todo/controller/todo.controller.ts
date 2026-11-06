/**
 * HTTP entry for `api/v1/todo`: list, detail, create, update, finish/reopen and delete. Decorators
 * bind the route, the guards and the API documentation (`@ApiZod`, BE-23); the handler hands the
 * actor and the raw input to the service and returns its DTO. Controllers hold no logic, import no
 * transformer and never catch.
 *
 * Every handler carries `JwtAuthGuard, PermissionGuard` (401 `ERP-AUTH-0004` without a valid
 * bearer) and declares NO permission code: any signed-in member manages their own to do's, and the
 * service scopes every query by the caller's staff id.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CurrentUser } from '../../../shared/http/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import {
  createTodoBodySchema,
  finishTodoBodySchema,
  listTodoQuerySchema,
  reorderTodoBodySchema,
  todoListResponseSchema,
  todoParamsSchema,
  todoResponseSchema,
  updateTodoBodySchema,
  type TodoListResponseDto,
  type TodoResponseDto,
} from '../dto/todo.dto.js';
import { TodoService } from '../service/todo.service.js';
import { TODO_ROUTES } from '../todo.routes.js';

@Controller(TODO_ROUTES.base)
export class TodoController {
  constructor(private readonly service: TodoService) {}

  /** `GET /api/v1/todo?status&limit&cursor`: `{ data, meta: { nextCursor, total } }`. */
  @Get(TODO_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: "List the caller's own to do's, one panel at a time (unfinished or finished)",
    query: listTodoQuerySchema,
    responses: { [HTTP_STATUS.OK]: todoListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<TodoListResponseDto> {
    return this.service.list(user, query);
  }

  /** `GET /api/v1/todo/:id`: one of the caller's to do's; anyone else's is a 404. */
  @Get(TODO_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: "Read one of the caller's own to do's",
    params: todoParamsSchema,
    responses: { [HTTP_STATUS.OK]: todoResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-CORE-0004'],
  })
  get(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<TodoResponseDto> {
    return this.service.get(user, params);
  }

  /** `POST /api/v1/todo`: 201 and the to do. */
  @Post(TODO_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Add a to do for the caller',
    body: createTodoBodySchema,
    responses: { [HTTP_STATUS.CREATED]: todoResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004'],
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown): Promise<TodoResponseDto> {
    return this.service.create(user, body);
  }

  /** `PATCH /api/v1/todo/:id`: the to do after the edit. */
  @Patch(TODO_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: "Edit the description of one of the caller's own to do's",
    params: todoParamsSchema,
    body: updateTodoBodySchema,
    responses: { [HTTP_STATUS.OK]: todoResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-CORE-0004'],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<TodoResponseDto> {
    return this.service.update(user, params, body);
  }
  /** `PATCH /api/v1/todo/order`: 204; one of the ids is not the caller's: 404, nothing changed. */
  @Patch(TODO_ROUTES.order)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: "Save the new order of the caller's own to do's (drag and drop)",
    body: reorderTodoBodySchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-CORE-0004'],
  })
  reorder(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown): Promise<void> {
    return this.service.reorder(user, body);
  }
  /** `PATCH /api/v1/todo/:id/finished`: finish or reopen. */
  @Patch(TODO_ROUTES.finished)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: "Finish or reopen one of the caller's own to do's",
    params: todoParamsSchema,
    body: finishTodoBodySchema,
    responses: { [HTTP_STATUS.OK]: todoResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-CORE-0004'],
  })
  setFinished(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<TodoResponseDto> {
    return this.service.setFinished(user, params, body);
  }

  /** `DELETE /api/v1/todo/:id`: 204 with no body; 404 for another member's or a missing to do. */
  @Delete(TODO_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: "Delete one of the caller's own to do's",
    params: todoParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-CORE-0004'],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}
