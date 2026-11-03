import { EventEmitter } from "events";
import { Request, Response } from "express";
import { requestMetadataContext } from "@/common/contexts/request-metadata.context";
import { createAccessLogMiddleware } from "@/middlewares/access-log.middleware";
import { LoggerService } from "@/modules/logger/logger.service";
import { MetricsService } from "@/modules/metrics/metrics.service";

const startRequest = (
  params: { method?: string; route?: string; statusCode?: number } = {},
  requestMetadata?: Map<string, string>,
) => {
  const logger = { log: jest.fn() };
  const metrics = { recordHttpRequest: jest.fn() };
  const response = Object.assign(new EventEmitter(), { statusCode: params.statusCode ?? 200 });
  const request = {
    method: params.method ?? "GET",
    route: params.route === undefined ? undefined : { path: params.route },
  };
  const next = jest.fn();
  const middleware = createAccessLogMiddleware(
    logger as unknown as LoggerService,
    metrics as unknown as MetricsService,
  );
  const start = () =>
    middleware(request as unknown as Request, response as unknown as Response, next);
  if (requestMetadata) {
    requestMetadataContext.run(requestMetadata, start);
  } else {
    start();
  }
  return { logger, metrics, response, request, next };
};

describe("createAccessLogMiddleware", () => {
  let clock: jest.SpyInstance;

  beforeEach(() => {
    clock = jest.spyOn(performance, "now");
    clock.mockReturnValueOnce(1000).mockReturnValue(1250);
  });

  afterEach(() => {
    clock.mockRestore();
  });

  it("lets the request carry on at once, before anything is recorded", () => {
    const { next, metrics, logger } = startRequest({ route: "/api/v1/programs" });

    expect(next).toHaveBeenCalledTimes(1);
    expect(metrics.recordHttpRequest).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("counts the request when the connection closes, by method, route template, status and duration", () => {
    const { response, metrics } = startRequest({
      method: "POST",
      route: "/api/v1/programs/:programId/reservations",
      statusCode: 201,
    });

    response.emit("close");

    expect(metrics.recordHttpRequest).toHaveBeenCalledTimes(1);
    expect(metrics.recordHttpRequest).toHaveBeenCalledWith({
      method: "POST",
      route: "/api/v1/programs/:programId/reservations",
      statusCode: 201,
      durationSeconds: 0.25,
    });
  });

  it("logs a business request with its route template, status and duration in milliseconds", () => {
    const { response, logger } = startRequest({
      route: "/api/v1/programs/:programId",
      statusCode: 404,
    });

    response.emit("close");

    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith("HTTP request", {
      route: "/api/v1/programs/:programId",
      statusCode: 404,
      durationMs: 250,
    });
  });

  it("logs the request id, the user, the method and the path the request was given", () => {
    const requestMetadata = new Map([
      ["requestId", "req-12345678"],
      ["method", "GET"],
      ["path", "/api/v1/programs/abc"],
    ]);
    const { response, logger } = startRequest(
      { route: "/api/v1/programs/:programId" },
      requestMetadata,
    );
    requestMetadata.set("userId", "user-1");

    response.emit("close");

    expect(logger.log).toHaveBeenCalledWith("HTTP request", {
      requestId: "req-12345678",
      userId: "user-1",
      method: "GET",
      path: "/api/v1/programs/abc",
      route: "/api/v1/programs/:programId",
      statusCode: 200,
      durationMs: 250,
    });
  });

  it("records the status the response ended with, not the one it started with", () => {
    const { response, metrics } = startRequest({ route: "/api/v1/programs", statusCode: 200 });
    response.statusCode = 503;

    response.emit("close");

    expect(metrics.recordHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 503 }),
    );
  });

  it("records nothing for a response that has finished but whose connection is still open", () => {
    const { response, metrics, logger } = startRequest({ route: "/api/v1/programs" });

    response.emit("finish");

    expect(metrics.recordHttpRequest).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("records a request once, however many times the response reports closing", () => {
    const { response, metrics, logger } = startRequest({ route: "/api/v1/programs" });

    response.emit("close");
    response.emit("close");

    expect(metrics.recordHttpRequest).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledTimes(1);
  });

  it.each(["/api/v1/health/live", "/api/v1/health/ready", "/api/v1/metrics"])(
    "counts a call to %s but does not log it, because probes and scrapes fire every few seconds",
    (route) => {
      const { response, metrics, logger } = startRequest({ route });

      response.emit("close");

      expect(metrics.recordHttpRequest).toHaveBeenCalledWith(expect.objectContaining({ route }));
      expect(logger.log).not.toHaveBeenCalled();
    },
  );

  it.each([
    "/api/v1/auth/login",
    "/api/v1/fx-rates",
    "/api/v1/programs/availability/stream",
    "/api/v1/programs/:programId/health",
    "/api/v1/programs/:programId/metrics",
    "/health",
  ])("counts and logs a call to %s", (route) => {
    const { response, metrics, logger } = startRequest({ route });

    response.emit("close");

    expect(metrics.recordHttpRequest).toHaveBeenCalledWith(expect.objectContaining({ route }));
    expect(logger.log).toHaveBeenCalledTimes(1);
  });

  it("files a request that matched no route under one label, so a scanner cannot mint endless metric series", () => {
    const { response, metrics, logger } = startRequest({ method: "GET", statusCode: 404 });

    response.emit("close");

    expect(metrics.recordHttpRequest).toHaveBeenCalledWith({
      method: "GET",
      route: "unmatched",
      statusCode: 404,
      durationSeconds: 0.25,
    });
    expect(logger.log).toHaveBeenCalledWith(
      "HTTP request",
      expect.objectContaining({ route: "unmatched", statusCode: 404 }),
    );
  });

  it("works outside a request context, with nothing extra to log", () => {
    const { response, logger } = startRequest({ route: "/api/v1/programs" });

    response.emit("close");

    expect(logger.log).toHaveBeenCalledWith("HTTP request", {
      route: "/api/v1/programs",
      statusCode: 200,
      durationMs: 250,
    });
  });

  it("rounds the duration it logs to whole milliseconds, and counts it exactly in seconds", () => {
    clock.mockReset();
    clock.mockReturnValueOnce(1000).mockReturnValue(1012.6);
    const { response, metrics, logger } = startRequest({ route: "/api/v1/programs" });

    response.emit("close");

    expect(metrics.recordHttpRequest.mock.calls[0][0].durationSeconds).toBeCloseTo(0.0126);
    expect(logger.log.mock.calls[0][1].durationMs).toBe(13);
  });
});
