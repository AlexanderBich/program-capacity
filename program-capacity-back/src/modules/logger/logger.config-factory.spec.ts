import { ConfigService } from "@nestjs/config";
import Transport from "winston-transport";
import { loggerConfigFactory } from "@/modules/logger/logger.config-factory";

const MESSAGE = Symbol.for("message");

type Info = Parameters<NonNullable<Transport["format"]>["transform"]>[0];

const buildOptions = (nodeEnv: string) =>
  loggerConfigFactory({
    getOrThrow: (key: string) => {
      if (key !== "nodeEnv") {
        throw new Error(`Unexpected config key ${key}`);
      }
      return nodeEnv;
    },
  } as unknown as ConfigService);

const renderWithConsoleTransport = (nodeEnv: string, info: Record<string, unknown>): string => {
  const [console] = buildOptions(nodeEnv).transports as Transport[];
  const rendered = console.format!.transform(
    { ...info } as Info,
    console.format!.options,
  ) as Record<symbol, string>;
  return rendered[MESSAGE];
};

describe("loggerConfigFactory", () => {
  it("logs everything down to debug while developing, and nothing is silenced", () => {
    const options = buildOptions("development");

    expect(options.level).toBe("debug");
    expect(options.silent).toBe(false);
  });

  it.each(["production", "staging"])(
    "logs from info up in %s, and nothing is silenced",
    (nodeEnv) => {
      const options = buildOptions(nodeEnv);

      expect(options.level).toBe("info");
      expect(options.silent).toBe(false);
    },
  );

  it("is silent under test, so a test run is not buried in log lines", () => {
    expect(buildOptions("test").silent).toBe(true);
  });

  it("writes to the console only", () => {
    expect(buildOptions("production").transports).toHaveLength(1);
    expect(buildOptions("development").transports).toHaveLength(1);
  });

  describe("outside development", () => {
    it("writes one JSON object per record with its time, level and message, for a log aggregator", () => {
      const line = renderWithConsoleTransport("production", {
        level: "error",
        message: "Unexpected error",
        critical: true,
        route: "/api/v1/programs",
      });

      const record = JSON.parse(line);
      expect(record).toMatchObject({
        level: "error",
        message: "Unexpected error",
        critical: true,
        route: "/api/v1/programs",
      });
      expect(new Date(record.timestamp).toISOString()).toBe(record.timestamp);
      expect(line).not.toContain("\n");
    });

    it("keeps the stack of an error that is logged as the message", () => {
      const line = renderWithConsoleTransport("production", {
        level: "error",
        message: new Error("boom"),
      });

      const record = JSON.parse(line);
      expect(record.message).toBe("boom");
      expect(record.stack).toContain("Error: boom");
    });
  });

  describe("in development", () => {
    it("writes a readable line naming the application, the level and the message, not JSON", () => {
      const line = renderWithConsoleTransport("development", {
        level: "info",
        message: "HTTP request",
      });

      expect(line).toContain("ProgramCapacity");
      expect(line).toContain("HTTP request");
      expect(() => JSON.parse(line)).toThrow();
    });

    it("shows the metadata of the record", () => {
      const line = renderWithConsoleTransport("development", {
        level: "info",
        message: "HTTP request",
        route: "/api/v1/programs",
        statusCode: 200,
      });

      expect(line).toContain("/api/v1/programs");
      expect(line).toContain("200");
    });
  });
});
