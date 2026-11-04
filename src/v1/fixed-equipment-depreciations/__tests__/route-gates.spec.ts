/**
 * Every handler of the controller, classified against the three screens erp-web gates
 * (`/setup/fixed-equipment-depreciations`, `/new` and `/:id` in `ROUTE_GATES`), with its guards and
 * codes read from the decorators' own metadata. The codes are `FIXED_EQUIPMENT_SETTINGS_CODES
 * .depreciation`: the depreciation settings group (mapped from Perfex's
 * `fixed_equipment_setting_depreciation`) and the four item groups Perfex's screen also serves.
 *
 * `SCREEN_READS` names the read each screen issues when it opens (`/new` reads no record);
 * `OTHER_HANDLERS` files every other handler under the screen that issues it. Their union must
 * equal the controller's own method list, so a new endpoint fails here until it is named.
 */
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { FIXED_EQUIPMENT_SETTINGS_CODES, PERMISSIONS, ROUTE_GATES } from '@erp/contracts';
import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
  PERMISSIONS_READ_KEY,
} from '../../../shared/http/decorators/permissions.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { FixedEquipmentDepreciationsController } from '../controller/fixed-equipment-depreciations.controller.js';

type HandlerName = Exclude<keyof FixedEquipmentDepreciationsController, 'constructor'>;

const LIST = '/setup/fixed-equipment-depreciations';

const SCREEN_READS: Readonly<Record<string, HandlerName | null>> = {
  [LIST]: 'list',
  [`${LIST}/new`]: null,
  [`${LIST}/:id`]: 'get',
};

const OTHER_HANDLERS: Readonly<Record<string, string>> = {
  exportCsv: LIST,
  remove: LIST,
  create: `${LIST}/new`,
  update: `${LIST}/:id`,
};

/** The reads and the export: any group's full view reads every row, any group's view own the own. */
const READS = ['list', 'get', 'exportCsv'] as const;

const codes = FIXED_EQUIPMENT_SETTINGS_CODES.depreciation;
const FE = PERMISSIONS.fixedEquipment;

const HANDLERS = FixedEquipmentDepreciationsController.prototype as unknown as Record<
  string,
  object
>;

const metadata = (key: string, handler: string): unknown =>
  Reflect.getMetadata(key, HANDLERS[handler] ?? {});

const handlerNames = (): string[] =>
  Object.getOwnPropertyNames(FixedEquipmentDepreciationsController.prototype).filter(
    (name) => name !== 'constructor',
  );

describe('every fixed-equipment-depreciations handler is classified and gated', () => {
  it('classifies every handler of the controller: a new endpoint fails until it is named here', () => {
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
    '%s is @PermissionsRead(codes.read) and declares no all-of or any-of code',
    (handler) => {
      expect(metadata(PERMISSIONS_READ_KEY, handler)).toEqual(codes.read);
      expect(metadata(PERMISSIONS_ANY_KEY, handler)).toBeUndefined();
      expect(metadata(PERMISSIONS_KEY, handler)).toBeUndefined();
    },
  );

  it('create, update and remove admit any of the five groups’ create, edit and delete codes', () => {
    expect(metadata(PERMISSIONS_ANY_KEY, 'create')).toEqual([...codes.create]);
    expect(metadata(PERMISSIONS_ANY_KEY, 'update')).toEqual([...codes.edit]);
    expect(metadata(PERMISSIONS_ANY_KEY, 'remove')).toEqual([...codes.delete]);
    for (const handler of ['create', 'update', 'remove']) {
      expect(metadata(PERMISSIONS_KEY, handler), handler).toBeUndefined();
      expect(metadata(PERMISSIONS_READ_KEY, handler), handler).toBeUndefined();
    }
  });

  it('the codes are the depreciation settings group first, then the four item groups', () => {
    expect(codes.read.all).toEqual([
      FE.settingDepreciation.view,
      FE.assets.view,
      FE.licenses.view,
      FE.accessories.view,
      FE.consumables.view,
    ]);
    expect(codes.read.own).toEqual([
      FE.settingDepreciation.viewOwn,
      FE.assets.viewOwn,
      FE.licenses.viewOwn,
      FE.accessories.viewOwn,
      FE.consumables.viewOwn,
    ]);
    expect(codes.edit).toContain(FE.assets.edit);
    expect(codes.read.all).not.toContain(FE.settingCategory.view);
  });
});

describe('ROUTE_GATES gates the three screens on the read codes the handlers declare', () => {
  it.each(Object.keys(SCREEN_READS))('%s is gated on [...read.all, ...read.own]', (screen) => {
    expect(ROUTE_GATES[screen]).toEqual([...codes.read.all, ...codes.read.own]);
  });
});
