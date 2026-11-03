import { z } from "zod";
import { TreasuryMessageRejectedError } from "@/modules/treasury/application/errors/treasury-message-rejected.error";
import { TreasuryMessageParserUtils } from "@/modules/treasury/application/utils/treasury-message-parser.utils";

const schema = z.object({ programCode: z.string(), sequence: z.number().int() });

const bufferOf = (value: unknown) => Buffer.from(JSON.stringify(value));

const rejectionOf = (value: Buffer | null, parsedSchema: z.ZodType = schema) => {
  try {
    TreasuryMessageParserUtils.parseOrThrow(parsedSchema, value);
  } catch (error) {
    return error;
  }
  throw new Error("expected the message to be rejected");
};

describe("TreasuryMessageParserUtils", () => {
  it("returns the message as the schema reads it", () => {
    expect(
      TreasuryMessageParserUtils.parseOrThrow(
        schema,
        bufferOf({ programCode: "ACME", sequence: 3 }),
      ),
    ).toEqual({ programCode: "ACME", sequence: 3 });
  });

  it("returns what the schema produced, not the raw JSON", () => {
    const parsed = TreasuryMessageParserUtils.parseOrThrow(
      schema,
      bufferOf({ programCode: "ACME", sequence: 3, unexpected: "dropped by the schema" }),
    );

    expect(parsed).toStrictEqual({ programCode: "ACME", sequence: 3 });
  });

  it("reads the value as UTF-8", () => {
    const parsed = TreasuryMessageParserUtils.parseOrThrow(
      z.object({ name: z.string() }),
      Buffer.from('{"name":"Société Générale – 日本"}', "utf8"),
    );

    expect(parsed.name).toBe("Société Générale – 日本");
  });

  it("rejects a message without a value as empty", () => {
    const error = rejectionOf(null);

    expect(error).toBeInstanceOf(TreasuryMessageRejectedError);
    expect((error as Error).message).toBe("Treasury message rejected: empty message");
  });

  it.each([
    ["text that is not JSON", "hello"],
    ["truncated JSON", '{"programCode":"ACME","sequence":'],
    ["JSON with a trailing comma", '{"programCode":"ACME","sequence":3,}'],
  ])("rejects %s as not valid JSON", (_label, text) => {
    const error = rejectionOf(Buffer.from(text));

    expect(error).toBeInstanceOf(TreasuryMessageRejectedError);
    expect((error as Error).message).toBe("Treasury message rejected: not valid JSON");
  });

  it("rejects valid JSON that does not fit the schema and names the offending field", () => {
    const error = rejectionOf(bufferOf({ programCode: "ACME", sequence: "3" }));

    expect(error).toBeInstanceOf(TreasuryMessageRejectedError);
    expect((error as Error).message).toMatch(/^Treasury message rejected: sequence: /);
  });

  it("names a nested field by its whole path", () => {
    const nested = z.object({ payload: z.object({ amount: z.string() }) });

    const error = rejectionOf(bufferOf({ payload: { amount: 12 } }), nested);

    expect((error as Error).message).toMatch(/^Treasury message rejected: payload\.amount: /);
  });

  it("rejects JSON that is not an object at all", () => {
    expect(rejectionOf(bufferOf(["ACME", 3]))).toBeInstanceOf(TreasuryMessageRejectedError);
    expect(rejectionOf(bufferOf(null))).toBeInstanceOf(TreasuryMessageRejectedError);
  });

  it("reports at most five problems, so a hostile message cannot flood a log line", () => {
    const wide = z.object(
      Object.fromEntries(["a", "b", "c", "d", "e", "f", "g"].map((key) => [key, z.string()])),
    );

    const reason = (rejectionOf(bufferOf({}), wide) as Error).message.replace(
      "Treasury message rejected: ",
      "",
    );

    expect(reason.split("; ").map((issue) => issue.split(":")[0])).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });
});
