import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { BrandingModule } from './branding/branding.module.js';
import { ContractTypesModule } from './contract-types/contract-types.module.js';
import { CostCentersModule } from './cost-centers/cost-centers.module.js';
import { CurrenciesModule } from './currencies/currencies.module.js';
import { CustomFieldsModule } from './custom-fields/custom-fields.module.js';
import { CustomerGroupsModule } from './customer-groups/customer-groups.module.js';
import { DepartmentsModule } from './departments/departments.module.js';
import { ExampleItemModule } from './example-item/example-item.module.js';
import { ExpenseCategoriesModule } from './expense-categories/expense-categories.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { LeadStatusesModule } from './lead-statuses/lead-statuses.module.js';
import { MailModule } from './mail/mail.module.js';
import { PaymentModesModule } from './payment-modes/payment-modes.module.js';
import { LeadSourcesModule } from './lead-sources/lead-sources.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { TaxesModule } from './taxes/taxes.module.js';
import { ServicesModule } from './services/services.module.js';
import { TicketStatusesModule } from './ticket-statuses/ticket-statuses.module.js';
import { TicketPrioritiesModule } from './ticket-priorities/ticket-priorities.module.js';

/** Registers every v1 module. Route prefix `api/v1` is applied globally in main.ts. */
@Module({
  imports: [
    ExampleItemModule,
    ServicesModule,
    AuthModule,
    BrandingModule,
    IdentityModule,
    LeadStatusesModule,
    ExpenseCategoriesModule,
    MailModule,
    TaxesModule,
    CostCentersModule,
    ContractTypesModule,
    PaymentModesModule,
    CurrenciesModule,
    DepartmentsModule,
    SettingsModule,
    CustomFieldsModule,
    LeadSourcesModule,
    TicketStatusesModule,
    CustomerGroupsModule,
    TicketPrioritiesModule,
  ],
})
export class V1Module {}
