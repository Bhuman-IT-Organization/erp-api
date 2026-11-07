import { Module } from '@nestjs/common';
import { AnnouncementsModule } from './announcements/announcements.module.js';
import { IdentityModule } from './identity/identity.module.js';

@Module({
  imports: [IdentityModule, AnnouncementsModule],
})
export class V1Module {}
