import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Request, Response } from "express";
import { SuccessResponseDto } from "@/common/dto/success-response.dto";
import { AuthedUser } from "@/modules/auth/auth.types";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { LoginRateLimit } from "@/modules/auth/decorators/login-rate-limit.decorator";
import { SkipJwtAuth } from "@/modules/auth/decorators/skip-jwt-auth.decorator";
import { LoginBodyDto } from "@/modules/auth/http/dto/login-body.dto";
import { SessionResponseDto } from "@/modules/auth/http/dto/session-response.dto";
import { UserResponseDto } from "@/modules/auth/http/dto/user-response.dto";
import { GetCurrentUserEndpointHandler } from "@/modules/auth/http/endpoints/get-current-user.endpoint-handler";
import { LoginEndpointHandler } from "@/modules/auth/http/endpoints/login.endpoint-handler";
import { LogoutEndpointHandler } from "@/modules/auth/http/endpoints/logout.endpoint-handler";
import { RefreshSessionEndpointHandler } from "@/modules/auth/http/endpoints/refresh-session.endpoint-handler";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly loginEndpointHandler: LoginEndpointHandler,
    private readonly refreshSessionEndpointHandler: RefreshSessionEndpointHandler,
    private readonly logoutEndpointHandler: LogoutEndpointHandler,
    private readonly getCurrentUserEndpointHandler: GetCurrentUserEndpointHandler,
  ) {}

  @Post("login")
  @HttpCode(200)
  @SkipJwtAuth()
  @LoginRateLimit()
  @ApiOperation({
    summary: "Authenticate with credentials",
    description: "Returns a short-lived access token and sets the httpOnly refresh cookie.",
  })
  @ApiOkResponse({ type: SessionResponseDto })
  login(
    @Body() body: LoginBodyDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponseDto> {
    return this.loginEndpointHandler.handle(body, response);
  }

  @Post("refresh")
  @HttpCode(200)
  @SkipJwtAuth()
  @ApiCookieAuth()
  @ApiOperation({
    summary: "Rotate the session",
    description: "Authenticated by the refresh cookie. Each refresh token works once.",
  })
  @ApiOkResponse({ type: SessionResponseDto })
  refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionResponseDto> {
    return this.refreshSessionEndpointHandler.handle(request, response);
  }

  @Post("logout")
  @HttpCode(200)
  @SkipJwtAuth()
  @ApiCookieAuth()
  @ApiOperation({
    summary: "Revoke the session",
    description: "Authenticated by the refresh cookie.",
  })
  @ApiOkResponse({ type: SuccessResponseDto })
  logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SuccessResponseDto> {
    return this.logoutEndpointHandler.handle(request, response);
  }

  @Get("me")
  @ApiBearerAuth("JWT")
  @ApiOperation({ summary: "Current user" })
  @ApiOkResponse({ type: UserResponseDto })
  me(@CurrentUser() user: AuthedUser): Promise<UserResponseDto> {
    return this.getCurrentUserEndpointHandler.handle(user.id);
  }
}
