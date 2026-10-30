import { describe, expect, it, vi } from 'vitest';
import { CustomerGroupsCreatedV1 } from '../events/published.js';
import { CustomerGroupsTransport } from '../service/customer-groups.transport.js';

function build() {
  const publish = vi.fn<(event: unknown) => Promise<void>>(() => Promise.resolve());
  const transport = new CustomerGroupsTransport({ publish });
  return { transport, publish };
}

describe('CustomerGroupsTransport', () => {
  it('forwards the event to the publisher port, once, unchanged', async () => {
    const { transport, publish } = build();
    const event = new CustomerGroupsCreatedV1({ id: 7, at: '2026-10-28T00:00:00.000Z' });
    await transport.publish(event);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(event);
  });

  it('lets a publisher failure through unchanged', async () => {
    const { transport, publish } = build();
    publish.mockRejectedValueOnce(new Error('bus down'));
    const event = new CustomerGroupsCreatedV1({ id: 7, at: '2026-10-28T00:00:00.000Z' });
    await expect(transport.publish(event)).rejects.toThrow('bus down');
  });
});
