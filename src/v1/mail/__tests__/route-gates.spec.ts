/**
 * The drift gate between `@erp/contracts`' `ROUTE_GATES` and this module's handlers (B14, api side),
 * in the identity form for the two code-gated screens (metadata `PERMISSIONS_KEY`) and the
 * expense-categories form for the three administrator-only ones (the assertion read from the
 * service source). It VERIFIES the handlers against the map; it never makes the map the gate.
 *
 * D-09: `/setup/email-templates*` is gated on `settings.emailTemplates.view`; every write, the test
 * send and reading one's own test carry `.edit`. `/setup/sent-emails*` and `/setup/email-status` are
 * administrator-only: their handlers declare no code and the service method of the same name asserts
 * the flag (T-4.3-30). `PermissionGuard` admits a handler with no code, so that assertion is the
 * only control there; the e2e spec is the behavioural proof.
 *
 * `SCREEN_READS` names the read each screen issues when it opens; `OTHER_HANDLERS` files every other
 * handler under the screen that issues it. Their union must equal the controller's own method list,
 * so a new endpoint fails here until it is named.
 */
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { ADMIN_GATE, GATED_ROUTES, PERMISSIONS, ROUTE_GATES } from '@erp/contracts';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../../shared/http/decorators/permissions.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { MailController } from '../controller/mail.controller.js';
import { MailService } from '../service/mail.service.js';

const SCREEN_READS: Readonly<Record<string, string>> = {
  '/setup/email-templates': 'listTemplates',
  '/setup/email-templates/:id': 'getTemplate',
  '/setup/sent-emails': 'listSentEmails',
  '/setup/sent-emails/:id': 'getSentEmail',
  '/setup/email-status': 'getStatus',
};

const OTHER_HANDLERS: Readonly<Record<string, string>> = {
  setModuleActive: '/setup/email-templates',
  setTemplateActive: '/setup/email-templates',
  saveTemplate: '/setup/email-templates/:id',
  previewTemplate: '/setup/email-templates/:id',
  sendTemplateTest: '/setup/email-templates/:id',
  getTest: '/setup/email-templates/:id',
  resend: '/setup/sent-emails',
  sendStatusTest: '/setup/email-status',
};

/** The template handlers that change something or send: they need `.edit` (D-09, D-10). */
const EDIT_HANDLERS = [
  'setModuleActive',
  'setTemplateActive',
  'saveTemplate',
  'sendTemplateTest',
  'getTest',
];

/**
 * The prototype as a plain record of objects: reading a method off the class type would fire
 * `@typescript-eslint/unbound-method`, and the metadata reader wants the function as an opaque target.
 */
const HANDLERS = MailController.prototype as unknown as Record<string, object>;

const metadata = (key: string, handler: string): unknown =>
  Reflect.getMetadata(key, HANDLERS[handler] ?? {});

const handlerNames = (): string[] =>
  Object.getOwnPropertyNames(MailController.prototype).filter((name) => name !== 'constructor');

/** The administrator assertion, read from the service method's own source (same name as the handler). */
function assertsAdministrator(handler: string): boolean {
  const method = (MailService.prototype as unknown as Record<string, unknown>)[handler];
  return typeof method === 'function' && String(method).includes('assertAdministrator(');
}

describe('ROUTE_GATES declares the five Email screens (D-09, D-05, D-02)', () => {
  it.each(Object.keys(SCREEN_READS))('%s is declared', (route) => {
    expect(GATED_ROUTES).toContain(route);
  });

  it('the template screens are gated on the view code, the log and the status on the flag', () => {
    expect(ROUTE_GATES['/setup/email-templates']).toBe(PERMISSIONS.settings.emailTemplates.view);
    expect(ROUTE_GATES['/setup/email-templates/:id']).toBe(
      PERMISSIONS.settings.emailTemplates.view,
    );
    for (const route of ['/setup/sent-emails', '/setup/sent-emails/:id', '/setup/email-status']) {
      expect(ROUTE_GATES[route], route).toBe(ADMIN_GATE);
    }
  });
});

describe('every mail handler matches the gate ROUTE_GATES declares for its screen', () => {
  it('classifies every handler of the controller: a new endpoint fails until it is named here', () => {
    const classified = [...Object.values(SCREEN_READS), ...Object.keys(OTHER_HANDLERS)].sort();
    expect(handlerNames().sort()).toEqual(classified);
    const unknown = Object.values(OTHER_HANDLERS).filter((route) => !(route in SCREEN_READS));
    expect(unknown, 'a handler is filed against a screen that is not declared').toEqual([]);
  });

  it.each(handlerNames())('%s carries exactly JwtAuthGuard, PermissionGuard', (handler) => {
    expect(metadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, PermissionGuard]);
  });

  it.each(Object.entries(SCREEN_READS))(
    "%s -> %s carries exactly the map's gate",
    (route, handler) => {
      const gate = ROUTE_GATES[route];
      expect(metadata(PERMISSIONS_ANY_KEY, handler)).toBeUndefined();
      if (gate === ADMIN_GATE) {
        expect(metadata(PERMISSIONS_KEY, handler), `${handler}: no @Permissions`).toBeUndefined();
        expect(assertsAdministrator(handler), `MailService.${handler} asserts the flag`).toBe(true);
        return;
      }
      expect(metadata(PERMISSIONS_KEY, handler)).toEqual([gate]);
    },
  );

  it.each(Object.entries(OTHER_HANDLERS).filter(([, route]) => ROUTE_GATES[route] === ADMIN_GATE))(
    '%s serves an administrator-only screen: no code, and the service asserts the flag',
    (handler) => {
      expect(metadata(PERMISSIONS_KEY, handler)).toBeUndefined();
      expect(metadata(PERMISSIONS_ANY_KEY, handler)).toBeUndefined();
      expect(assertsAdministrator(handler)).toBe(true);
    },
  );

  it.each(EDIT_HANDLERS)('%s carries exactly settings.emailTemplates.edit', (handler) => {
    expect(metadata(PERMISSIONS_KEY, handler)).toEqual([PERMISSIONS.settings.emailTemplates.edit]);
    expect(metadata(PERMISSIONS_ANY_KEY, handler)).toBeUndefined();
  });

  it('the preview is a read: it carries the view code, so a read-only editor still previews', () => {
    expect(metadata(PERMISSIONS_KEY, 'previewTemplate')).toEqual([
      PERMISSIONS.settings.emailTemplates.view,
    ]);
  });
});
