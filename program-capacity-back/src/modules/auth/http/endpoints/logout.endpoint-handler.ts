import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { SuccessResponseDto } from "@/common/dto/success-response.dto";
import { RefreshTokenInvalidError } from "@/modules/auth/application/errors/refresh-token-invalid.error";
import { AuthSessionService } from "@/modules/auth/application/services/auth-session.service";
import { AuthErrorMappingUtils } from "@/modules/auth/http/auth-error-mapping.utils";
import { RefreshTokenCookieUtils } from "@/modules/auth/http/refresh-token-cookie.utils";

@Injectable()
export class LogoutEndpointHandler {
  constructor(
    private readonly authSessionService: AuthSessionService,
    private readonly config: ConfigService,
  ) {}

  async handle(request: Request, response: Response): Promise<SuccessResponseDto> {
    try {
      const refreshToken = RefreshTokenCookieUtils.readFromRequest(request);
      if (!refreshToken) {
        throw new RefreshTokenInvalidError();
      }
      await this.authSessionService.revokeSession(refreshToken);
      return { success: true };
    } catch (error) {
      AuthErrorMappingUtils.mapToHttpOrThrow(error);
    } finally {
      RefreshTokenCookieUtils.clearOnResponse(response, {
        isSecure: this.config.getOrThrow<boolean>("auth.cookieSecure"),
      });
    }
  }
}
