import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { BrandingModule } from './branding/branding.module.js';
import { ContractTypesModule } from './contract-types/contract-types.module.js';
import { CostCentersModule } from './cost-centers/cost-centers.module.js';
import { CurrenciesModule } from './currencies/currencies.module.js';
import { CustomFieldsModule } from './custom-fields/custom-fields.module.js';
import { DepartmentsModule } from './departments/departments.module.js';
import { ExampleItemModule } from './example-item/example-item.module.js';
import { ExpenseCategoriesModule } from './expense-categories/expense-categories.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { MailModule } from './mail/mail.module.js';
import { PaymentModesModule } from './payment-modes/payment-modes.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { TaxesModule } from './taxes/taxes.module.js';

/** Registers every v1 module. Route prefix `api/v1` is applied globally in main.ts. */
@Module({
  imports: [
    ExampleItemModule,
    AuthModule,
    BrandingModule,
    IdentityModule,
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
  ],
})
export class V1Module {}
