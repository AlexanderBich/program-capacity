import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { RefreshTokenInvalidError } from "@/modules/auth/application/errors/refresh-token-invalid.error";
import { AuthSessionService } from "@/modules/auth/application/services/auth-session.service";
import { AuthErrorMappingUtils } from "@/modules/auth/http/auth-error-mapping.utils";
import { SessionResponseDto } from "@/modules/auth/http/dto/session-response.dto";
import { SessionResponseDtoMapper } from "@/modules/auth/http/mappers/session-response-dto.mapper";
import { RefreshTokenCookieUtils } from "@/modules/auth/http/refresh-token-cookie.utils";

@Injectable()
export class RefreshSessionEndpointHandler {
  constructor(
    private readonly authSessionService: AuthSessionService,
    private readonly config: ConfigService,
  ) {}

  async handle(request: Request, response: Response): Promise<SessionResponseDto> {
    const isSecure = this.config.getOrThrow<boolean>("auth.cookieSecure");
    try {
      const refreshToken = RefreshTokenCookieUtils.readFromRequest(request);
      if (!refreshToken) {
        throw new RefreshTokenInvalidError();
      }
      const session = await this.authSessionService.rotateRefreshToken(refreshToken);
      RefreshTokenCookieUtils.setOnResponse(response, {
        refreshToken: session.refreshToken,
        expiresAt: session.refreshTokenExpiresAt,
        isSecure,
      });
      return SessionResponseDtoMapper.mapFromIssuedSession(session);
    } catch (error) {
      RefreshTokenCookieUtils.clearOnResponse(response, { isSecure });
      AuthErrorMappingUtils.mapToHttpOrThrow(error);
    }
  }
}
