/**
 * Every handler of the controller, classified against the three screens the frontend template
 * gates (`/example-item`, `/example-item/new`, `/example-item/:id` in erp-web's `ROUTE_GATES`),
 * with its guards and codes read from the decorators' own metadata. It mirrors
 * `v1/identity/__tests__/route-gates.spec.ts` without `@erp/contracts`: the codes here are the
 * module's own names, in no catalogue yet, so only an administrator holds them (ADR-0033
 * decision 4) — the same fail-closed default as the `ADMIN_GATE` erp-docs
 * `05-templates/frontend-feature` declares for the screens, and both flip together when the codes
 * are declared.
 *
 * `SCREEN_READS` names the read each screen issues when it opens (`/new` reads no record);
 * `OTHER_HANDLERS` files every other handler under the screen that issues it. Their union must
 * equal the controller's own method list, so a new endpoint fails here until it is named. The keys
 * of `SCREEN_READS` match the frontend template's `ROUTE_GATES`.
 *
 * Guards are read from each HANDLER's own metadata, so a module the deployment can switch off
 * (ADR-0042) adds `@ModuleKey('<m>')` and `@UseGuards(ModuleEnabledGuard)` on the controller CLASS
 * and every handler here still carries exactly `[JwtAuthGuard, PermissionGuard]` (Phase 4.2 M6).
 */
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../../shared/http/decorators/permissions.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { ExampleItemController } from '../controller/example-item.controller.js';
import { EXAMPLE_ITEM_PERMISSIONS } from '../example-item.routes.js';

type HandlerName = Exclude<keyof ExampleItemController, 'constructor'>;

const SCREEN_READS: Readonly<Record<string, HandlerName | null>> = {
  '/example-item': 'list',
  '/example-item/new': null,
  '/example-item/:id': 'get',
};

const OTHER_HANDLERS: Readonly<Record<string, string>> = {
  exportCsv: '/example-item',
  create: '/example-item/new',
  update: '/example-item/:id',
};

/** The reads and the export: either view code admits, and the one that did decides the row scope. */
const READS = ['list', 'get', 'exportCsv'] as const;

const HANDLERS = ExampleItemController.prototype as unknown as Record<string, object>;

const metadata = (key: string, handler: string): unknown =>
  Reflect.getMetadata(key, HANDLERS[handler] ?? {});

const handlerNames = (): string[] =>
  Object.getOwnPropertyNames(ExampleItemController.prototype).filter(
    (name) => name !== 'constructor',
  );

describe('every example-item handler is classified and gated', () => {
  it('classifies every handler of the controller — a new endpoint fails until it is named here', () => {
    const classified = [
      ...Object.values(SCREEN_READS).filter((name): name is HandlerName => name !== null),
      ...Object.keys(OTHER_HANDLERS),
    ].sort();
    expect(handlerNames().sort()).toEqual(classified);
    const unknown = Object.values(OTHER_HANDLERS).filter((route) => !(route in SCREEN_READS));
    expect(unknown, 'a handler is filed against a screen that is not gated').toEqual([]);
  });

  it.each(handlerNames())('%s carries exactly JwtAuthGuard, PermissionGuard', (handler) => {
    expect(metadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, PermissionGuard]);
  });

  it.each(READS)(
    '%s admits view or viewOwn (widest first) and declares no all-of code',
    (handler) => {
      expect(metadata(PERMISSIONS_ANY_KEY, handler)).toEqual([
        EXAMPLE_ITEM_PERMISSIONS.view,
        EXAMPLE_ITEM_PERMISSIONS.viewOwn,
      ]);
      expect(metadata(PERMISSIONS_KEY, handler)).toBeUndefined();
    },
  );

  it('create requires exactly the create code and update exactly the edit code', () => {
    expect(metadata(PERMISSIONS_KEY, 'create')).toEqual([EXAMPLE_ITEM_PERMISSIONS.create]);
    expect(metadata(PERMISSIONS_ANY_KEY, 'create')).toBeUndefined();
    expect(metadata(PERMISSIONS_KEY, 'update')).toEqual([EXAMPLE_ITEM_PERMISSIONS.edit]);
    expect(metadata(PERMISSIONS_ANY_KEY, 'update')).toBeUndefined();
  });

  it("every code is the module's own name: in no catalogue, so administrator-only until declared (fail closed)", () => {
    for (const code of Object.values(EXAMPLE_ITEM_PERMISSIONS)) {
      expect(code.startsWith('example-item.'), code).toBe(true);
    }
  });
});
