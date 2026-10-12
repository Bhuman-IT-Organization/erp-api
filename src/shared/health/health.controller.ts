import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HEALTH_ROUTES } from '../http/api-prefix.js';
import { ApiZod } from '../http/openapi.js';
import { HTTP_STATUS } from '../http/status.js';
import { HealthService } from './health.service.js';
import { healthReportSchema, type HealthReport } from './health.types.js';

const HTTP_SERVICE_UNAVAILABLE = 503;

/**
 * GET /health (excluded from the global prefix) and GET /api/v1/health (through Nginx).
 * Returns 200 with the report, or 503 with the same body shape when any probe fails.
 * Controllers hold no logic and never catch (approved plan).
 */
@Controller([...HEALTH_ROUTES])
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiZod({
    summary: 'Health of the api and its dependencies (BE-07)',
    responses: {
      [HTTP_STATUS.OK]: healthReportSchema,
      [HTTP_SERVICE_UNAVAILABLE]: healthReportSchema,
    },
    security: 'none',
  })
  async get(): Promise<HealthReport> {
    const report = await this.health.report();
    if (report.status !== 'ok') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
