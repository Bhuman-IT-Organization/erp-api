import { describe, expect, it } from 'vitest';
import type { EmailMessage } from '../../../ports/email-provider.port.js';
import { FakeEmailAdapter } from '../fake-email.adapter.js';

const MESSAGE: EmailMessage = {
  to: 'user@example.test',
  subject: 'Hello',
  html: '<p>Hello</p>',
  text: 'Hello',
  messageId: '<mail-1@erp.local.test>',
  locale: 'en',
};

describe('FakeEmailAdapter (BE-16: the fake beside the adapter)', () => {
  it('is configured, records every message and answers ok by default', async () => {
    const fake = new FakeEmailAdapter();
    expect(fake.configured).toBe(true);
    await expect(fake.send(MESSAGE)).resolves.toEqual({ ok: true });
    expect(fake.sent).toEqual([MESSAGE]);
  });

  it('records the name, type and size of each attachment, never its bytes (ADR-0052)', async () => {
    const fake = new FakeEmailAdapter();
    await fake.send({
      ...MESSAGE,
      attachments: [
        { filename: 'a.txt', contentType: 'text/plain', content: Buffer.from('abc') },
        { filename: 'b.pdf', contentType: 'application/pdf', content: Buffer.alloc(10) },
      ],
    });
    expect(fake.sent).toEqual([
      {
        ...MESSAGE,
        attachments: [
          { filename: 'a.txt', contentType: 'text/plain', size: 3 },
          { filename: 'b.pdf', contentType: 'application/pdf', size: 10 },
        ],
      },
    ]);
  });

  it('answers whatever `next` holds', async () => {
    const fake = new FakeEmailAdapter();
    fake.next = { ok: false, reason: 'recipient_refused', transient: false, serverReply: '550' };
    await expect(fake.send(MESSAGE)).resolves.toEqual(fake.next);
    expect(fake.sent).toHaveLength(1);
  });
});
