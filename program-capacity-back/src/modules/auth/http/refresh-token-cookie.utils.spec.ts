import express, { Request, Response } from "express";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { RefreshTokenCookieUtils } from "@/modules/auth/http/refresh-token-cookie.utils";

const buildResponse = (): Response => {
  const response = new ServerResponse(new IncomingMessage(new Socket()));
  Object.setPrototypeOf(response, express.response);
  Object.assign(response, { req: {} });
  return response as unknown as Response;
};

const setCookieHeaders = (response: Response): string[] =>
  [response.getHeader("Set-Cookie") ?? []].flat() as string[];

const attributesOf = (setCookie: string): string[] => setCookie.split("; ").slice(1);

describe("RefreshTokenCookieUtils", () => {
  describe("readFromRequest", () => {
    it("returns the refresh token the browser sent", () => {
      const request = { cookies: { refresh_token: "opaque-token" } } as unknown as Request;

      expect(RefreshTokenCookieUtils.readFromRequest(request)).toBe("opaque-token");
    });

    it("returns nothing when the cookie is absent", () => {
      expect(
        RefreshTokenCookieUtils.readFromRequest({ cookies: {} } as unknown as Request),
      ).toBeUndefined();
      expect(
        RefreshTokenCookieUtils.readFromRequest({ cookies: { other: "x" } } as unknown as Request),
      ).toBeUndefined();
    });

    it("returns nothing when cookie parsing never ran", () => {
      expect(RefreshTokenCookieUtils.readFromRequest({} as unknown as Request)).toBeUndefined();
    });

    it("returns nothing for a value cookie-parser turned into an object, because a token is always a string", () => {
      const request = { cookies: { refresh_token: { injected: true } } } as unknown as Request;

      expect(RefreshTokenCookieUtils.readFromRequest(request)).toBeUndefined();
    });
  });

  describe("setOnResponse", () => {
    const expiresAt = new Date("2026-11-08T12:00:00.000Z");

    it("sends the token in a cookie JavaScript cannot read, that is never sent cross-site", () => {
      const response = buildResponse();

      RefreshTokenCookieUtils.setOnResponse(response, {
        refreshToken: "opaque-token",
        expiresAt,
        isSecure: true,
      });

      const [cookie] = setCookieHeaders(response);
      expect(cookie.startsWith("refresh_token=opaque-token;")).toBe(true);
      expect(attributesOf(cookie)).toEqual(expect.arrayContaining(["HttpOnly", "SameSite=Strict"]));
    });

    it("limits the cookie to the auth endpoints", () => {
      const response = buildResponse();

      RefreshTokenCookieUtils.setOnResponse(response, {
        refreshToken: "t",
        expiresAt,
        isSecure: true,
      });

      expect(attributesOf(setCookieHeaders(response)[0])).toContain("Path=/api/v1/auth");
    });

    it("lets the cookie live exactly as long as the refresh token", () => {
      const response = buildResponse();

      RefreshTokenCookieUtils.setOnResponse(response, {
        refreshToken: "t",
        expiresAt,
        isSecure: true,
      });

      expect(attributesOf(setCookieHeaders(response)[0])).toContain(
        "Expires=Sun, 08 Nov 2026 12:00:00 GMT",
      );
    });

    it("marks the cookie Secure when the configuration says the API is served over HTTPS", () => {
      const response = buildResponse();

      RefreshTokenCookieUtils.setOnResponse(response, {
        refreshToken: "t",
        expiresAt,
        isSecure: true,
      });

      expect(attributesOf(setCookieHeaders(response)[0])).toContain("Secure");
    });

    it("leaves the cookie without Secure on a plain-HTTP development setup", () => {
      const response = buildResponse();

      RefreshTokenCookieUtils.setOnResponse(response, {
        refreshToken: "t",
        expiresAt,
        isSecure: false,
      });

      expect(attributesOf(setCookieHeaders(response)[0])).not.toContain("Secure");
    });
  });

  describe("clearOnResponse", () => {
    it("expires the cookie on the same path and with the same protections, so the browser drops it", () => {
      const response = buildResponse();

      RefreshTokenCookieUtils.clearOnResponse(response, { isSecure: true });

      const [cookie] = setCookieHeaders(response);
      expect(cookie.startsWith("refresh_token=;")).toBe(true);
      expect(attributesOf(cookie)).toEqual(
        expect.arrayContaining([
          "Path=/api/v1/auth",
          "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
          "HttpOnly",
          "Secure",
          "SameSite=Strict",
        ]),
      );
    });

    it("does not add Secure when the cookie was not Secure to begin with", () => {
      const response = buildResponse();

      RefreshTokenCookieUtils.clearOnResponse(response, { isSecure: false });

      expect(attributesOf(setCookieHeaders(response)[0])).not.toContain("Secure");
    });
  });
});
