/**
 * Facade: the ONLY surface other modules may import (ADR-0001; the architecture block in
 * `eslint.config.mjs` rejects a deeper path). It hands out the model, never the wire DTO, and
 * replacing it with an HTTP or queue adapter is what makes extraction to a service atomic.
 *
 * `permissionsOf` is the one synchronous cross-module call identity-access brief §7 justifies:
 * `v1/auth` must answer a login with the member's current permissions **in the same request**, so it
 * cannot wait for an event. It returns the rows in Perfex's own `feature`/`capability` format
 * because that is what the table holds and `auth`'s enricher is the translation point that turns
 * them into clean ADR-0033 names (ADR-0033 decision 2) — exactly the rows `auth` used to read
 * itself from `tblstaff_permissions` before ADR-0034 d.1 made this module their only owner.
 */
import { Injectable } from '@nestjs/common';
import type { PerfexPermissionRow, StaffContact, StaffName } from '../model/identity.model.js';
import { IdentityService, type IdentityDescription } from '../service/identity.service.js';

@Injectable()
export class IdentityFacade {
  constructor(private readonly service: IdentityService) {}

  describe(): IdentityDescription {
    return this.service.describe();
  }

  /** The stored permission rows of one member, in Perfex's format; `[]` for a member with none. */
  permissionsOf(staffId: number): Promise<readonly PerfexPermissionRow[]> {
    return this.service.permissionsOf(staffId);
  }

  /**
   * Every active member as another module names them (M13): the id and "first last", ordered by
   * first name, last name, then id. The only way another module lists staff: no e-mail, no role,
   * no flag crosses (T-4.2-74). The staff directory identity registers with `v1/departments` reads it.
   */
  listActiveMembers(): Promise<readonly StaffName[]> {
    return this.service.listActiveMembers();
  }

  /**
   * `staffId -> "first last"` for each id identity knows, active or not (a deactivated member still
   * names a past assignment); an unknown id is absent. `[]` answers an empty map without a read.
   */
  namesOf(staffIds: readonly number[]): Promise<ReadonlyMap<number, string>> {
    return this.service.namesOf(staffIds);
  }

  /**
   * The address and language of one member for another module's email (PATTERNS M1: only identity
   * names tblstaff): `{ email, locale, active }`, the locale through `toLocale` (null when the
   * member's language is empty or unknown), or null when no member has the id. `v1/mail` reads it
   * for the status page's test recipient and a staff recipient's locale.
   */
  contactOf(staffId: number): Promise<StaffContact | null> {
    return this.service.contactOf(staffId);
  }
}
