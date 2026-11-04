/**
 * The permission codes of the Fixed Equipment settings tabs. `perfex-mapping.ts` stays one to one;
 * the widening to several permission groups lives only here. erp-web mirrors this file by hand in
 * `src/config/fixed-equipment-settings.ts`.
 */
import { PERMISSIONS, type PermissionCode } from './permissions.catalogue.js';

const { accessories, assets, consumables, licenses } = PERMISSIONS.fixedEquipment;
const {
  settingCategory,
  settingCustomField,
  settingDepreciation,
  settingManufacturer,
  settingModel,
  settingStatusLabel,
  settingSupplier,
} = PERMISSIONS.fixedEquipment;

/** The codes one permission group holds for a settings tab. */
interface GroupCodes {
  readonly view: PermissionCode;
  readonly viewOwn: PermissionCode;
  readonly create: PermissionCode;
  readonly edit: PermissionCode;
  readonly delete: PermissionCode;
}

/** Who may do what on one settings tab: any code of a list is enough. */
export interface FixedEquipmentSettingsCodes {
  /** `all` reads every row and `own` the member's own, for `@PermissionsRead`. */
  readonly read: {
    readonly all: readonly PermissionCode[];
    readonly own: readonly PermissionCode[];
  };
  readonly create: readonly PermissionCode[];
  readonly edit: readonly PermissionCode[];
  readonly delete: readonly PermissionCode[];
}

/** The tab's own settings group first, then the four item groups Perfex's screen also serves. */
function codesOf(settings: GroupCodes): FixedEquipmentSettingsCodes {
  const groups = [settings, assets, licenses, accessories, consumables];
  return Object.freeze({
    read: Object.freeze({
      all: Object.freeze(groups.map((group) => group.view)),
      own: Object.freeze(groups.map((group) => group.viewOwn)),
    }),
    create: Object.freeze(groups.map((group) => group.create)),
    edit: Object.freeze(groups.map((group) => group.edit)),
    delete: Object.freeze(groups.map((group) => group.delete)),
  });
}

/**
 * The codes of each Fixed Equipment settings tab. Perfex shows each tab to its own settings group
 * and to the assets, licenses, accessories and consumables groups
 * (`modules/fixed_equipment/views/manage_setting.php`). Locations is not here: Perfex gates it on
 * its own group only.
 */
export const FIXED_EQUIPMENT_SETTINGS_CODES = Object.freeze({
  category: codesOf(settingCategory),
  customField: codesOf(settingCustomField),
  depreciation: codesOf(settingDepreciation),
  manufacturer: codesOf(settingManufacturer),
  model: codesOf(settingModel),
  statusLabel: codesOf(settingStatusLabel),
  supplier: codesOf(settingSupplier),
});
