import { createHash, randomBytes } from "crypto";

export class RefreshTokenUtils {
  static generateToken(): string {
    return randomBytes(32).toString("base64url");
  }

  static hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
