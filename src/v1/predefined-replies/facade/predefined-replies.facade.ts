import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type {
  PredefinedReplyResponseDto,
  PredefinedRepliesListResponseDto,
} from '../dto/predefined-replies.dto.js';
import { PredefinedRepliesService } from '../service/predefined-replies.service.js';

/** Coordinates predefined-reply requests between the controller and service. */
@Injectable()
export class PredefinedRepliesFacade {
  constructor(private readonly service: PredefinedRepliesService) {}

  list(actor: AuthenticatedUser, query: unknown): Promise<PredefinedRepliesListResponseDto> {
    return this.service.list(actor, query);
  }

  async findById(actor: AuthenticatedUser, id: number): Promise<PredefinedReplyResponseDto> {
    return this.service.get(actor, id);
  }
}
