import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { ApplicationExceptionFilter } from "@/common/filters/application-exception.filter";
import { LoggerService } from "@/modules/logger/logger.service";

const buildLogger = () => {
  const logger = { critical: jest.fn(), error: jest.fn(), warn: jest.fn(), forContext: jest.fn() };
  logger.forContext.mockReturnValue(logger);
  return logger;
};

const buildHost = (params: { route?: string; headersSent?: boolean } = {}) => {
  const response = {
    headersSent: params.headersSent ?? false,
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const request = {
    method: "POST",
    route: params.route === undefined ? undefined : { path: params.route },
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
};

describe("ApplicationExceptionFilter", () => {
  let logger: ReturnType<typeof buildLogger>;
  let filter: ApplicationExceptionFilter;

  beforeEach(() => {
    logger = buildLogger();
    filter = new ApplicationExceptionFilter(logger as unknown as LoggerService);
  });

  it("answers an application error with its own status, code, message and details", () => {
    const { host, response } = buildHost({ route: "/api/v1/programs/:programId/reservations" });
    const error = new HttpException(
      {
        statusCode: 409,
        code: "INSUFFICIENT_CAPACITY",
        message: "Program has insufficient available capacity",
        details: { requested: "10.00", available: "5.00" },
      },
      409,
    );

    filter.catch(error, host);

    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 409,
      code: "INSUFFICIENT_CAPACITY",
      message: "Program has insufficient available capacity",
      details: { requested: "10.00", available: "5.00" },
    });
  });

  it("gives a framework error a code derived from its status, so every error has one shape", () => {
    const { host, response } = buildHost();

    filter.catch(new NotFoundException("Cannot GET /api/v1/nothing"), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "Cannot GET /api/v1/nothing",
      error: "Not Found",
    });
  });

  it("gives a rate-limited caller a TOO_MANY_REQUESTS code", () => {
    const { host, response } = buildHost();

    filter.catch(new ThrottlerException("Too many requests, try again in a minute"), host);

    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 429, code: "TOO_MANY_REQUESTS" }),
    );
  });

  it("lets the code an exception states win over the one derived from its status", () => {
    const { host, response } = buildHost();

    filter.catch(
      new BadRequestException({
        statusCode: 400,
        code: "VALIDATION_FAILED",
        message: "Request validation failed",
      }),
      host,
    );

    expect(response.json).toHaveBeenCalledWith({
      statusCode: 400,
      code: "VALIDATION_FAILED",
      message: "Request validation failed",
    });
  });

  it("wraps a plain-text exception body as a message", () => {
    const { host, response } = buildHost();

    filter.catch(new HttpException("short and stout", 418), host);

    expect(response.status).toHaveBeenCalledWith(418);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 418,
      code: "I_AM_A_TEAPOT",
      message: "short and stout",
    });
  });

  it("answers an unexpected error with a generic 500 that reveals nothing about it", () => {
    const { host, response } = buildHost({ route: "/api/v1/programs" });

    filter.catch(new Error("connect ECONNREFUSED 10.0.0.5:5432 as capacity/hunter2"), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 500,
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
    });
  });

  it("answers a thrown value that is not an Error the same generic way", () => {
    const { host, response } = buildHost();

    filter.catch("just a string", host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 500,
      code: "INTERNAL_SERVER_ERROR",
      message: "Internal server error",
    });
    expect(logger.critical).toHaveBeenCalledWith(
      "Unexpected error",
      expect.objectContaining({ statusCode: 500 }),
    );
  });

  it("pages someone for an unexpected error, with the raw error, the method and the route template", () => {
    const { host } = buildHost({ route: "/api/v1/programs/:programId" });
    const error = new TypeError("cannot read properties of undefined");

    filter.catch(error, host);

    expect(logger.critical).toHaveBeenCalledWith("cannot read properties of undefined", {
      error,
      method: "POST",
      route: "/api/v1/programs/:programId",
      statusCode: 500,
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("pages someone for a server-side HttpException too", () => {
    const { host } = buildHost({ route: "/api/v1/programs/:programId/reservations" });
    const error = new ServiceUnavailableException({
      statusCode: 503,
      code: "LOCK_TIMEOUT",
      message: "Busy",
    });

    filter.catch(error, host);

    expect(logger.critical).toHaveBeenCalledWith(
      error.message,
      expect.objectContaining({
        statusCode: 503,
        route: "/api/v1/programs/:programId/reservations",
      }),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("only logs an expected failure at error level: the client got it wrong, nobody is paged", () => {
    const { host } = buildHost({ route: "/api/v1/programs/:programId" });
    const error = new HttpException(
      { statusCode: 404, code: "PROGRAM_NOT_FOUND", message: "No such program" },
      404,
    );

    filter.catch(error, host);

    expect(logger.error).toHaveBeenCalledWith(error.message, {
      error,
      method: "POST",
      route: "/api/v1/programs/:programId",
      statusCode: 404,
    });
    expect(logger.critical).not.toHaveBeenCalled();
  });

  it("draws the line between expected and paged exactly at status 500", () => {
    filter.catch(new HttpException("below", 499), buildHost().host);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.critical).not.toHaveBeenCalled();

    filter.catch(new HttpException("at", 500), buildHost().host);
    expect(logger.critical).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("copes with a request that matched no route", () => {
    const { host, response } = buildHost();

    filter.catch(new NotFoundException("Cannot GET /x"), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(logger.error).toHaveBeenCalledWith(
      "Cannot GET /x",
      expect.objectContaining({ route: undefined, method: "POST" }),
    );
  });

  it("writes nothing once the response has started, and says so", () => {
    const { host, response } = buildHost({
      route: "/api/v1/programs/availability/stream",
      headersSent: true,
    });

    filter.catch(new Error("stream broke"), host);

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
    expect(logger.critical).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("Exception occurred after response was sent", {
      method: "POST",
      route: "/api/v1/programs/availability/stream",
      statusCode: 500,
    });
  });

  it("does not warn when the response is still open", () => {
    filter.catch(new Error("x"), buildHost().host);

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
