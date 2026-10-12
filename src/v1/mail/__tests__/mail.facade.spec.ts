import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MailFacade } from '../facade/mail.facade.js';
import { MailTemplateRegistry } from '../service/mail-template.registry.js';
import { createMailTestApp, type MailTestApp } from './create-mail-test-app.js';
import { TEST_DEFINITION, templateOf } from './fakes.js';

describe('MailFacade', () => {
  let ctx: MailTestApp;

  beforeAll(async () => {
    ctx = await createMailTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('resolves from the module', () => {
    expect(ctx.moduleRef.get(MailFacade)).toBeInstanceOf(MailFacade);
  });

  it('register reaches the module registry', () => {
    ctx.moduleRef.get(MailFacade).register(TEST_DEFINITION);
    expect(ctx.moduleRef.get(MailTemplateRegistry).get('zz_test_notice')).toBe(TEST_DEFINITION);
  });

  it('ensureSeeded reaches the service: one Perfex read and one create', async () => {
    await ctx.moduleRef.get(MailFacade).ensureSeeded('zz_test_notice');
    expect(ctx.repo.methods()).toEqual([
      'findTemplateByKey',
      'readPerfexTemplates',
      'createTemplate',
    ]);
  });
});

describe('MailFacade.send never throws (D-01, T-4.3-27)', () => {
  let ctx: MailTestApp;
  const facade = () => ctx.moduleRef.get(MailFacade);

  beforeAll(async () => {
    ctx = await createMailTestApp();
    facade().register(TEST_DEFINITION);
    facade().register({
      ...TEST_DEFINITION,
      key: 'zz_failing_lookup',
      resolve: () => Promise.reject(new Error('lookup failed')),
    });
    for (const key of ['zz_test_notice', 'zz_failing_lookup']) {
      ctx.repo.templates.push(
        templateOf(ctx.repo.templates.length + 1, {
          key,
          module: 'zz_tests',
          active: true,
          formattingDropped: false,
          versions: [{ locale: 'en', subject: 'S', message: 'M' }],
        }),
      );
    }
  });

  afterEach(() => {
    ctx.repo.insertSentFails = null;
    ctx.queue.failWith = null;
    ctx.logger.lines.length = 0;
  });

  afterAll(async () => {
    await ctx.close();
  });

  /** The one `mail send not enqueued` line: the key and the error, nothing else, no address. */
  function expectNotEnqueuedLine(template: string): void {
    const lines = ctx.logger.lines.filter((line) => line.message === 'mail send not enqueued');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.level).toBe('error');
    expect(Object.keys(lines[0]?.meta ?? {})).toEqual(['template', 'error']);
    expect(lines[0]?.meta?.template).toBe(template);
    expect(JSON.stringify(ctx.logger.lines)).not.toContain('@example.test');
  }

  it('answers queued for a registered active template', async () => {
    const outcome = await facade().send({ template: 'zz_test_notice', sourceRef: '1' });
    expect(outcome.status).toBe('queued');
  });

  it('the repository rejecting answers not_enqueued and logs ids only', async () => {
    ctx.repo.insertSentFails = new Error('database unavailable');
    await expect(facade().send({ template: 'zz_test_notice', sourceRef: '1' })).resolves.toEqual({
      status: 'not_enqueued',
    });
    expectNotEnqueuedLine('zz_test_notice');
  });

  it('the resolver rejecting answers not_enqueued and logs ids only', async () => {
    await expect(facade().send({ template: 'zz_failing_lookup', sourceRef: '1' })).resolves.toEqual(
      { status: 'not_enqueued' },
    );
    expectNotEnqueuedLine('zz_failing_lookup');
  });

  it("the queue's add rejecting answers not_enqueued after the row was written (the sweep re-adds it)", async () => {
    ctx.queue.failWith = new Error('redis unavailable');
    const before = ctx.repo.sent.length;
    await expect(facade().send({ template: 'zz_test_notice', sourceRef: '1' })).resolves.toEqual({
      status: 'not_enqueued',
    });
    expect(ctx.repo.sent).toHaveLength(before + 1);
    expect(ctx.repo.sent.at(-1)?.status).toBe('queued');
    expectNotEnqueuedLine('zz_test_notice');
  });
});
