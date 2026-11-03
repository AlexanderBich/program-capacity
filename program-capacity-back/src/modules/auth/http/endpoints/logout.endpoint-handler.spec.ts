import { HttpException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import express, { Request, Response } from "express";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { RefreshTokenInvalidError } from "@/modules/auth/application/errors/refresh-token-invalid.error";
import { AuthSessionService } from "@/modules/auth/application/services/auth-session.service";
import { LogoutEndpointHandler } from "@/modules/auth/http/endpoints/logout.endpoint-handler";

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

const buildHandler = (params: { isCookieSecure?: boolean; revokeSession?: jest.Mock } = {}) => {
  const revokeSession =
    params.revokeSession ??
    jest.fn(async (token: string) => {
      if (token !== "opaque-token") {
        throw new RefreshTokenInvalidError();
      }
    });
  const handler = new LogoutEndpointHandler(
    { revokeSession } as unknown as AuthSessionService,
    {
      getOrThrow: (key: string) => {
        if (key !== "auth.cookieSecure") {
          throw new Error(`Unexpected config key ${key}`);
        }
        return params.isCookieSecure ?? true;
      },
    } as unknown as ConfigService,
  );
  return { handler, revokeSession };
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

describe("LogoutEndpointHandler", () => {
  it("revokes the session the cookie belongs to and reports success", async () => {
    const { handler } = buildHandler();

    await expect(
      handler.handle(requestWithCookie("opaque-token"), buildResponse()),
    ).resolves.toStrictEqual({
      success: true,
    });
  });

  it("clears the cookie once the session is revoked", async () => {
    const { handler } = buildHandler();
    const response = buildResponse();

    await handler.handle(requestWithCookie("opaque-token"), response);

    expectCookieCleared(response);
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["not a string", { injected: true }],
  ])(
    "answers 401 SESSION_EXPIRED when the cookie is %s, and clears it",
    async (_description, cookie) => {
      const { handler, revokeSession } = buildHandler();
      const response = buildResponse();

      const error = (await rejectionOf(
        handler.handle(requestWithCookie(cookie), response),
      )) as HttpException;

      expect(error).toBeInstanceOf(HttpException);
      expect(error.getStatus()).toBe(401);
      expect(error.getResponse()).toMatchObject({ code: "SESSION_EXPIRED" });
      expect(revokeSession).not.toHaveBeenCalled();
      expectCookieCleared(response);
    },
  );

  it("answers 401 SESSION_EXPIRED for a token the service does not know, and still clears the cookie", async () => {
    const { handler } = buildHandler({
      revokeSession: jest.fn().mockRejectedValue(new RefreshTokenInvalidError()),
    });
    const response = buildResponse();

    const error = (await rejectionOf(
      handler.handle(requestWithCookie("stale-token"), response),
    )) as HttpException;

    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toMatchObject({ code: "SESSION_EXPIRED" });
    expectCookieCleared(response);
  });

  it("lets an unexpected failure rise as it is, and still clears the cookie", async () => {
    const outage = new Error("database is down");
    const { handler } = buildHandler({ revokeSession: jest.fn().mockRejectedValue(outage) });
    const response = buildResponse();

    const error = await rejectionOf(handler.handle(requestWithCookie("opaque-token"), response));

    expect(error).toBe(outage);
    expectCookieCleared(response);
  });

  it("clears the cookie as Secure only when the configuration says so", async () => {
    const secure = buildResponse();
    const plain = buildResponse();

    await buildHandler({ isCookieSecure: true }).handler.handle(
      requestWithCookie("opaque-token"),
      secure,
    );
    await buildHandler({ isCookieSecure: false }).handler.handle(
      requestWithCookie("opaque-token"),
      plain,
    );

    expect(setCookieHeaders(secure)[0]).toContain("; Secure");
    expect(setCookieHeaders(plain)[0]).not.toContain("Secure");
  });
});
