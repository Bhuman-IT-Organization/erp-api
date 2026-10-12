import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/** Exposes the guarded Prisma client everywhere; module repositories inject PrismaService. */
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class DbModule {}
