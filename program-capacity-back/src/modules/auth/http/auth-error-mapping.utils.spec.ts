import { HttpException } from "@nestjs/common";
import { InvalidCredentialsError } from "@/modules/auth/application/errors/invalid-credentials.error";
import { RefreshTokenInvalidError } from "@/modules/auth/application/errors/refresh-token-invalid.error";
import { UserNotFoundError } from "@/modules/auth/application/errors/user-not-found.error";
import { AuthErrorMappingUtils } from "@/modules/auth/http/auth-error-mapping.utils";

const thrownBy = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the action to throw");
};

describe("AuthErrorMappingUtils", () => {
  describe("mapToHttpOrThrow", () => {
    it("answers bad credentials with 401 INVALID_CREDENTIALS", () => {
      const error = thrownBy(() =>
        AuthErrorMappingUtils.mapToHttpOrThrow(new InvalidCredentialsError()),
      ) as HttpException;

      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(401);
      expect(error.getResponse()).toStrictEqual({
        statusCode: 401,
        code: "INVALID_CREDENTIALS",
        message: "Invalid email or password",
      });
    });

    it("answers a missing, expired or revoked refresh token with 401 SESSION_EXPIRED", () => {
      const error = thrownBy(() =>
        AuthErrorMappingUtils.mapToHttpOrThrow(new RefreshTokenInvalidError()),
      ) as HttpException;

      expect(error.getStatus()).toBe(401);
      expect(error.getResponse()).toStrictEqual({
        statusCode: 401,
        code: "SESSION_EXPIRED",
        message: "Session has expired, sign in again",
      });
    });

    it("answers a user who no longer exists with 401 UNAUTHENTICATED, without naming the user", () => {
      const error = thrownBy(() =>
        AuthErrorMappingUtils.mapToHttpOrThrow(new UserNotFoundError("user-42")),
      ) as HttpException;

      expect(error.getStatus()).toBe(401);
      expect(error.getResponse()).toStrictEqual({
        statusCode: 401,
        code: "UNAUTHENTICATED",
        message: "User no longer exists",
      });
    });

    it("lets an error it does not know rise unchanged", () => {
      const unexpected = new Error("database is down");

      expect(thrownBy(() => AuthErrorMappingUtils.mapToHttpOrThrow(unexpected))).toBe(unexpected);
    });
  });
});
