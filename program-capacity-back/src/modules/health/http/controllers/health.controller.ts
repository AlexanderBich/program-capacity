import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ProbeTokenGuard } from "@/common/guards/probe-token.guard";
import { SkipJwtAuth } from "@/modules/auth/decorators/skip-jwt-auth.decorator";
import { SkipRateLimit } from "@/modules/auth/decorators/skip-rate-limit.decorator";
import { LivenessResponseDto } from "@/modules/health/http/dto/liveness-response.dto";
import { ReadinessResponseDto } from "@/modules/health/http/dto/readiness-response.dto";
import { GetReadinessEndpointHandler } from "@/modules/health/http/endpoints/get-readiness.endpoint-handler";

@ApiTags("health")
@ApiHeader({ name: "x-probe-token", required: true })
@SkipJwtAuth()
@SkipRateLimit()
@UseGuards(ProbeTokenGuard)
@Controller("health")
export class HealthController {
  constructor(private readonly getReadinessEndpointHandler: GetReadinessEndpointHandler) {}

  @Get("live")
  @ApiOperation({ summary: "Liveness probe" })
  @ApiOkResponse({ type: LivenessResponseDto })
  live(): LivenessResponseDto {
    return { status: "ok" };
  }

  @Get("ready")
  @ApiOperation({ summary: "Readiness probe" })
  @ApiOkResponse({ type: ReadinessResponseDto })
  ready(): Promise<ReadinessResponseDto> {
    return this.getReadinessEndpointHandler.handle();
  }
}
