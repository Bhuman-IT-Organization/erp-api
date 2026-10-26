import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { ADMIN_GATE, GATED_ROUTES, ROUTE_GATES } from '@erp/contracts';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../../shared/http/decorators/permissions.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { TicketStatusesController } from '../controller/ticket-statuses.controller.js';
import { TicketStatusesService } from '../service/ticket-statuses.service.js';

type Handler = Exclude<keyof TicketStatusesController, 'constructor'>;
const HANDLERS = TicketStatusesController.prototype as unknown as Record<string, object>;
const SCREEN_GATES: Readonly<Record<string, Handler | null>> = {
  '/setup/ticket-statuses': 'list',
  '/setup/ticket-statuses/new': null,
  '/setup/ticket-statuses/:id': 'get',
};
const EXTRA_HANDLERS: Readonly<Record<string, string>> = {
  exportCsv: '/setup/ticket-statuses',
  create: '/setup/ticket-statuses/new',
  update: '/setup/ticket-statuses/:id',
  remove: '/setup/ticket-statuses/:id',
};
const methods = (): string[] =>
  Object.getOwnPropertyNames(TicketStatusesController.prototype).filter(
    (name) => name !== 'constructor',
  );
const metadata = (key: string, name: string): unknown =>
  Reflect.getMetadata(key, HANDLERS[name] ?? {});
const assertsAdmin = (name: string): boolean => {
  const method = (TicketStatusesService.prototype as unknown as Record<string, unknown>)[name];
  return typeof method === 'function' && String(method).includes('assertAdministrator(');
};

describe('Ticket Statuses administrator route contract', () => {
  it.each(Object.keys(SCREEN_GATES))('%s is declared as ADMIN_GATE', (route) => {
    expect(GATED_ROUTES).toContain(route);
    expect(ROUTE_GATES[route]).toBe(ADMIN_GATE);
  });

  it('classifies every handler and makes every route admin-only', () => {
    expect(methods().sort()).toEqual(
      [
        ...Object.values(SCREEN_GATES).filter((name): name is Handler => name !== null),
        ...Object.keys(EXTRA_HANDLERS),
      ].sort(),
    );
    for (const handler of methods()) {
      expect(metadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, PermissionGuard]);
      expect(metadata(PERMISSIONS_KEY, handler)).toBeUndefined();
      expect(metadata(PERMISSIONS_ANY_KEY, handler)).toBeUndefined();
      expect(assertsAdmin(handler)).toBe(true);
    }
  });
});
