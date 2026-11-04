import { describe, expect, it } from 'vitest';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { EstimateRequestStatusCreatedV1 } from '../events/published.js';
import { EstimateRequestStatusesTransport } from '../service/estimate-request-statuses.transport.js';

describe('EstimateRequestStatusesTransport', () => {
  it('publishes the module event through the shared domain-event port', async () => {
    const publisher = new RecordingDomainEventPublisher();
    const transport = new EstimateRequestStatusesTransport(publisher);
    await transport.publish(
      new EstimateRequestStatusCreatedV1({ id: 3, at: '2026-10-24T10:30:00.000Z' }),
    );
    expect(publisher.drain()).toHaveLength(1);
  });
});
