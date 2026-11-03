import { Controller, Get, Res, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { ProbeTokenGuard } from "@/common/guards/probe-token.guard";
import { SkipJwtAuth } from "@/modules/auth/decorators/skip-jwt-auth.decorator";
import { SkipRateLimit } from "@/modules/auth/decorators/skip-rate-limit.decorator";
import { GetMetricsEndpointHandler } from "@/modules/metrics/http/endpoints/get-metrics.endpoint-handler";

@ApiTags("metrics")
@ApiHeader({ name: "x-probe-token", required: true })
@SkipJwtAuth()
@SkipRateLimit()
@UseGuards(ProbeTokenGuard)
@Controller("metrics")
export class MetricsController {
  constructor(private readonly getMetricsEndpointHandler: GetMetricsEndpointHandler) {}

  @Get()
  @ApiOperation({ summary: "Prometheus metrics", description: "Authenticated by the probe token." })
  @ApiProduces("text/plain")
  @ApiOkResponse({ type: String })
  scrape(@Res({ passthrough: true }) response: Response): Promise<string> {
    return this.getMetricsEndpointHandler.handle(response);
  }
}
