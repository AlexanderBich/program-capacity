import { HttpException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import express, { Request, Response } from "express";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { UserRole } from "@/modules/auth/auth.enums";
import { IssuedSession } from "@/modules/auth/auth.types";
import { RefreshTokenInvalidError } from "@/modules/auth/application/errors/refresh-token-invalid.error";
import { AuthSessionService } from "@/modules/auth/application/services/auth-session.service";
import { UserEntity } from "@/modules/auth/entities/user.entity";
import { RefreshSessionEndpointHandler } from "@/modules/auth/http/endpoints/refresh-session.endpoint-handler";

const buildResponse = (): Response => {
  const response = new ServerResponse(new IncomingMessage(new Socket()));
  Object.setPrototypeOf(response, express.response);
  Object.assign(response, { req: {} });
  return response as unknown as Response;
};

const setCookieHeaders = (response: Response): string[] =>
  [response.getHeader("Set-Cookie") ?? []].flat() as string[];

const requestWithCookie = (value: unknown): Request =>
  ({ cookies: value === undefined ? {} : { refresh_token: value } }) as unknown as Request;

const rotated: IssuedSession = {
  user: {
    id: "7b0a3f1e-3d1c-4a52-9e37-0a1f1f4c9a11",
    email: "viewer@capacity.local",
    passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
    role: UserRole.VIEWER,
    isActive: true,
  } as UserEntity,
  accessToken: "new.access.token",
  accessTokenExpiresAt: new Date("2026-11-01T12:30:00.000Z"),
  refreshToken: "new-refresh-token",
  refreshTokenExpiresAt: new Date("2026-11-08T12:15:00.000Z"),
};

const buildHandler = (
  params: { isCookieSecure?: boolean; rotateRefreshToken?: jest.Mock } = {},
) => {
  const rotateRefreshToken =
    params.rotateRefreshToken ??
    jest.fn(async (token: string) => {
      if (token !== "current-token") {
        throw new RefreshTokenInvalidError();
      }
      return rotated;
    });
  const handler = new RefreshSessionEndpointHandler(
    { rotateRefreshToken } as unknown as AuthSessionService,
    {
      getOrThrow: (key: string) => {
        if (key !== "auth.cookieSecure") {
          throw new Error(`Unexpected config key ${key}`);
        }
        return params.isCookieSecure ?? true;
      },
    } as unknown as ConfigService,
  );
  return { handler, rotateRefreshToken };
};

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject");
};

const expectCookieCleared = (response: Response) => {
  const [cookie] = setCookieHeaders(response);
  expect(cookie).toContain("refresh_token=;");
  expect(cookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  expect(cookie).toContain("Path=/api/v1/auth");
};

describe("RefreshSessionEndpointHandler", () => {
  it("returns a new access token and the user for the session the cookie belongs to", async () => {
    const { handler } = buildHandler();

    const body = await handler.handle(requestWithCookie("current-token"), buildResponse());

    expect(body).toStrictEqual({
      accessToken: "new.access.token",
      accessTokenExpiresAt: "2026-11-01T12:30:00.000Z",
      user: {
        id: "7b0a3f1e-3d1c-4a52-9e37-0a1f1f4c9a11",
        email: "viewer@capacity.local",
        role: UserRole.VIEWER,
      },
    });
  });

  it("replaces the cookie with the new refresh token, and keeps it out of the body", async () => {
    const { handler } = buildHandler();
    const response = buildResponse();

    const body = await handler.handle(requestWithCookie("current-token"), response);

    const cookies = setCookieHeaders(response);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain("refresh_token=new-refresh-token;");
    expect(cookies[0]).toContain("Expires=Sun, 08 Nov 2026 12:15:00 GMT");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toContain("SameSite=Strict");
    expect(cookies[0]).toContain("Path=/api/v1/auth");
    expect(JSON.stringify(body)).not.toContain("new-refresh-token");
  });

  it("marks the new cookie Secure only when the configuration says so", async () => {
    const secure = buildResponse();
    const plain = buildResponse();

    await buildHandler({ isCookieSecure: true }).handler.handle(
      requestWithCookie("current-token"),
      secure,
    );
    await buildHandler({ isCookieSecure: false }).handler.handle(
      requestWithCookie("current-token"),
      plain,
    );

    expect(setCookieHeaders(secure)[0]).toContain("; Secure");
    expect(setCookieHeaders(plain)[0]).not.toContain("Secure");
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["not a string", { injected: true }],
  ])(
    "answers 401 SESSION_EXPIRED when the cookie is %s, and clears it",
    async (_description, cookie) => {
      const { handler, rotateRefreshToken } = buildHandler();
      const response = buildResponse();

      const error = (await rejectionOf(
        handler.handle(requestWithCookie(cookie), response),
      )) as HttpException;

      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(401);
      expect(error.getResponse()).toMatchObject({ code: "SESSION_EXPIRED" });
      expect(rotateRefreshToken).not.toHaveBeenCalled();
      expectCookieCleared(response);
    },
  );

  it("answers 401 SESSION_EXPIRED for a token that is expired, revoked or unknown, and clears the dead cookie", async () => {
    const { handler } = buildHandler();
    const response = buildResponse();

    const error = (await rejectionOf(
      handler.handle(requestWithCookie("stale-token"), response),
    )) as HttpException;

    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toStrictEqual({
      statusCode: 401,
      code: "SESSION_EXPIRED",
      message: "Session has expired, sign in again",
    });
    expectCookieCleared(response);
  });

  it("lets an unexpected failure rise as it is, and clears the cookie rather than keeping a possibly dead token", async () => {
    const outage = new Error("database is down");
    const { handler } = buildHandler({ rotateRefreshToken: jest.fn().mockRejectedValue(outage) });
    const response = buildResponse();

    const error = await rejectionOf(handler.handle(requestWithCookie("current-token"), response));

    expect(error).toBe(outage);
    expectCookieCleared(response);
  });

  it("clears the cookie as Secure only when the configuration says so", async () => {
    const secure = buildResponse();
    const plain = buildResponse();

    await rejectionOf(
      buildHandler({ isCookieSecure: true }).handler.handle(requestWithCookie("x"), secure),
    );
    await rejectionOf(
      buildHandler({ isCookieSecure: false }).handler.handle(requestWithCookie("x"), plain),
    );

    expect(setCookieHeaders(secure)[0]).toContain("; Secure");
    expect(setCookieHeaders(plain)[0]).not.toContain("Secure");
  });
});
