import { QueryFailedError } from "typeorm";

export class PostgresErrorUtils {
  static hasCode(error: unknown, code: string): boolean {
    return this.getCode(error) === code;
  }

  /**
   * SQLSTATE classes 22 (data exception) and 23 (integrity violation): the statement can never succeed
   * as written, so retrying it is pointless. Outages and timeouts fall in other classes.
   */
  static isDataError(error: unknown): boolean {
    const code = this.getCode(error);
    return code !== undefined && (code.startsWith("22") || code.startsWith("23"));
  }

  /**
   * The database could not do the work, whatever the work was: connection (08), resources such as a full
   * disk (53), system errors (58), a shutdown in progress (57P0x), a replica not yet promoted (25006). A
   * statement timeout (57014) is deliberately absent: that one can be the message's own fault.
   */
  static isDatabaseUnavailable(error: unknown): boolean {
    const code = this.getCode(error);
    return (
      code !== undefined &&
      (["08", "53", "58"].includes(code.slice(0, 2)) || code.startsWith("57P") || code === "25006")
    );
  }

  private static getCode(error: unknown): string | undefined {
    return error instanceof QueryFailedError
      ? (error.driverError as { code?: string }).code
      : undefined;
  }
}
