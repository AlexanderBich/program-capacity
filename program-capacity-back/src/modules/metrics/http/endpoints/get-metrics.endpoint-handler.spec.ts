import { Response } from "express";
import { GetMetricsEndpointHandler } from "@/modules/metrics/http/endpoints/get-metrics.endpoint-handler";
import { MetricsService } from "@/modules/metrics/metrics.service";

describe("GetMetricsEndpointHandler", () => {
  describe("handle", () => {
    it("serves what was recorded, labels included, in the format Prometheus expects", async () => {
      const metricsService = new MetricsService();
      metricsService.recordReservation("created");
      metricsService.recordHttpRequest({
        method: "GET",
        route: "/api/v1/programs",
        statusCode: 200,
        durationSeconds: 0.02,
      });
      const headers: Record<string, string> = {};
      const response = {
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
      } as unknown as Response;

      const body = await new GetMetricsEndpointHandler(metricsService).handle(response);

      expect(headers).toEqual({ "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
      expect(body).toContain('capacity_reservations_total{outcome="created"} 1');
      expect(body).toContain(
        'http_requests_total{method="GET",route="/api/v1/programs",status_code="200"} 1',
      );
    });

    it("serves the current numbers on every call, not a snapshot", async () => {
      const metricsService = new MetricsService();
      const handler = new GetMetricsEndpointHandler(metricsService);
      const response = { setHeader: jest.fn() } as unknown as Response;

      metricsService.recordProgramLockTimeout();
      const first = await handler.handle(response);
      metricsService.recordProgramLockTimeout();
      const second = await handler.handle(response);

      expect(first).toContain("capacity_program_lock_timeouts_total 1");
      expect(second).toContain("capacity_program_lock_timeouts_total 2");
    });
  });
});
