/**
 * What identity registers with the departments module when it starts (D-51, D-49, D-55): one
 * read-only usage counter, `staffMembers`, so the `v1/departments` reads show how many staff members
 * belong to each department, and the staff directory, so its manager list shows the active members
 * and its records name their managers. Departments imports no other v1 module; identity hands both
 * in from its own `onModuleInit`, so the import runs one way only (identity -> departments) and no
 * cycle is possible.
 *
 * The counter answers one number per department id: the DISTINCT staff members holding it in
 * `tblstaff_departments`. It answers no staff id and never writes. The directory answers what `IdentityFacade` answers.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DepartmentsFacade } from '../../departments/index.js';
import { IdentityFacade } from '../facade/identity.facade.js';
import { IdentityRepository } from '../repository/identity.repository.js';

@Injectable()
export class IdentityDepartmentLinks implements OnModuleInit {
  constructor(
    private readonly departments: DepartmentsFacade,
    private readonly repository: IdentityRepository,
    private readonly identity: IdentityFacade,
  ) {}

  onModuleInit(): void {
    this.departments.registerUsage({
      key: 'staffMembers',
      module: 'identity',
      noun: 'staff member',
      count: (departmentId) => this.repository.countDepartmentMembers(departmentId),
    });
    this.departments.registerStaffDirectory({
      listActive: async () =>
        (await this.identity.listActiveMembers()).map((member) => ({
          staffId: member.staffId,
          name: member.name,
        })),
      namesOf: (staffIds) => this.identity.namesOf(staffIds),
    });
  }
}
