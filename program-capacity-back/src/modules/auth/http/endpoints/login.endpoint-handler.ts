import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Response } from "express";
import { AuthSessionService } from "@/modules/auth/application/services/auth-session.service";
import { AuthErrorMappingUtils } from "@/modules/auth/http/auth-error-mapping.utils";
import { LoginBodyDto } from "@/modules/auth/http/dto/login-body.dto";
import { SessionResponseDto } from "@/modules/auth/http/dto/session-response.dto";
import { SessionResponseDtoMapper } from "@/modules/auth/http/mappers/session-response-dto.mapper";
import { RefreshTokenCookieUtils } from "@/modules/auth/http/refresh-token-cookie.utils";

@Injectable()
export class LoginEndpointHandler {
  constructor(
    private readonly authSessionService: AuthSessionService,
    private readonly config: ConfigService,
  ) {}

  async handle(body: LoginBodyDto, response: Response): Promise<SessionResponseDto> {
    try {
      const session = await this.authSessionService.login(body);
      RefreshTokenCookieUtils.setOnResponse(response, {
        refreshToken: session.refreshToken,
        expiresAt: session.refreshTokenExpiresAt,
        isSecure: this.config.getOrThrow<boolean>("auth.cookieSecure"),
      });
      return SessionResponseDtoMapper.mapFromIssuedSession(session);
    } catch (error) {
      AuthErrorMappingUtils.mapToHttpOrThrow(error);
    }
  }
}
