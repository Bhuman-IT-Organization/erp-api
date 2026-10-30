import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { PredefinedRepliesListResponseDto } from '../dto/predefined-replies.dto.js';
import type { PredefinedReply } from '../model/predefined-replies.model.js';
import { PredefinedRepliesService } from '../service/predefined-replies.service.js';

/** Exposes administrator HTTP operations and actor-free stored-record reads to other modules. */
@Injectable()
export class PredefinedRepliesFacade {
  constructor(private readonly service: PredefinedRepliesService) {}

  list(actor: AuthenticatedUser, query: unknown): Promise<PredefinedRepliesListResponseDto> {
    return this.service.list(actor, query);
  }

  listAll(): Promise<readonly PredefinedReply[]> {
    return this.service.listAll();
  }

  findById(id: number): Promise<PredefinedReply | null> {
    return this.service.findById(id);
  }

  findByIds(ids: readonly number[]): Promise<readonly PredefinedReply[]> {
    return this.service.findByIds(ids);
  }
}
