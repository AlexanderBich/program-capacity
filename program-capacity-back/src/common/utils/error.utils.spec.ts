import { HttpException } from "@nestjs/common";
import { ApplicationError } from "@/common/base/application.error";
import { ErrorUtils } from "@/common/utils/error.utils";

class OutOfStockError extends ApplicationError {}
class OutOfTimeError extends ApplicationError {}
class OutOfLuckError extends OutOfStockError {}

const thrownBy = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the action to throw");
};

describe("ErrorUtils", () => {
  describe("mapErrorsToHttpOrThrow", () => {
    it("turns a mapped error into an HttpException with the entry's status, code and message", () => {
      const error = thrownBy(() =>
        ErrorUtils.mapErrorsToHttpOrThrow(new OutOfStockError("no stock for SKU-1"), [
          [OutOfStockError, { status: 409, code: "OUT_OF_STOCK", message: "Not enough stock" }],
        ]),
      ) as HttpException;

      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(409);
      expect(error.getResponse()).toEqual({
        statusCode: 409,
        code: "OUT_OF_STOCK",
        message: "Not enough stock",
      });
    });

    it("keeps the error's own message and metadata out of the response unless the entry opts in", () => {
      const error = thrownBy(() =>
        ErrorUtils.mapErrorsToHttpOrThrow(
          new OutOfStockError("internal detail", { sku: "SKU-1" }),
          [[OutOfStockError, { status: 409, code: "OUT_OF_STOCK", message: "Not enough stock" }]],
        ),
      ) as HttpException;

      const body = error.getResponse() as Record<string, unknown>;
      expect(body).not.toHaveProperty("details");
      expect(JSON.stringify(body)).not.toContain("internal detail");
      expect(JSON.stringify(body)).not.toContain("SKU-1");
    });

    it("forwards the error's metadata as details when the entry opts in", () => {
      const error = thrownBy(() =>
        ErrorUtils.mapErrorsToHttpOrThrow(
          new OutOfStockError("x", { sku: "SKU-1", requested: "5" }),
          [
            [
              OutOfStockError,
              {
                status: 409,
                code: "OUT_OF_STOCK",
                message: "Not enough stock",
                exposeMetadata: true,
              },
            ],
          ],
        ),
      ) as HttpException;

      expect(error.getResponse()).toEqual({
        statusCode: 409,
        code: "OUT_OF_STOCK",
        message: "Not enough stock",
        details: { sku: "SKU-1", requested: "5" },
      });
    });

    it("never invents details for an error that is not an ApplicationError", () => {
      const error = thrownBy(() =>
        ErrorUtils.mapErrorsToHttpOrThrow(new TypeError("boom"), [
          [TypeError, { status: 500, code: "BROKEN", message: "Broken", exposeMetadata: true }],
        ]),
      ) as HttpException;

      expect(error.getResponse()).toStrictEqual({
        statusCode: 500,
        code: "BROKEN",
        message: "Broken",
      });
    });

    it("maps every class listed in one entry the same way", () => {
      const mappings = [
        [
          OutOfStockError,
          OutOfTimeError,
          { status: 422, code: "UNPROCESSABLE", message: "Cannot do that" },
        ],
      ] as Parameters<typeof ErrorUtils.mapErrorsToHttpOrThrow>[1];

      for (const error of [new OutOfStockError("a"), new OutOfTimeError("b")]) {
        const mapped = thrownBy(() =>
          ErrorUtils.mapErrorsToHttpOrThrow(error, mappings),
        ) as HttpException;
        expect(mapped.getStatus()).toBe(422);
        expect(mapped.getResponse()).toMatchObject({ code: "UNPROCESSABLE" });
      }
    });

    it("uses the first entry that matches, so a specific entry must come before a general one", () => {
      const specificFirst = thrownBy(() =>
        ErrorUtils.mapErrorsToHttpOrThrow(new OutOfLuckError("x"), [
          [OutOfLuckError, { status: 418, code: "SPECIFIC", message: "Specific" }],
          [OutOfStockError, { status: 409, code: "GENERAL", message: "General" }],
        ]),
      ) as HttpException;
      const generalFirst = thrownBy(() =>
        ErrorUtils.mapErrorsToHttpOrThrow(new OutOfLuckError("x"), [
          [OutOfStockError, { status: 409, code: "GENERAL", message: "General" }],
          [OutOfLuckError, { status: 418, code: "SPECIFIC", message: "Specific" }],
        ]),
      ) as HttpException;

      expect(specificFirst.getResponse()).toMatchObject({ code: "SPECIFIC" });
      expect(generalFirst.getResponse()).toMatchObject({ code: "GENERAL" });
    });

    it("rethrows an error no entry matches, as the very same object", () => {
      const unexpected = new RangeError("not mine");

      const error = thrownBy(() =>
        ErrorUtils.mapErrorsToHttpOrThrow(unexpected, [
          [OutOfStockError, { status: 409, code: "OUT_OF_STOCK", message: "Not enough stock" }],
        ]),
      );

      expect(error).toBe(unexpected);
    });

    it("rethrows a thrown value that is not an Error, untouched", () => {
      const error = thrownBy(() =>
        ErrorUtils.mapErrorsToHttpOrThrow("a thrown string", [
          [OutOfStockError, { status: 409, code: "OUT_OF_STOCK", message: "Not enough stock" }],
        ]),
      );

      expect(error).toBe("a thrown string");
    });

    it("rethrows everything when there are no entries", () => {
      const unexpected = new OutOfStockError("x");

      expect(thrownBy(() => ErrorUtils.mapErrorsToHttpOrThrow(unexpected, []))).toBe(unexpected);
    });
  });
});
