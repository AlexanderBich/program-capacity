import { Global, Module } from "@nestjs/common";
import { MetricsController } from "@/modules/metrics/http/controllers/metrics.controller";
import { GetMetricsEndpointHandler } from "@/modules/metrics/http/endpoints/get-metrics.endpoint-handler";
import { MetricsService } from "@/modules/metrics/metrics.service";

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, GetMetricsEndpointHandler],
  exports: [MetricsService],
})
export class MetricsModule {}
