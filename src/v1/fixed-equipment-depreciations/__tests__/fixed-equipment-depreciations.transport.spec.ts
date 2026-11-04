import { describe, expect, it, vi } from 'vitest';
import { FixedEquipmentDepreciationsCreatedV1 } from '../events/published.js';
import { FixedEquipmentDepreciationsTransport } from '../service/fixed-equipment-depreciations.transport.js';

describe('FixedEquipmentDepreciationsTransport', () => {
  const event = new FixedEquipmentDepreciationsCreatedV1({
    id: 3,
    at: '2026-10-31T10:00:00.000Z',
  });

  it('hands the event to the publisher port, unchanged', async () => {
    const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const transport = new FixedEquipmentDepreciationsTransport(publisher);
    await transport.publish(event);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalledWith(event);
  });

  it('does not hide a publisher failure', async () => {
    const publisher = { publish: vi.fn().mockRejectedValue(new Error('bus down')) };
    const transport = new FixedEquipmentDepreciationsTransport(publisher);
    await expect(transport.publish(event)).rejects.toThrow('bus down');
  });
});
