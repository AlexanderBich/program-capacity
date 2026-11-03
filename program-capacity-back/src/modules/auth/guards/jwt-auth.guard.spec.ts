import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { requestMetadataContext } from "@/common/contexts/request-metadata.context";
import { UserRole } from "@/modules/auth/auth.enums";
import { AccessTokenClaims, AuthenticatedRequest } from "@/modules/auth/auth.types";
import { SkipJwtAuth } from "@/modules/auth/decorators/skip-jwt-auth.decorator";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";

class ProtectedController {
  @SkipJwtAuth()
  openHandler() {}

  protectedHandler() {}
}

@SkipJwtAuth()
class OpenController {
  anyHandler() {}
}

const SECRET = "unit-test-secret-unit-test-secret-0123";
const claims = { sub: "user-1", email: "operator@capacity.local", role: UserRole.OPERATOR };

const buildContext = (
  target: { handler: () => void; cls: new () => unknown },
  request: Partial<AuthenticatedRequest>,
) =>
  ({
    getHandler: () => target.handler,
    getClass: () => target.cls,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const protectedTarget = {
  handler: ProtectedController.prototype.protectedHandler,
  cls: ProtectedController,
};

const requestWith = (authorization?: string) =>
  ({ headers: authorization === undefined ? {} : { authorization } }) as AuthenticatedRequest;

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject");
};

describe("JwtAuthGuard", () => {
  const jwtService = new JwtService({
    secret: SECRET,
    signOptions: { expiresIn: 900 },
    verifyOptions: { algorithms: ["HS256"] },
  });
  const guard = new JwtAuthGuard(jwtService, new Reflector());

  describe("a route that opts out of JWT authentication", () => {
    it("lets the call through on a handler marked to skip, without looking at credentials", async () => {
      const request = requestWith("Bearer not-even-a-token");

      const allowed = await guard.canActivate(
        buildContext(
          { handler: ProtectedController.prototype.openHandler, cls: ProtectedController },
          request,
        ),
      );

      expect(allowed).toBe(true);
      expect(request.user).toBeUndefined();
    });

    it("lets the call through on a class marked to skip, for every handler in it", async () => {
      const request = requestWith();

      const allowed = await guard.canActivate(
        buildContext(
          { handler: OpenController.prototype.anyHandler, cls: OpenController },
          request,
        ),
      );

      expect(allowed).toBe(true);
      expect(request.user).toBeUndefined();
    });
  });

  describe("a protected route", () => {
    it("admits a call with a valid access token and says who is calling", async () => {
      const token = await jwtService.signAsync(claims);
      const { exp } = jwtService.decode<AccessTokenClaims>(token);
      const request = requestWith(`Bearer ${token}`);

      const allowed = await guard.canActivate(buildContext(protectedTarget, request));

      expect(allowed).toBe(true);
      expect(request.user).toStrictEqual({
        id: "user-1",
        email: "operator@capacity.local",
        role: UserRole.OPERATOR,
        accessTokenExpiresAt: new Date(exp * 1000),
      });
    });

    it.each([
      ["no Authorization header", async () => undefined],
      ["an empty Authorization header", async () => ""],
      ["a scheme with no token", async () => "Bearer"],
      ["a scheme followed by an empty token", async () => "Bearer "],
      ["another scheme", async () => "Basic dXNlcjpwYXNz"],
      [
        "a valid token under another scheme",
        async () => `Token ${await jwtService.signAsync(claims)}`,
      ],
      ["something that is not a token", async () => "Bearer not-a-token"],
      [
        "an expired token",
        async () => `Bearer ${await jwtService.signAsync(claims, { expiresIn: -10 })}`,
      ],
      [
        "a token signed with another secret",
        async () =>
          `Bearer ${new JwtService({ secret: "another-secret-another-secret-0123456" }).sign(claims)}`,
      ],
      [
        "a token whose payload was altered after signing",
        async () => {
          const [header, , signature] = (await jwtService.signAsync(claims)).split(".");
          const payload = Buffer.from(
            JSON.stringify({ ...claims, role: UserRole.ADMIN, exp: 4102444800 }),
          ).toString("base64url");
          return `Bearer ${header}.${payload}.${signature}`;
        },
      ],
    ])(
      "rejects %s with 401 UNAUTHENTICATED and names no one",
      async (_description, authorizationOf) => {
        const request = requestWith(await authorizationOf());

        const error = (await rejectionOf(
          guard.canActivate(buildContext(protectedTarget, request)),
        )) as UnauthorizedException;

        expect(error).toBeInstanceOf(UnauthorizedException);
        expect(error.getStatus()).toBe(401);
        expect(error.getResponse()).toStrictEqual({
          statusCode: 401,
          code: "UNAUTHENTICATED",
          message: "A valid access token is required",
        });
        expect(request.user).toBeUndefined();
      },
    );

    it("records the caller in the request context, so every log line of the request names them", async () => {
      const token = await jwtService.signAsync(claims);
      const store = new Map<string, string>([["requestId", "req-12345678"]]);

      await requestMetadataContext.run(store, () =>
        guard.canActivate(buildContext(protectedTarget, requestWith(`Bearer ${token}`))),
      );

      expect(store.get("userId")).toBe("user-1");
      expect(store.get("requestId")).toBe("req-12345678");
    });

    it("records no caller when the token is rejected", async () => {
      const store = new Map<string, string>();

      await requestMetadataContext.run(store, () =>
        rejectionOf(guard.canActivate(buildContext(protectedTarget, requestWith("Bearer nope")))),
      );

      expect(store.has("userId")).toBe(false);
    });

    it("works outside a request context, where there is nowhere to record the caller", async () => {
      const token = await jwtService.signAsync(claims);

      const allowed = await guard.canActivate(
        buildContext(protectedTarget, requestWith(`Bearer ${token}`)),
      );

      expect(allowed).toBe(true);
    });
  });
});
