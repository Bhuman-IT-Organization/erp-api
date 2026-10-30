import { Injectable } from '@nestjs/common';
import {
  predefinedReplyResponseSchema,
  type PredefinedReplyResponseDto,
} from '../dto/predefined-replies.dto.js';
import type { PredefinedReply } from '../model/predefined-replies.model.js';
import { fromStoredHtml } from './reply-html.js';

/** Converts stored reply rows into the validated HTTP response shape. */
@Injectable()
export class PredefinedRepliesTransformer {
  toResponse(reply: PredefinedReply): PredefinedReplyResponseDto {
    const converted = fromStoredHtml(reply.message);

    return predefinedReplyResponseSchema.parse({
      id: String(reply.id),
      name: reply.name,
      message: converted.text,
      hasOtherFormatting: converted.hasOtherFormatting,
    });
  }
}
