/**
 * Public surface of the module: the module (a sender imports it, it is not global), the facade, the
 * model types and the types a sending module registers its templates with. Other modules import from here; the architecture block forbids deeper paths.
 */
export { MailModule } from './mail.module.js';
export { MailFacade } from './facade/mail.facade.js';
export type * from './model/mail.model.js';
export type {
  MailAttachment,
  MailTemplateDefinition,
  MergeFieldDefinition,
  ResolvedMail,
} from './service/mail-template.registry.js';
export type { MailMessageKey } from './service/mail.messages.js';
