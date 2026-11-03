import { Injectable } from "@nestjs/common";
import { Response } from "express";
import { MetricsService } from "@/modules/metrics/metrics.service";

@Injectable()
export class GetMetricsEndpointHandler {
  constructor(private readonly metricsService: MetricsService) {}

  handle(response: Response): Promise<string> {
    response.setHeader("Content-Type", this.metricsService.scrapeContentType());
    return this.metricsService.scrape();
  }
}
