/**
 * The fake of `EMAIL_PROVIDER` (BE-16: every port has a fake beside its adapter). Records every
 * message and answers `next`. For specs under `src/integrations/**` and local wiring only; `v1/mail`
 * specs fake the port themselves (PATTERNS M4: they may not import an adapter). An attachment is
 * recorded as its name, type and size, never its bytes (ADR-0052).
 */
import type {
  EmailMessage,
  EmailProviderPort,
  SendResult,
} from '../../ports/email-provider.port.js';

/** What the fake keeps of one attachment. */
export interface RecordedAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
}

/** A sent message as recorded: its attachments, when it had any, without their bytes. */
export type RecordedEmail = Omit<EmailMessage, 'attachments'> & {
  readonly attachments?: readonly RecordedAttachment[];
};

export class FakeEmailAdapter implements EmailProviderPort {
  configured = true;
  readonly sent: RecordedEmail[] = [];
  next: SendResult = { ok: true };

  send(message: EmailMessage): Promise<SendResult> {
    const { attachments, ...rest } = message;
    this.sent.push(
      attachments === undefined
        ? rest
        : {
            ...rest,
            attachments: attachments.map((a) => ({
              filename: a.filename,
              contentType: a.contentType,
              size: a.content.length,
            })),
          },
    );
    return Promise.resolve(this.next);
  }
}
