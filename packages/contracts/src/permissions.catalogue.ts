/**
 * Clean ADR-0033 names: `module.resource.action`. This file is what erp-web mirrors (D-12).
 *
 * The catalogue is the only place a clean permission name is written down; every guard, route map
 * and mirror reads it from here, and an ESLint rule (`S_PERMISSION_LITERAL`, ADR-0033 §Enforcement)
 * makes a permission string literal anywhere else an error.
 *
 * **No Perfex permission code appears in this file.** The Perfex side lives in `perfex-mapping.ts`,
 * which is the only file in either repository allowed to carry one.
 */

/** A branch of the catalogue: leaves are clean names, branches group them by module and resource. */
interface PermissionTree {
  readonly [key: string]: string | PermissionTree;
}

/**
 * The clean-name tree — one branch per module the 507 active declared Perfex codes cover
 * (plan 03.1-10). Actions are normalised to `view`, `viewOwn`, `create`, `edit`, `delete` plus the
 * named specials `approve`, `assign`, `editOwn` and `deleteOwn` (ADR-0033 decision 1).
 */
export const PERMISSIONS = {
  accounting: {
    banking: {
      create: 'accounting.banking.create',
      delete: 'accounting.banking.delete',
      edit: 'accounting.banking.edit',
      view: 'accounting.banking.view',
    },
    bills: {
      create: 'accounting.bills.create',
      view: 'accounting.bills.view',
    },
    budget: {
      create: 'accounting.budget.create',
      delete: 'accounting.budget.delete',
      edit: 'accounting.budget.edit',
      view: 'accounting.budget.view',
    },
    chartOfAccounts: {
      create: 'accounting.chartOfAccounts.create',
      delete: 'accounting.chartOfAccounts.delete',
      edit: 'accounting.chartOfAccounts.edit',
      view: 'accounting.chartOfAccounts.view',
    },
    checks: {
      create: 'accounting.checks.create',
      view: 'accounting.checks.view',
    },
    dashboard: {
      view: 'accounting.dashboard.view',
    },
    journalEntry: {
      create: 'accounting.journalEntry.create',
      delete: 'accounting.journalEntry.delete',
      edit: 'accounting.journalEntry.edit',
      view: 'accounting.journalEntry.view',
    },
    reconcile: {
      create: 'accounting.reconcile.create',
      edit: 'accounting.reconcile.edit',
      view: 'accounting.reconcile.view',
    },
    registers: {
      create: 'accounting.registers.create',
      delete: 'accounting.registers.delete',
      edit: 'accounting.registers.edit',
      view: 'accounting.registers.view',
    },
    reports: {
      view: 'accounting.reports.view',
    },
    settings: {
      edit: 'accounting.settings.edit',
      view: 'accounting.settings.view',
    },
    transaction: {
      create: 'accounting.transaction.create',
      delete: 'accounting.transaction.delete',
      edit: 'accounting.transaction.edit',
      view: 'accounting.transaction.view',
    },
    transfer: {
      create: 'accounting.transfer.create',
      delete: 'accounting.transfer.delete',
      edit: 'accounting.transfer.edit',
      view: 'accounting.transfer.view',
    },
    vendor: {
      create: 'accounting.vendor.create',
      delete: 'accounting.vendor.delete',
      edit: 'accounting.vendor.edit',
      view: 'accounting.vendor.view',
    },
  },
  crm: {
    customers: {
      create: 'crm.customers.create',
      delete: 'crm.customers.delete',
      edit: 'crm.customers.edit',
      view: 'crm.customers.view',
      viewOwn: 'crm.customers.viewOwn',
    },
    leads: {
      delete: 'crm.leads.delete',
      view: 'crm.leads.view',
    },
  },
  fixedEquipment: {
    accessories: {
      create: 'fixedEquipment.accessories.create',
      delete: 'fixedEquipment.accessories.delete',
      edit: 'fixedEquipment.accessories.edit',
      view: 'fixedEquipment.accessories.view',
      viewOwn: 'fixedEquipment.accessories.viewOwn',
    },
    assetCreation: {
      create: 'fixedEquipment.assetCreation.create',
      delete: 'fixedEquipment.assetCreation.delete',
      edit: 'fixedEquipment.assetCreation.edit',
      view: 'fixedEquipment.assetCreation.view',
      viewOwn: 'fixedEquipment.assetCreation.viewOwn',
    },
    assetRequestForm: {
      create: 'fixedEquipment.assetRequestForm.create',
      delete: 'fixedEquipment.assetRequestForm.delete',
      edit: 'fixedEquipment.assetRequestForm.edit',
      view: 'fixedEquipment.assetRequestForm.view',
      viewOwn: 'fixedEquipment.assetRequestForm.viewOwn',
    },
    assets: {
      create: 'fixedEquipment.assets.create',
      delete: 'fixedEquipment.assets.delete',
      edit: 'fixedEquipment.assets.edit',
      view: 'fixedEquipment.assets.view',
      viewOwn: 'fixedEquipment.assets.viewOwn',
    },
    audit: {
      create: 'fixedEquipment.audit.create',
      delete: 'fixedEquipment.audit.delete',
      view: 'fixedEquipment.audit.view',
      viewOwn: 'fixedEquipment.audit.viewOwn',
    },
    components: {
      create: 'fixedEquipment.components.create',
      delete: 'fixedEquipment.components.delete',
      edit: 'fixedEquipment.components.edit',
      view: 'fixedEquipment.components.view',
      viewOwn: 'fixedEquipment.components.viewOwn',
    },
    consumables: {
      create: 'fixedEquipment.consumables.create',
      delete: 'fixedEquipment.consumables.delete',
      edit: 'fixedEquipment.consumables.edit',
      view: 'fixedEquipment.consumables.view',
      viewOwn: 'fixedEquipment.consumables.viewOwn',
    },
    dashboard: {
      view: 'fixedEquipment.dashboard.view',
      viewOwn: 'fixedEquipment.dashboard.viewOwn',
    },
    depreciations: {
      view: 'fixedEquipment.depreciations.view',
      viewOwn: 'fixedEquipment.depreciations.viewOwn',
    },
    inventory: {
      create: 'fixedEquipment.inventory.create',
      delete: 'fixedEquipment.inventory.delete',
      edit: 'fixedEquipment.inventory.edit',
      view: 'fixedEquipment.inventory.view',
      viewOwn: 'fixedEquipment.inventory.viewOwn',
    },
    licenses: {
      create: 'fixedEquipment.licenses.create',
      delete: 'fixedEquipment.licenses.delete',
      edit: 'fixedEquipment.licenses.edit',
      view: 'fixedEquipment.licenses.view',
      viewOwn: 'fixedEquipment.licenses.viewOwn',
    },
    locations: {
      create: 'fixedEquipment.locations.create',
      delete: 'fixedEquipment.locations.delete',
      edit: 'fixedEquipment.locations.edit',
      view: 'fixedEquipment.locations.view',
      viewOwn: 'fixedEquipment.locations.viewOwn',
    },
    maintenances: {
      create: 'fixedEquipment.maintenances.create',
      delete: 'fixedEquipment.maintenances.delete',
      edit: 'fixedEquipment.maintenances.edit',
      view: 'fixedEquipment.maintenances.view',
      viewOwn: 'fixedEquipment.maintenances.viewOwn',
    },
    orderList: {
      create: 'fixedEquipment.orderList.create',
      delete: 'fixedEquipment.orderList.delete',
      edit: 'fixedEquipment.orderList.edit',
      view: 'fixedEquipment.orderList.view',
      viewOwn: 'fixedEquipment.orderList.viewOwn',
    },
    predefinedKits: {
      create: 'fixedEquipment.predefinedKits.create',
      delete: 'fixedEquipment.predefinedKits.delete',
      edit: 'fixedEquipment.predefinedKits.edit',
      view: 'fixedEquipment.predefinedKits.view',
      viewOwn: 'fixedEquipment.predefinedKits.viewOwn',
    },
    reports: {
      view: 'fixedEquipment.reports.view',
      viewOwn: 'fixedEquipment.reports.viewOwn',
    },
    requested: {
      create: 'fixedEquipment.requested.create',
      delete: 'fixedEquipment.requested.delete',
      view: 'fixedEquipment.requested.view',
      viewOwn: 'fixedEquipment.requested.viewOwn',
    },
    settingCategory: {
      create: 'fixedEquipment.settingCategory.create',
      delete: 'fixedEquipment.settingCategory.delete',
      edit: 'fixedEquipment.settingCategory.edit',
      view: 'fixedEquipment.settingCategory.view',
      viewOwn: 'fixedEquipment.settingCategory.viewOwn',
    },
    settingCustomField: {
      create: 'fixedEquipment.settingCustomField.create',
      delete: 'fixedEquipment.settingCustomField.delete',
      edit: 'fixedEquipment.settingCustomField.edit',
      view: 'fixedEquipment.settingCustomField.view',
      viewOwn: 'fixedEquipment.settingCustomField.viewOwn',
    },
    settingDepreciation: {
      create: 'fixedEquipment.settingDepreciation.create',
      delete: 'fixedEquipment.settingDepreciation.delete',
      edit: 'fixedEquipment.settingDepreciation.edit',
      view: 'fixedEquipment.settingDepreciation.view',
      viewOwn: 'fixedEquipment.settingDepreciation.viewOwn',
    },
    settingManufacturer: {
      create: 'fixedEquipment.settingManufacturer.create',
      delete: 'fixedEquipment.settingManufacturer.delete',
      edit: 'fixedEquipment.settingManufacturer.edit',
      view: 'fixedEquipment.settingManufacturer.view',
      viewOwn: 'fixedEquipment.settingManufacturer.viewOwn',
    },
    settingModel: {
      create: 'fixedEquipment.settingModel.create',
      delete: 'fixedEquipment.settingModel.delete',
      edit: 'fixedEquipment.settingModel.edit',
      view: 'fixedEquipment.settingModel.view',
      viewOwn: 'fixedEquipment.settingModel.viewOwn',
    },
    settingStatusLabel: {
      create: 'fixedEquipment.settingStatusLabel.create',
      delete: 'fixedEquipment.settingStatusLabel.delete',
      edit: 'fixedEquipment.settingStatusLabel.edit',
      view: 'fixedEquipment.settingStatusLabel.view',
      viewOwn: 'fixedEquipment.settingStatusLabel.viewOwn',
    },
    settingSupplier: {
      create: 'fixedEquipment.settingSupplier.create',
      delete: 'fixedEquipment.settingSupplier.delete',
      edit: 'fixedEquipment.settingSupplier.edit',
      view: 'fixedEquipment.settingSupplier.view',
      viewOwn: 'fixedEquipment.settingSupplier.viewOwn',
    },
    signManager: {
      create: 'fixedEquipment.signManager.create',
      view: 'fixedEquipment.signManager.view',
      viewOwn: 'fixedEquipment.signManager.viewOwn',
    },
  },
  hr: {
    contract: {
      create: 'hr.contract.create',
      delete: 'hr.contract.delete',
      edit: 'hr.contract.edit',
      view: 'hr.contract.view',
      viewOwn: 'hr.contract.viewOwn',
    },
    dashboard: {
      view: 'hr.dashboard.view',
    },
    dependentPerson: {
      create: 'hr.dependentPerson.create',
      delete: 'hr.dependentPerson.delete',
      edit: 'hr.dependentPerson.edit',
      view: 'hr.dependentPerson.view',
      viewOwn: 'hr.dependentPerson.viewOwn',
    },
    jobPosition: {
      create: 'hr.jobPosition.create',
      delete: 'hr.jobPosition.delete',
      edit: 'hr.jobPosition.edit',
      view: 'hr.jobPosition.view',
      viewOwn: 'hr.jobPosition.viewOwn',
    },
    manageQA: {
      create: 'hr.manageQA.create',
      delete: 'hr.manageQA.delete',
      edit: 'hr.manageQA.edit',
      view: 'hr.manageQA.view',
    },
    orgchart: {
      create: 'hr.orgchart.create',
      delete: 'hr.orgchart.delete',
      edit: 'hr.orgchart.edit',
      view: 'hr.orgchart.view',
      viewOwn: 'hr.orgchart.viewOwn',
    },
    proceduresForQuittingWork: {
      create: 'hr.proceduresForQuittingWork.create',
      delete: 'hr.proceduresForQuittingWork.delete',
      edit: 'hr.proceduresForQuittingWork.edit',
      view: 'hr.proceduresForQuittingWork.view',
      viewOwn: 'hr.proceduresForQuittingWork.viewOwn',
    },
    receptionStaff: {
      create: 'hr.receptionStaff.create',
      delete: 'hr.receptionStaff.delete',
      edit: 'hr.receptionStaff.edit',
      view: 'hr.receptionStaff.view',
      viewOwn: 'hr.receptionStaff.viewOwn',
    },
    records: {
      create: 'hr.records.create',
      delete: 'hr.records.delete',
      edit: 'hr.records.edit',
      view: 'hr.records.view',
      viewOwn: 'hr.records.viewOwn',
    },
    reports: {
      view: 'hr.reports.view',
    },
    settings: {
      create: 'hr.settings.create',
      delete: 'hr.settings.delete',
      edit: 'hr.settings.edit',
      view: 'hr.settings.view',
    },
    training: {
      create: 'hr.training.create',
      delete: 'hr.training.delete',
      edit: 'hr.training.edit',
      view: 'hr.training.view',
    },
  },
  knowledgeBase: {
    articles: {
      create: 'knowledgeBase.articles.create',
      delete: 'knowledgeBase.articles.delete',
      edit: 'knowledgeBase.articles.edit',
      view: 'knowledgeBase.articles.view',
    },
  },
  manufacturing: {
    orders: {
      create: 'manufacturing.orders.create',
      delete: 'manufacturing.orders.delete',
      edit: 'manufacturing.orders.edit',
      view: 'manufacturing.orders.view',
    },
  },
  payroll: {
    attendance: {
      create: 'payroll.attendance.create',
      delete: 'payroll.attendance.delete',
      edit: 'payroll.attendance.edit',
      view: 'payroll.attendance.view',
      viewOwn: 'payroll.attendance.viewOwn',
    },
    bonusKpi: {
      create: 'payroll.bonusKpi.create',
      delete: 'payroll.bonusKpi.delete',
      edit: 'payroll.bonusKpi.edit',
      view: 'payroll.bonusKpi.view',
      viewOwn: 'payroll.bonusKpi.viewOwn',
    },
    commission: {
      create: 'payroll.commission.create',
      delete: 'payroll.commission.delete',
      edit: 'payroll.commission.edit',
      view: 'payroll.commission.view',
      viewOwn: 'payroll.commission.viewOwn',
    },
    deduction: {
      create: 'payroll.deduction.create',
      delete: 'payroll.deduction.delete',
      edit: 'payroll.deduction.edit',
      view: 'payroll.deduction.view',
      viewOwn: 'payroll.deduction.viewOwn',
    },
    employee: {
      create: 'payroll.employee.create',
      delete: 'payroll.employee.delete',
      edit: 'payroll.employee.edit',
      view: 'payroll.employee.view',
      viewOwn: 'payroll.employee.viewOwn',
    },
    incomeTax: {
      view: 'payroll.incomeTax.view',
      viewOwn: 'payroll.incomeTax.viewOwn',
    },
    insurance: {
      create: 'payroll.insurance.create',
      delete: 'payroll.insurance.delete',
      edit: 'payroll.insurance.edit',
      view: 'payroll.insurance.view',
      viewOwn: 'payroll.insurance.viewOwn',
    },
    payslip: {
      create: 'payroll.payslip.create',
      delete: 'payroll.payslip.delete',
      edit: 'payroll.payslip.edit',
      view: 'payroll.payslip.view',
      viewOwn: 'payroll.payslip.viewOwn',
    },
    payslipTemplate: {
      create: 'payroll.payslipTemplate.create',
      delete: 'payroll.payslipTemplate.delete',
      edit: 'payroll.payslipTemplate.edit',
      view: 'payroll.payslipTemplate.view',
      viewOwn: 'payroll.payslipTemplate.viewOwn',
    },
    reports: {
      view: 'payroll.reports.view',
    },
    settings: {
      create: 'payroll.settings.create',
      delete: 'payroll.settings.delete',
      edit: 'payroll.settings.edit',
      view: 'payroll.settings.view',
    },
  },
  projects: {
    checklistTemplates: {
      create: 'projects.checklistTemplates.create',
      delete: 'projects.checklistTemplates.delete',
    },
    milestones: {
      create: 'projects.milestones.create',
      delete: 'projects.milestones.delete',
      edit: 'projects.milestones.edit',
    },
    projects: {
      create: 'projects.projects.create',
      delete: 'projects.projects.delete',
      edit: 'projects.projects.edit',
      view: 'projects.projects.view',
      viewOwn: 'projects.projects.viewOwn',
    },
    taskTimesheets: {
      delete: 'projects.taskTimesheets.delete',
      deleteOwn: 'projects.taskTimesheets.deleteOwn',
      edit: 'projects.taskTimesheets.edit',
      editOwn: 'projects.taskTimesheets.editOwn',
    },
    tasks: {
      create: 'projects.tasks.create',
      delete: 'projects.tasks.delete',
      edit: 'projects.tasks.edit',
      view: 'projects.tasks.view',
      viewOwn: 'projects.tasks.viewOwn',
    },
  },
  purchase: {
    bidWaiver: {
      create: 'purchase.bidWaiver.create',
      delete: 'purchase.bidWaiver.delete',
      edit: 'purchase.bidWaiver.edit',
      view: 'purchase.bidWaiver.view',
      viewOwn: 'purchase.bidWaiver.viewOwn',
    },
    contracts: {
      create: 'purchase.contracts.create',
      delete: 'purchase.contracts.delete',
      edit: 'purchase.contracts.edit',
      view: 'purchase.contracts.view',
      viewOwn: 'purchase.contracts.viewOwn',
    },
    debitNotes: {
      create: 'purchase.debitNotes.create',
      delete: 'purchase.debitNotes.delete',
      edit: 'purchase.debitNotes.edit',
      view: 'purchase.debitNotes.view',
      viewOwn: 'purchase.debitNotes.viewOwn',
    },
    estimate: {
      approve: 'purchase.estimate.approve',
    },
    faf: {
      create: 'purchase.faf.create',
      delete: 'purchase.faf.delete',
      edit: 'purchase.faf.edit',
      view: 'purchase.faf.view',
      viewOwn: 'purchase.faf.viewOwn',
    },
    invoices: {
      approve: 'purchase.invoices.approve',
      create: 'purchase.invoices.create',
      delete: 'purchase.invoices.delete',
      edit: 'purchase.invoices.edit',
      view: 'purchase.invoices.view',
      viewOwn: 'purchase.invoices.viewOwn',
    },
    items: {
      create: 'purchase.items.create',
      delete: 'purchase.items.delete',
      edit: 'purchase.items.edit',
      view: 'purchase.items.view',
    },
    orderReturn: {
      create: 'purchase.orderReturn.create',
      delete: 'purchase.orderReturn.delete',
      edit: 'purchase.orderReturn.edit',
      view: 'purchase.orderReturn.view',
      viewOwn: 'purchase.orderReturn.viewOwn',
    },
    orders: {
      approve: 'purchase.orders.approve',
      create: 'purchase.orders.create',
      delete: 'purchase.orders.delete',
      edit: 'purchase.orders.edit',
      view: 'purchase.orders.view',
      viewOwn: 'purchase.orders.viewOwn',
    },
    pettyCash: {
      create: 'purchase.pettyCash.create',
      delete: 'purchase.pettyCash.delete',
      edit: 'purchase.pettyCash.edit',
      view: 'purchase.pettyCash.view',
      viewOwn: 'purchase.pettyCash.viewOwn',
    },
    quotations: {
      create: 'purchase.quotations.create',
      delete: 'purchase.quotations.delete',
      edit: 'purchase.quotations.edit',
      view: 'purchase.quotations.view',
      viewOwn: 'purchase.quotations.viewOwn',
    },
    reports: {
      view: 'purchase.reports.view',
    },
    request: {
      approve: 'purchase.request.approve',
      create: 'purchase.request.create',
      delete: 'purchase.request.delete',
      edit: 'purchase.request.edit',
      view: 'purchase.request.view',
      viewOwn: 'purchase.request.viewOwn',
    },
    settings: {
      edit: 'purchase.settings.edit',
    },
    vendorItems: {
      create: 'purchase.vendorItems.create',
      delete: 'purchase.vendorItems.delete',
      edit: 'purchase.vendorItems.edit',
      view: 'purchase.vendorItems.view',
      viewOwn: 'purchase.vendorItems.viewOwn',
    },
    vendors: {
      create: 'purchase.vendors.create',
      delete: 'purchase.vendors.delete',
      edit: 'purchase.vendors.edit',
      view: 'purchase.vendors.view',
      viewOwn: 'purchase.vendors.viewOwn',
    },
  },
  quality: {
    alert: {
      create: 'quality.alert.create',
      delete: 'quality.alert.delete',
      edit: 'quality.alert.edit',
      view: 'quality.alert.view',
      viewOwn: 'quality.alert.viewOwn',
    },
    check: {
      create: 'quality.check.create',
      delete: 'quality.check.delete',
      edit: 'quality.check.edit',
      view: 'quality.check.view',
      viewOwn: 'quality.check.viewOwn',
    },
    controlPoint: {
      create: 'quality.controlPoint.create',
      delete: 'quality.controlPoint.delete',
      edit: 'quality.controlPoint.edit',
      view: 'quality.controlPoint.view',
    },
    dashboard: {
      view: 'quality.dashboard.view',
    },
    failureLocation: {
      create: 'quality.failureLocation.create',
      delete: 'quality.failureLocation.delete',
      edit: 'quality.failureLocation.edit',
      view: 'quality.failureLocation.view',
    },
    settings: {
      create: 'quality.settings.create',
      delete: 'quality.settings.delete',
      edit: 'quality.settings.edit',
      view: 'quality.settings.view',
    },
  },
  reports: {
    general: {
      view: 'reports.general.view',
    },
    timesheets: {
      view: 'reports.timesheets.view',
    },
  },
  sales: {
    contractTemplates: {
      view: 'sales.contractTemplates.view',
    },
    contracts: {
      create: 'sales.contracts.create',
      delete: 'sales.contracts.delete',
      edit: 'sales.contracts.edit',
      view: 'sales.contracts.view',
      viewOwn: 'sales.contracts.viewOwn',
    },
    creditNotes: {
      create: 'sales.creditNotes.create',
      delete: 'sales.creditNotes.delete',
      edit: 'sales.creditNotes.edit',
      view: 'sales.creditNotes.view',
      viewOwn: 'sales.creditNotes.viewOwn',
    },
    estimateRequest: {
      create: 'sales.estimateRequest.create',
      delete: 'sales.estimateRequest.delete',
      edit: 'sales.estimateRequest.edit',
      view: 'sales.estimateRequest.view',
      viewOwn: 'sales.estimateRequest.viewOwn',
    },
    estimates: {
      create: 'sales.estimates.create',
      delete: 'sales.estimates.delete',
      edit: 'sales.estimates.edit',
      view: 'sales.estimates.view',
      viewOwn: 'sales.estimates.viewOwn',
    },
    expenses: {
      create: 'sales.expenses.create',
      delete: 'sales.expenses.delete',
      edit: 'sales.expenses.edit',
      view: 'sales.expenses.view',
      viewOwn: 'sales.expenses.viewOwn',
    },
    invoices: {
      create: 'sales.invoices.create',
      delete: 'sales.invoices.delete',
      edit: 'sales.invoices.edit',
      view: 'sales.invoices.view',
      viewOwn: 'sales.invoices.viewOwn',
    },
    items: {
      create: 'sales.items.create',
      delete: 'sales.items.delete',
      edit: 'sales.items.edit',
      view: 'sales.items.view',
    },
    payments: {
      create: 'sales.payments.create',
      delete: 'sales.payments.delete',
      edit: 'sales.payments.edit',
      view: 'sales.payments.view',
      viewOwn: 'sales.payments.viewOwn',
    },
    proposalTemplates: {
      view: 'sales.proposalTemplates.view',
    },
    proposals: {
      create: 'sales.proposals.create',
      delete: 'sales.proposals.delete',
      edit: 'sales.proposals.edit',
      view: 'sales.proposals.view',
      viewOwn: 'sales.proposals.viewOwn',
    },
    subscriptions: {
      create: 'sales.subscriptions.create',
      delete: 'sales.subscriptions.delete',
      edit: 'sales.subscriptions.edit',
      view: 'sales.subscriptions.view',
      viewOwn: 'sales.subscriptions.viewOwn',
    },
  },
  settings: {
    emailTemplates: {
      edit: 'settings.emailTemplates.edit',
      view: 'settings.emailTemplates.view',
    },
    general: {
      edit: 'settings.general.edit',
      view: 'settings.general.view',
    },
  },
  staff: {
    members: {
      create: 'staff.members.create',
      delete: 'staff.members.delete',
      edit: 'staff.members.edit',
      view: 'staff.members.view',
    },
    roles: {
      create: 'staff.roles.create',
      delete: 'staff.roles.delete',
      edit: 'staff.roles.edit',
      view: 'staff.roles.view',
    },
  },
  timesheets: {
    additional: {
      view: 'timesheets.additional.view',
      viewOwn: 'timesheets.additional.viewOwn',
    },
    attendance: {
      edit: 'timesheets.attendance.edit',
      view: 'timesheets.attendance.view',
      viewOwn: 'timesheets.attendance.viewOwn',
    },
    leave: {
      view: 'timesheets.leave.view',
      viewOwn: 'timesheets.leave.viewOwn',
    },
    reports: {
      view: 'timesheets.reports.view',
      viewOwn: 'timesheets.reports.viewOwn',
    },
    routes: {
      view: 'timesheets.routes.view',
      viewOwn: 'timesheets.routes.viewOwn',
    },
    settings: {
      view: 'timesheets.settings.view',
    },
    shiftwork: {
      view: 'timesheets.shiftwork.view',
      viewOwn: 'timesheets.shiftwork.viewOwn',
    },
    specificEmployees: {
      create: 'timesheets.specificEmployees.create',
    },
    workplaces: {
      view: 'timesheets.workplaces.view',
      viewOwn: 'timesheets.workplaces.viewOwn',
    },
  },
  utilities: {
    bulkPdfExporter: {
      view: 'utilities.bulkPdfExporter.view',
    },
  },
  warehouse: {
    history: {
      view: 'warehouse.history.view',
    },
    internalDeliveryNote: {
      create: 'warehouse.internalDeliveryNote.create',
      delete: 'warehouse.internalDeliveryNote.delete',
      edit: 'warehouse.internalDeliveryNote.edit',
      view: 'warehouse.internalDeliveryNote.view',
      viewOwn: 'warehouse.internalDeliveryNote.viewOwn',
    },
    items: {
      create: 'warehouse.items.create',
      delete: 'warehouse.items.delete',
      edit: 'warehouse.items.edit',
      view: 'warehouse.items.view',
    },
    lossAdjustment: {
      create: 'warehouse.lossAdjustment.create',
      delete: 'warehouse.lossAdjustment.delete',
      edit: 'warehouse.lossAdjustment.edit',
      view: 'warehouse.lossAdjustment.view',
      viewOwn: 'warehouse.lossAdjustment.viewOwn',
    },
    packingList: {
      create: 'warehouse.packingList.create',
      delete: 'warehouse.packingList.delete',
      edit: 'warehouse.packingList.edit',
      view: 'warehouse.packingList.view',
      viewOwn: 'warehouse.packingList.viewOwn',
    },
    receiptReturnOrder: {
      create: 'warehouse.receiptReturnOrder.create',
      delete: 'warehouse.receiptReturnOrder.delete',
      edit: 'warehouse.receiptReturnOrder.edit',
      view: 'warehouse.receiptReturnOrder.view',
      viewOwn: 'warehouse.receiptReturnOrder.viewOwn',
    },
    reports: {
      view: 'warehouse.reports.view',
    },
    settings: {
      create: 'warehouse.settings.create',
      delete: 'warehouse.settings.delete',
      edit: 'warehouse.settings.edit',
      view: 'warehouse.settings.view',
    },
    stockExport: {
      create: 'warehouse.stockExport.create',
      delete: 'warehouse.stockExport.delete',
      edit: 'warehouse.stockExport.edit',
      view: 'warehouse.stockExport.view',
      viewOwn: 'warehouse.stockExport.viewOwn',
    },
    stockExportSerialNumber: {
      edit: 'warehouse.stockExportSerialNumber.edit',
    },
    stockImport: {
      create: 'warehouse.stockImport.create',
      delete: 'warehouse.stockImport.delete',
      edit: 'warehouse.stockImport.edit',
      view: 'warehouse.stockImport.view',
      viewOwn: 'warehouse.stockImport.viewOwn',
    },
    warehouses: {
      assign: 'warehouse.warehouses.assign',
      create: 'warehouse.warehouses.create',
      delete: 'warehouse.warehouses.delete',
      edit: 'warehouse.warehouses.edit',
      view: 'warehouse.warehouses.view',
    },
  },
} as const;

const leavesOf = (node: PermissionTree): string[] =>
  Object.values(node).flatMap((value) => (typeof value === 'string' ? [value] : leavesOf(value)));

/** Every leaf of `PERMISSIONS`, sorted and de-duplicated. */
export const PERMISSION_CODES: readonly string[] = [...new Set(leavesOf(PERMISSIONS))].sort();

/** A clean permission name that the catalogue declares. */
export type PermissionCode = (typeof PERMISSION_CODES)[number];

/** Narrows an unknown value to a name the catalogue declares — the only membership test. */
export function isPermissionCode(value: unknown): value is PermissionCode {
  return typeof value === 'string' && PERMISSION_CODES.includes(value);
}
