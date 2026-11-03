import { ErrorUtils } from "@/common/utils/error.utils";
import { InvalidCredentialsError } from "@/modules/auth/application/errors/invalid-credentials.error";
import { RefreshTokenInvalidError } from "@/modules/auth/application/errors/refresh-token-invalid.error";
import { UserNotFoundError } from "@/modules/auth/application/errors/user-not-found.error";

export class AuthErrorMappingUtils {
  static mapToHttpOrThrow(error: unknown): never {
    ErrorUtils.mapErrorsToHttpOrThrow(error, [
      [
        InvalidCredentialsError,
        { status: 401, code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
      ],
      [
        RefreshTokenInvalidError,
        { status: 401, code: "SESSION_EXPIRED", message: "Session has expired, sign in again" },
      ],
      [
        UserNotFoundError,
        { status: 401, code: "UNAUTHENTICATED", message: "User no longer exists" },
      ],
    ]);
  }
}
