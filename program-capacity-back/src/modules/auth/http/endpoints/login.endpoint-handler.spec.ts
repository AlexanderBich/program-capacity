import { HttpException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import express, { Response } from "express";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { UserRole } from "@/modules/auth/auth.enums";
import { IssuedSession } from "@/modules/auth/auth.types";
import { InvalidCredentialsError } from "@/modules/auth/application/errors/invalid-credentials.error";
import { AuthSessionService } from "@/modules/auth/application/services/auth-session.service";
import { UserEntity } from "@/modules/auth/entities/user.entity";
import { LoginEndpointHandler } from "@/modules/auth/http/endpoints/login.endpoint-handler";

const buildResponse = (): Response => {
  const response = new ServerResponse(new IncomingMessage(new Socket()));
  Object.setPrototypeOf(response, express.response);
  Object.assign(response, { req: {} });
  return response as unknown as Response;
};

const setCookieHeaders = (response: Response): string[] =>
  [response.getHeader("Set-Cookie") ?? []].flat() as string[];

const session: IssuedSession = {
  user: {
    id: "7b0a3f1e-3d1c-4a52-9e37-0a1f1f4c9a11",
    email: "operator@capacity.local",
    passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
    role: UserRole.OPERATOR,
    isActive: true,
  } as UserEntity,
  accessToken: "header.payload.signature",
  accessTokenExpiresAt: new Date("2026-11-01T12:15:00.000Z"),
  refreshToken: "opaque-refresh-token",
  refreshTokenExpiresAt: new Date("2026-11-08T12:00:00.000Z"),
};

const buildHandler = (params: { isCookieSecure?: boolean; login?: jest.Mock } = {}) => {
  const login =
    params.login ??
    jest.fn(async ({ email, password }: { email: string; password: string }) => {
      if (email === "operator@capacity.local" && password === "right-password") {
        return session;
      }
      throw new InvalidCredentialsError();
    });
  const handler = new LoginEndpointHandler(
    { login } as unknown as AuthSessionService,
    {
      getOrThrow: (key: string) => {
        if (key !== "auth.cookieSecure") {
          throw new Error(`Unexpected config key ${key}`);
        }
        return params.isCookieSecure ?? true;
      },
    } as unknown as ConfigService,
  );
  return { handler, login };
};

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject");
};

describe("LoginEndpointHandler", () => {
  const credentials = { email: "operator@capacity.local", password: "right-password" };

  it("returns the access token and the user for the credentials it was given", async () => {
    const { handler } = buildHandler();

    const body = await handler.handle(credentials, buildResponse());

    expect(body).toStrictEqual({
      accessToken: "header.payload.signature",
      accessTokenExpiresAt: "2026-11-01T12:15:00.000Z",
      user: {
        id: "7b0a3f1e-3d1c-4a52-9e37-0a1f1f4c9a11",
        email: "operator@capacity.local",
        role: UserRole.OPERATOR,
      },
    });
  });

  it("sets the refresh token in a cookie for the session's lifetime, and keeps it out of the body", async () => {
    const { handler } = buildHandler();
    const response = buildResponse();

    const body = await handler.handle(credentials, response);

    const [cookie] = setCookieHeaders(response);
    expect(cookie).toContain("refresh_token=opaque-refresh-token;");
    expect(cookie).toContain("Expires=Sun, 08 Nov 2026 12:00:00 GMT");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(JSON.stringify(body)).not.toContain("opaque-refresh-token");
  });

  it("marks the cookie Secure only when the configuration says so", async () => {
    const secure = buildResponse();
    const plain = buildResponse();

    await buildHandler({ isCookieSecure: true }).handler.handle(credentials, secure);
    await buildHandler({ isCookieSecure: false }).handler.handle(credentials, plain);

    expect(setCookieHeaders(secure)[0]).toContain("; Secure");
    expect(setCookieHeaders(plain)[0]).not.toContain("Secure");
  });

  it("answers wrong credentials with 401 INVALID_CREDENTIALS and sets no cookie", async () => {
    const { handler } = buildHandler();
    const response = buildResponse();

    const error = (await rejectionOf(
      handler.handle({ ...credentials, password: "wrong-password" }, response),
    )) as HttpException;

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(setCookieHeaders(response)).toEqual([]);
  });

  it("lets an unexpected failure rise as it is, without a cookie", async () => {
    const outage = new Error("database is down");
    const { handler } = buildHandler({ login: jest.fn().mockRejectedValue(outage) });
    const response = buildResponse();

    const error = await rejectionOf(handler.handle(credentials, response));

    expect(error).toBe(outage);
    expect(setCookieHeaders(response)).toEqual([]);
  });
});
