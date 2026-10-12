/**
 * Facade: the ONLY surface other modules may import (ADR-0001). It gives a module that shows a
 * record with custom fields (any entity Perfex's Setup lists) the definitions of its entity and the
 * values of its records, read back through the codec. Reads only: `tblcustomfields` and
 * `tblcustomfieldsvalues` are Perfex's, and Perfex's `handle_custom_fields_post` stays the only
 * writer of the values. The calling module's own permission decides who may read a record's values;
 * these methods assert nothing about the caller.
 */
import { Injectable } from '@nestjs/common';
import type {
  CustomFieldDefinition,
  CustomFieldEntity,
  CustomFieldValue,
} from '../model/custom-fields.model.js';
import {
  CustomFieldsService,
  type CustomFieldsDescription,
} from '../service/custom-fields.service.js';

/** What other modules may call: the definitions and the values of an entity. */
@Injectable()
export class CustomFieldsFacade {
  constructor(private readonly service: CustomFieldsService) {}

  /** The module's name and version. */
  describe(): CustomFieldsDescription {
    return this.service.describe();
  }

  /** The fields of an entity, by `fieldOrder` then id; only the active ones when `activeOnly`. */
  definitionsFor(
    fieldto: CustomFieldEntity,
    options?: { readonly activeOnly?: boolean },
  ): Promise<readonly CustomFieldDefinition[]> {
    return this.service.definitionsFor(fieldto, options);
  }

  /** `relId -> fieldId -> value` for the records (checkbox and multiselect as arrays). */
  valuesFor(
    fieldto: CustomFieldEntity,
    relIds: readonly number[],
  ): Promise<ReadonlyMap<number, ReadonlyMap<number, CustomFieldValue>>> {
    return this.service.valuesFor(fieldto, relIds);
  }
}
