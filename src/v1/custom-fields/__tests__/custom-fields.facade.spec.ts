/**
 * CustomFieldsFacade over the in-memory repository: the definitions of an entity in Perfex's order
 * (`field_order`, then id), the active ones only when asked; the values of records read back through
 * the codec, skipping values of another entity's fields. Reads only: the facade offers no write.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CustomFieldsFacade } from '../facade/custom-fields.facade.js';
import { CustomFieldsService } from '../service/custom-fields.service.js';
import { CustomFieldsTransformer } from '../service/custom-fields.transformer.js';
import { CustomFieldsValidator } from '../service/custom-fields.validator.js';
import { asRepository, InMemoryCustomFieldsRepository, newField } from './fakes.js';

describe('CustomFieldsFacade', () => {
  let repo: InMemoryCustomFieldsRepository;
  let facade: CustomFieldsFacade;

  beforeEach(() => {
    repo = new InMemoryCustomFieldsRepository();
    // ids 1 to 4: two staff fields out of id order, one inactive, one of another entity.
    repo.seed(newField({ fieldto: 'staff', name: 'B', slug: 'b', fieldOrder: 2 }));
    repo.seed(
      newField({
        fieldto: 'staff',
        name: 'A',
        slug: 'a',
        fieldOrder: 1,
        type: 'multiselect',
        options: 'x,y',
      }),
    );
    repo.seed(
      newField({
        fieldto: 'staff',
        name: 'Off',
        slug: 'off',
        fieldOrder: 0,
        active: false,
        type: 'textarea',
      }),
    );
    repo.seed(newField({ fieldto: 'leads', name: 'L', slug: 'l' }));
    const service = new CustomFieldsService(
      new CustomFieldsValidator(),
      asRepository(repo),
      new CustomFieldsTransformer(),
    );
    facade = new CustomFieldsFacade(service);
  });

  it('describe answers the module name and version', () => {
    expect(facade.describe()).toEqual({ module: 'custom-fields', version: 1 });
  });

  it("definitionsFor('staff', { activeOnly: true }) omits inactive fields, ordered by fieldOrder then id", async () => {
    const all = await facade.definitionsFor('staff');
    expect(all.map((d) => d.id)).toEqual([3, 2, 1]);
    const active = await facade.definitionsFor('staff', { activeOnly: true });
    expect(active.map((d) => d.id)).toEqual([2, 1]);
    expect(active[0]).toMatchObject({
      type: 'multiselect',
      options: ['x', 'y'],
      fieldto: 'staff',
    });
  });

  it('valuesFor reads the values of the records through the read codec, by rel id then field id', async () => {
    repo.addValue(2, 10, 'x, y');
    repo.addValue(3, 10, 'a<br />\nb');
    repo.addValue(4, 10, 'not a staff value');
    const values = await facade.valuesFor('staff', [10, 11]);
    expect([...(values.get(10) ?? new Map())]).toEqual([
      [2, ['x', 'y']],
      [3, 'a\nb'],
    ]);
    expect(values.has(11)).toBe(false);
  });
});
