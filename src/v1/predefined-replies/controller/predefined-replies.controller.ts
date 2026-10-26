import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CurrentUser } from '../../../shared/http/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import {
  listPredefinedRepliesQuerySchema,
  predefinedRepliesListResponseSchema,
  predefinedReplyResponseSchema,
  predefinedReplyDeleteResponseSchema,
} from '../dto/predefined-replies.dto.js';
import { PredefinedRepliesValidator } from '../service/predefined-replies.validator.js';
import { PredefinedRepliesService } from '../service/predefined-replies.service.js';

@ApiTags('Predefined Replies')
@Controller('predefined-replies')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PredefinedRepliesController {
  constructor(
    private readonly service: PredefinedRepliesService,
    private readonly validator: PredefinedRepliesValidator,
  ) {}

  @Get()
  @ApiZod({
    summary: 'List predefined replies',
    query: listPredefinedRepliesQuerySchema,
    responses: {
      200: predefinedRepliesListResponseSchema,
    },
  })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.service.list(user, query);
  }

  @Get(':id')
  @ApiZod({
    summary: 'Get a predefined reply',
    responses: {
      200: predefinedReplyResponseSchema,
    },
  })
  get(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown) {
    const { id } = this.validator.parseParams(params);
    return this.service.get(user, id);
  }

  @Post()
  @ApiZod({
    summary: 'Create a predefined reply',
    responses: {
      201: predefinedReplyResponseSchema,
    },
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.create(user, this.validator.parseCreateBody(body));
  }

  @Patch(':id')
  @ApiZod({
    summary: 'Update a predefined reply',
    responses: {
      200: predefinedReplyResponseSchema,
    },
  })
  update(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown, @Body() body: unknown) {
    const { id } = this.validator.parseParams(params);
    return this.service.update(user, id, this.validator.parseUpdateBody(body));
  }

  @Delete(':id')
  @ApiZod({
    summary: 'Delete a predefined reply',
    responses: {
      200: predefinedReplyDeleteResponseSchema,
    },
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown) {
    const { id } = this.validator.parseParams(params);
    return this.service.remove(user, id);
  }
}
