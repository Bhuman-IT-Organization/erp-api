/**
 * The `MailStateStore` contract over `InMemoryMailStateStore` with a fake clock; the same contract
 * runs over `RedisMailStateStore` in `mail-state.store.int.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import { TIMINGS } from '../../../shared/config/timings.js';
import { InMemoryMailStateStore, mailStateStoreContract, type MailStateHarness } from './fakes.js';

function harness(): MailStateHarness {
  let clock = Date.parse('2026-10-02T08:00:00.000Z');
  const store = new InMemoryMailStateStore(() => clock);
  return {
    store,
    testWindowMs: TIMINGS.mail.testWindowMs,
    elapse: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    has: (key) => Promise.resolve(store.keys().includes(key)),
  };
}

describe('InMemoryMailStateStore', () => {
  mailStateStoreContract(harness);

  it('forgets the server flag after TIMINGS.mail.serverStateTtlMs', async () => {
    const { store, elapse } = harness();
    await store.markServerUnreachable(new Date('2026-10-02T08:00:00.000Z'));
    await elapse(TIMINGS.mail.serverStateTtlMs);
    expect(await store.serverUnreachableSince()).toBeNull();
  });
});
