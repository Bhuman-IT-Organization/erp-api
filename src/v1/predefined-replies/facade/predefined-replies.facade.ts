import { Injectable } from '@nestjs/common';
import type { PredefinedReply } from '../model/predefined-replies.model.js';
import { PredefinedRepliesService } from '../service/predefined-replies.service.js';

/** Exposes actor-free stored-record reads to other modules. */
@Injectable()
export class PredefinedRepliesFacade {
  constructor(private readonly service: PredefinedRepliesService) {}

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
