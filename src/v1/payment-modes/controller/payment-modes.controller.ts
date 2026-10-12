/**
 * HTTP entry for `api/v1/payment-modes`: the seven routes the screens call (list, export, detail,
 * create, update, the one-click active switch and delete). Decorators bind the route, the guards
 * and the API documentation (`@ApiZod` names the zod schemas and the error codes, BE-23), the
 * handler hands the actor and the raw input to the service and returns its DTO. Controllers hold no
 * logic, import no transformer and never catch (the architecture block rejects a `try` here): every
 * failure reaches `ProblemDetailsFilter`.
 *
 * Administrators only (D-06, D-32, BE-25): every handler carries `JwtAuthGuard, PermissionGuard`
 * (401 `ERP-AUTH-0004` without a valid bearer) and declares NO permission code, so the guard admits
 * any signed-in member and the service's `assertAdministrator` answers 403 `ERP-AUTH-0005` to anyone
 * without the administrator flag. `@erp/contracts`' `ROUTE_GATES` declares the three screens
 * `'admin'`; `__tests__/route-gates.spec.ts` compares every handler with it.
 *
 * The static `export` segment is declared before `:id`; find-my-way serves it first anyway.
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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CurrentUser } from '../../../shared/http/decorators/current-user.decorator.js';
import { replyExport, type ExportFile } from '../../../shared/http/export.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import {
  createPaymentModesBodySchema,
  exportPaymentModesQuerySchema,
  listPaymentModesQuerySchema,
  paymentModesActiveBodySchema,
  paymentModesActiveResponseSchema,
  paymentModesListResponseSchema,
  paymentModesParamsSchema,
  paymentModesResponseSchema,
  updatePaymentModesBodySchema,
  type PaymentModesActiveResponseDto,
  type PaymentModesListResponseDto,
  type PaymentModesResponseDto,
} from '../dto/payment-modes.dto.js';
import { PAYMENT_MODES_ROUTES } from '../payment-modes.routes.js';
import { PaymentModesService } from '../service/payment-modes.service.js';

@Controller(PAYMENT_MODES_ROUTES.base)
export class PaymentModesController {
  constructor(private readonly service: PaymentModesService) {}

  /** `GET /api/v1/payment-modes?limit&cursor&q&sort`: the BE-19 envelope, each row with its usage and lock. */
  @Get(PAYMENT_MODES_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'List payment modes with their usage (administrators only; keyset paging, one sort, q)',
    query: listPaymentModesQuerySchema,
    responses: { [HTTP_STATUS.OK]: paymentModesListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<PaymentModesListResponseDto> {
    return this.service.list(user, query);
  }

  /**
   * `GET /api/v1/payment-modes/export?format&column&header&q&sort`: every row the list's query
   * matches as CSV, Excel, PDF or print rows, gated exactly like the list (the service asserts the
   * administrator flag first). `replyExport` sets the export's headers on the passthrough reply.
   */
  @Get(PAYMENT_MODES_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Export every payment mode the list query matches as CSV, Excel, PDF or print rows (administrators only)',
    query: exportPaymentModesQuerySchema,
    produces: 'export',
    responses: {},
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
    headers: ['Content-Disposition', 'Cache-Control'],
  })
  async exportCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ExportFile['body']> {
    return replyExport(reply, await this.service.exportCsv(user, query));
  }

  /** `GET /api/v1/payment-modes/:id`: one payment mode with its usage and lock; a missing id is a 404. */
  @Get(PAYMENT_MODES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one payment mode (administrators only)',
    params: paymentModesParamsSchema,
    responses: { [HTTP_STATUS.OK]: paymentModesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<PaymentModesResponseDto> {
    return this.service.get(user, params);
  }

  /**
   * `POST /api/v1/payment-modes`: 201 and the payment mode; a name another mode holds is accepted,
   * as in Perfex. Unkeyed, like the other Setup lists (BE-15's interceptor is built by the first
   * module that needs one).
   */
  @Post(PAYMENT_MODES_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create a payment mode (administrators only)',
    body: createPaymentModesBodySchema,
    responses: { [HTTP_STATUS.CREATED]: paymentModesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<PaymentModesResponseDto> {
    return this.service.create(user, body);
  }

  /** `PATCH /api/v1/payment-modes/:id`: the payment mode after all seven fields are rewritten; a missing id is a 404. */
  @Patch(PAYMENT_MODES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Update a payment mode, all seven fields (administrators only)',
    params: paymentModesParamsSchema,
    body: updatePaymentModesBodySchema,
    responses: { [HTTP_STATUS.OK]: paymentModesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<PaymentModesResponseDto> {
    return this.service.update(user, params, body);
  }

  /**
   * `PATCH /api/v1/payment-modes/:id/active`: the list's one-click switch (D-34), `{ active }` in,
   * `{ id, active }` out; allowed for the credit-expense mode and a mode in use (D-37, D-33).
   */
  @Patch(PAYMENT_MODES_ROUTES.active)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Switch a payment mode on or off (administrators only)',
    params: paymentModesParamsSchema,
    body: paymentModesActiveBodySchema,
    responses: { [HTTP_STATUS.OK]: paymentModesActiveResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  setActive(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<PaymentModesActiveResponseDto> {
    return this.service.setActive(user, params, body);
  }

  /**
   * `DELETE /api/v1/payment-modes/:id`: 204 with no body; 404 for a missing id; 409
   * `ERP-PAYMENTMODES-0002` for the credit-expense mode (D-37) and `ERP-PAYMENTMODES-0001` while
   * any referencing column still holds the mode (D-33).
   */
  @Delete(PAYMENT_MODES_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Delete a payment mode (administrators only); refused while in use or for the credit expense mode',
    params: paymentModesParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-PAYMENTMODES-0001',
      'ERP-PAYMENTMODES-0002',
    ],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}
