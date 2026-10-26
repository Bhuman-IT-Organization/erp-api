import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type {
  PredefinedReplyResponseDto,
  PredefinedRepliesListResponseDto,
} from '../dto/predefined-replies.dto.js';
import { PredefinedRepliesRepository } from '../repository/predefined-replies.repository.js';
import { PredefinedRepliesValidator } from './predefined-replies.validator.js';

const ADMIN_ONLY = 'Predefined replies are available to administrators only';

@Injectable()
export class PredefinedRepliesService {
  constructor(
    private readonly repository: PredefinedRepliesRepository,
    private readonly validator: PredefinedRepliesValidator,
  ) {}

  async list(actor: AuthenticatedUser, query: unknown): Promise<PredefinedRepliesListResponseDto> {
    this.assertAdministrator(actor);

    const request = this.validator.parseListQuery(query);
    const page = await this.repository.list(request);

    return {
      data: page.items.map((reply) => this.toResponse(reply)),
      meta: {
        nextCursor: page.nextCursor,
        prevCursor: page.prevCursor,
        total: page.total,
        rangeStart: page.rangeStart,
      },
    };
  }

  async get(actor: AuthenticatedUser, id: number): Promise<PredefinedReplyResponseDto> {
    this.assertAdministrator(actor);
    const reply = await this.repository.findById(id);

    if (reply === null) {
      throw new AppError('ERP-CORE-0004', 'Predefined reply not found');
    }

    return this.toResponse(reply);
  }

  async create(
    actor: AuthenticatedUser,
    input: { name: string; message: string },
  ): Promise<PredefinedReplyResponseDto> {
    this.assertAdministrator(actor);
    const reply = await this.repository.create(input);
    return this.toResponse(reply);
  }

  async update(
    actor: AuthenticatedUser,
    id: number,
    input: { name: string; message: string },
  ): Promise<PredefinedReplyResponseDto> {
    this.assertAdministrator(actor);
    const reply = await this.repository.update(id, input);

    if (reply === null) {
      throw new AppError('ERP-CORE-0004', 'Predefined reply not found');
    }

    return this.toResponse(reply);
  }

  async remove(actor: AuthenticatedUser, id: number) {
    this.assertAdministrator(actor);
    const removed = await this.repository.remove(id);

    if (!removed) {
      throw new AppError('ERP-CORE-0004', 'Predefined reply not found');
    }

    return { success: true };
  }

  private toResponse(reply: {
    id: number;
    name: string;
    message: string;
  }): PredefinedReplyResponseDto {
    return {
      id: String(reply.id),
      name: reply.name,
      message: reply.message,
    };
  }

  private assertAdministrator(actor: AuthenticatedUser): void {
    if (!actor.isAdmin) {
      throw new AppError('ERP-AUTH-0005', ADMIN_ONLY);
    }
  }
}
