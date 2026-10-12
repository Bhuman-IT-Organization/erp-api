/**
 * The mail queues and the `mail.send` job (BE-14, ADR-0049 decision 5): the data is the log row's id
 * (T-4.2-18, T-4.3-05), and the job id `mail-<id>` makes a second add of a live job a no-op, so the
 * enqueue, the sweep and a Resend can all add without sending twice. The worker resolves the
 * recipient and the values at send time (D-09); nothing else about the email is stored in Redis.
 */
import { z } from 'zod';
import type { QueueService } from '../../../shared/queue/queue.service.js';
import { MAIL_MESSAGE_MAX, MAIL_SUBJECT_MAX } from '../service/mail.validator.js';

export const MAIL_SEND_QUEUE = 'mail.send';
export const MAIL_SWEEP_QUEUE = 'mail.sweep';
export const MAIL_PURGE_QUEUE = 'mail.purge';

export const mailSendJobSchema = z.strictObject({
  sentEmailId: z.number().int().positive(),
  /** A test send's draft: sample-only wording, the one exception to "ids only" (T-4.2-18). */
  draft: z
    .strictObject({
      subject: z.string().max(MAIL_SUBJECT_MAX),
      message: z.string().max(MAIL_MESSAGE_MAX),
    })
    .optional(),
});

export type MailSendJob = z.infer<typeof mailSendJobSchema>;

/** `mail-<id>`: never `:` and never all digits (BullMQ custom ids). */
export const mailJobId = (sentEmailId: number): string => `mail-${String(sentEmailId)}`;

/** Adds the `mail.send` job of one log row; a live job with the same id is kept. Resolves to the job id. */
export function enqueueMailSend(
  queues: Pick<QueueService, 'add'>,
  job: MailSendJob,
): Promise<string> {
  return queues.add(MAIL_SEND_QUEUE, 'send', job, { jobId: mailJobId(job.sentEmailId) });
}
