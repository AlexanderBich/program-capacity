import { createLogger } from "winston";
import Transport from "winston-transport";
import { requestMetadataContext } from "@/common/contexts/request-metadata.context";
import { LoggerService } from "@/modules/logger/logger.service";

type LogRecord = Record<string, unknown>;

class CapturingTransport extends Transport {
  readonly records: LogRecord[] = [];

  log(info: LogRecord, callback: () => void) {
    this.records.push({ ...info });
    callback();
  }
}

const buildLogger = () => {
  const transport = new CapturingTransport();
  const logger = new LoggerService(createLogger({ level: "debug", transports: [transport] }));
  return { logger, records: transport.records };
};

const requestMetadata = () =>
  new Map([
    ["requestId", "req-12345678"],
    ["userId", "user-1"],
    ["method", "POST"],
    ["path", "/api/v1/programs"],
  ]);

describe("LoggerService", () => {
  describe("log", () => {
    it("writes an info record with the message and the metadata", () => {
      const { logger, records } = buildLogger();

      logger.log("Program created", { programId: "p-1" });

      expect(records).toEqual([
        expect.objectContaining({ level: "info", message: "Program created", programId: "p-1" }),
      ]);
    });

    it("writes a record with no metadata at all", () => {
      const { logger, records } = buildLogger();

      logger.log("Started");

      expect(records).toEqual([expect.objectContaining({ level: "info", message: "Started" })]);
    });
  });

  describe("debug", () => {
    it("writes a debug record with the message and the metadata", () => {
      const { logger, records } = buildLogger();

      logger.debug("Cache miss", { key: "k" });

      expect(records).toEqual([
        expect.objectContaining({ level: "debug", message: "Cache miss", key: "k" }),
      ]);
    });
  });

  describe("warn", () => {
    it("writes a warn record with the message and the metadata", () => {
      const { logger, records } = buildLogger();

      logger.warn("Replayed", { familyId: "f-1" });

      expect(records).toEqual([
        expect.objectContaining({ level: "warn", message: "Replayed", familyId: "f-1" }),
      ]);
    });

    it("spells out the error it is given instead of logging the object", () => {
      const { logger, records } = buildLogger();
      const error = new RangeError("out of range");

      logger.warn("Odd", { error, programId: "p-1" });

      expect(records[0]).toMatchObject({
        errorName: "RangeError",
        errorMessage: "out of range",
        programId: "p-1",
      });
      expect(String(records[0].stack)).toContain("RangeError: out of range");
      expect(records[0]).not.toHaveProperty("error");
    });
  });

  describe("error", () => {
    it("writes an error record that nobody is paged for", () => {
      const { logger, records } = buildLogger();

      logger.error("Program not found", { programId: "p-1", statusCode: 404 });

      expect(records).toEqual([
        expect.objectContaining({
          level: "error",
          message: "Program not found",
          programId: "p-1",
          statusCode: 404,
        }),
      ]);
      expect(records[0]).not.toHaveProperty("critical");
    });

    it("spells out the error it is given: its name, message and stack", () => {
      const { logger, records } = buildLogger();
      const error = new TypeError("cannot read properties of undefined");

      logger.error("Failed", { error });

      expect(records[0]).toMatchObject({
        errorName: "TypeError",
        errorMessage: "cannot read properties of undefined",
      });
      expect(String(records[0].stack)).toContain("TypeError: cannot read properties of undefined");
      expect(records[0]).not.toHaveProperty("error");
    });

    it("keeps what was thrown when it is not an Error, rather than losing it", () => {
      const { logger, records } = buildLogger();

      logger.error("Failed", { error: "broker said no" });

      expect(records[0].errorMessage).toBe("broker said no");
      expect(records[0]).not.toHaveProperty("error");
    });

    it("leaves out the error fields when no error is given", () => {
      const { logger, records } = buildLogger();

      logger.error("Failed", { programId: "p-1" });

      expect(records[0].errorName).toBeUndefined();
      expect(records[0].errorMessage).toBeUndefined();
      expect(records[0].stack).toBeUndefined();
    });

    it("writes a record with no metadata at all", () => {
      const { logger, records } = buildLogger();

      logger.error("Failed");

      expect(records).toEqual([expect.objectContaining({ level: "error", message: "Failed" })]);
    });
  });

  describe("critical", () => {
    it("writes an error record flagged critical, which is what alerting keys on", () => {
      const { logger, records } = buildLogger();

      logger.critical("Treasury feed stuck", { topic: "treasury.capacity.v1" });

      expect(records).toEqual([
        expect.objectContaining({
          level: "error",
          message: "Treasury feed stuck",
          topic: "treasury.capacity.v1",
          critical: true,
        }),
      ]);
    });

    it("spells out the error it is given, like an ordinary error record", () => {
      const { logger, records } = buildLogger();

      logger.critical("Unexpected error", { error: new Error("boom") });

      expect(records[0]).toMatchObject({
        critical: true,
        errorName: "Error",
        errorMessage: "boom",
      });
      expect(records[0]).not.toHaveProperty("error");
    });

    it("cannot be un-flagged by metadata", () => {
      const { logger, records } = buildLogger();

      logger.critical("Unexpected error", { critical: false });

      expect(records[0].critical).toBe(true);
    });
  });

  describe("request metadata", () => {
    it.each(["log", "debug", "warn", "error", "critical"] as const)(
      "stamps a %s record with the request, the user, the method and the path",
      (method) => {
        const { logger, records } = buildLogger();

        requestMetadataContext.run(requestMetadata(), () => logger[method]("Something happened"));

        expect(records[0]).toMatchObject({
          requestId: "req-12345678",
          userId: "user-1",
          method: "POST",
          path: "/api/v1/programs",
        });
      },
    );

    it.each(["log", "debug", "warn", "error", "critical"] as const)(
      "stamps a %s record with nothing when there is no request, such as in a cron job",
      (method) => {
        const { logger, records } = buildLogger();

        logger[method]("Something happened");

        expect(records[0].requestId).toBeUndefined();
        expect(records[0].userId).toBeUndefined();
        expect(records[0].method).toBeUndefined();
        expect(records[0].path).toBeUndefined();
      },
    );

    it("stamps only what is known, such as a request that has no signed-in user yet", () => {
      const { logger, records } = buildLogger();

      requestMetadataContext.run(new Map([["requestId", "req-12345678"]]), () =>
        logger.warn("Anonymous"),
      );

      expect(records[0].requestId).toBe("req-12345678");
      expect(records[0].userId).toBeUndefined();
    });

    it("lets metadata passed to a call win over the request's", () => {
      const { logger, records } = buildLogger();

      requestMetadataContext.run(requestMetadata(), () =>
        logger.log("Override", { method: "GET" }),
      );

      expect(records[0].method).toBe("GET");
    });
  });

  describe("forContext", () => {
    it("returns a logger whose records carry the context", () => {
      const { logger, records } = buildLogger();

      logger.forContext("AuthSessionService").warn("Replayed");
      logger.forContext("AccessLog").log("HTTP request");

      expect(records).toEqual([
        expect.objectContaining({ level: "warn", context: "AuthSessionService" }),
        expect.objectContaining({ level: "info", context: "AccessLog" }),
      ]);
    });

    it("leaves the logger it was made from without that context", () => {
      const { logger, records } = buildLogger();

      logger.forContext("AuthSessionService");
      logger.log("Plain");

      expect(records[0]).not.toHaveProperty("context");
    });

    it("keeps every kind of record working under a context", () => {
      const { logger, records } = buildLogger();
      const child = logger.forContext("Cron");

      child.log("a");
      child.debug("b");
      child.warn("c");
      child.error("d");
      child.critical("e");

      expect(
        records.map(({ level, message, context, critical }) => ({
          level,
          message,
          context,
          critical,
        })),
      ).toEqual([
        { level: "info", message: "a", context: "Cron", critical: undefined },
        { level: "debug", message: "b", context: "Cron", critical: undefined },
        { level: "warn", message: "c", context: "Cron", critical: undefined },
        { level: "error", message: "d", context: "Cron", critical: undefined },
        { level: "error", message: "e", context: "Cron", critical: true },
      ]);
    });
  });
});
