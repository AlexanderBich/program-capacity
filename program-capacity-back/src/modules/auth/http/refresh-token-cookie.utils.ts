import { Request, Response } from "express";
import {
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_PATH,
} from "@/modules/auth/auth.constants";

export class RefreshTokenCookieUtils {
  static readFromRequest(request: Request): string | undefined {
    // cookie-parser turns a value starting with "j:" into an object, and a token can only be a string.
    const value: unknown = request.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
    return typeof value === "string" ? value : undefined;
  }

  static setOnResponse(
    response: Response,
    params: { refreshToken: string; expiresAt: Date; isSecure: boolean },
  ): void {
    response.cookie(REFRESH_TOKEN_COOKIE_NAME, params.refreshToken, {
      httpOnly: true,
      secure: params.isSecure,
      sameSite: "strict",
      path: REFRESH_TOKEN_COOKIE_PATH,
      expires: params.expiresAt,
    });
  }

  static clearOnResponse(response: Response, params: { isSecure: boolean }): void {
    response.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
      httpOnly: true,
      secure: params.isSecure,
      sameSite: "strict",
      path: REFRESH_TOKEN_COOKIE_PATH,
    });
  }
}
