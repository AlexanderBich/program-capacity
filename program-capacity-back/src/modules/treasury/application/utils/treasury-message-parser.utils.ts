import { z } from "zod";
import { TreasuryMessageRejectedError } from "@/modules/treasury/application/errors/treasury-message-rejected.error";

export class TreasuryMessageParserUtils {
  static parseOrThrow<Schema extends z.ZodType>(
    schema: Schema,
    value: Buffer | null,
  ): z.infer<Schema> {
    if (!value) {
      throw new TreasuryMessageRejectedError("empty message");
    }

    let json: unknown;
    try {
      json = JSON.parse(value.toString("utf8"));
    } catch {
      throw new TreasuryMessageRejectedError("not valid JSON");
    }

    const result = schema.safeParse(json);
    if (!result.success) {
      throw new TreasuryMessageRejectedError(
        result.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      );
    }
    return result.data;
  }
}
