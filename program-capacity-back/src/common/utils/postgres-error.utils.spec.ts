import { QueryFailedError } from "typeorm";
import { PostgresErrorUtils } from "@/common/utils/postgres-error.utils";

const failedQuery = (code?: string) =>
  new QueryFailedError("UPDATE programs", [], Object.assign(new Error("failed"), { code }));

describe("PostgresErrorUtils", () => {
  describe("isDatabaseUnavailable", () => {
    it.each(["08006", "53100", "53300", "58030", "57P01", "57P03", "25006"])(
      "treats %s as the database being unable to do any work",
      (code) => {
        expect(PostgresErrorUtils.isDatabaseUnavailable(failedQuery(code))).toBe(true);
      },
    );

    it.each(["23505", "22003", "55P03", "57014", "40001"])(
      "does not blame the database for %s",
      (code) => {
        expect(PostgresErrorUtils.isDatabaseUnavailable(failedQuery(code))).toBe(false);
      },
    );

    it("knows nothing about what did not come from a failed query", () => {
      expect(PostgresErrorUtils.isDatabaseUnavailable(failedQuery(undefined))).toBe(false);
      expect(PostgresErrorUtils.isDatabaseUnavailable(new Error("connection refused"))).toBe(false);
    });
  });

  describe("hasCode", () => {
    it("recognises the SQLSTATE a failed query carries", () => {
      expect(PostgresErrorUtils.hasCode(failedQuery("23505"), "23505")).toBe(true);
    });

    it("tells one SQLSTATE from another", () => {
      expect(PostgresErrorUtils.hasCode(failedQuery("55P03"), "23505")).toBe(false);
    });

    it("does not match a query failure that carries no SQLSTATE", () => {
      expect(PostgresErrorUtils.hasCode(failedQuery(undefined), "23505")).toBe(false);
    });

    it("ignores errors that did not come from a failed query, even with a matching code property", () => {
      expect(
        PostgresErrorUtils.hasCode(Object.assign(new Error("x"), { code: "23505" }), "23505"),
      ).toBe(false);
      expect(PostgresErrorUtils.hasCode({ code: "23505" }, "23505")).toBe(false);
      expect(PostgresErrorUtils.hasCode(null, "23505")).toBe(false);
      expect(PostgresErrorUtils.hasCode("23505", "23505")).toBe(false);
    });
  });

  describe("isDataError", () => {
    it.each([
      ["22003", "numeric value out of range"],
      ["22P02", "invalid text representation"],
      ["22021", "invalid byte sequence"],
      ["23502", "not null violation"],
      ["23503", "foreign key violation"],
      ["23505", "unique violation"],
      ["23514", "check violation"],
    ])("treats %s (%s) as a statement that can never succeed", (code) => {
      expect(PostgresErrorUtils.isDataError(failedQuery(code))).toBe(true);
    });

    it.each([
      ["08006", "connection failure"],
      ["40001", "serialization failure"],
      ["40P01", "deadlock detected"],
      ["42P01", "undefined table"],
      ["53300", "too many connections"],
      ["55P03", "lock not available"],
      ["57014", "query cancelled by a timeout"],
      ["57P01", "admin shutdown"],
    ])("treats %s (%s) as worth retrying", (code) => {
      expect(PostgresErrorUtils.isDataError(failedQuery(code))).toBe(false);
    });

    it("does not call a query failure without a SQLSTATE a data error", () => {
      expect(PostgresErrorUtils.isDataError(failedQuery(undefined))).toBe(false);
    });

    it("does not call anything that is not a failed query a data error", () => {
      expect(PostgresErrorUtils.isDataError(new Error("connection terminated"))).toBe(false);
      expect(PostgresErrorUtils.isDataError(Object.assign(new Error("x"), { code: "23505" }))).toBe(
        false,
      );
      expect(PostgresErrorUtils.isDataError(undefined)).toBe(false);
    });
  });
});
