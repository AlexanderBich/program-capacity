import { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import {
  ThrottlerException,
  ThrottlerGuard,
  ThrottlerOptions,
  ThrottlerStorageService,
} from "@nestjs/throttler";
import { authThrottlerConfigFactory } from "@/modules/auth/auth-throttler.config-factory";
import {
  API_THROTTLER_NAME,
  LOGIN_ACCOUNT_THROTTLER_NAME,
  LOGIN_IP_THROTTLER_NAME,
} from "@/modules/auth/auth.constants";
import { LoginRateLimit } from "@/modules/auth/decorators/login-rate-limit.decorator";
import { SkipRateLimit } from "@/modules/auth/decorators/skip-rate-limit.decorator";

class SampleController {
  @LoginRateLimit()
  login() {}

  @SkipRateLimit()
  probe() {}

  list() {}
}

type Limits = { api: number; loginIp: number; loginAccount: number };

const buildOptions = (limits: Limits) => {
  const values: Record<string, number> = {
    "server.rateLimitPerMinute": limits.api,
    "auth.rateLimitPerMinute": limits.loginIp,
    "auth.accountRateLimitPerMinute": limits.loginAccount,
  };
  return authThrottlerConfigFactory({
    getOrThrow: (key: string) => {
      if (!(key in values)) {
        throw new Error(`Unexpected config key ${key}`);
      }
      return values[key];
    },
  } as unknown as ConfigService) as { errorMessage: string; throttlers: ThrottlerOptions[] };
};

const throttlerNamed = (limits: Limits, name: string): ThrottlerOptions => {
  const throttler = buildOptions(limits).throttlers.find((candidate) => candidate.name === name);
  if (!throttler) {
    throw new Error(`No throttler named ${name}`);
  }
  return throttler;
};

const buildContext = (handler: () => void, request: Record<string, unknown>) =>
  ({
    getHandler: () => handler,
    getClass: () => SampleController,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ header: jest.fn() }),
    }),
  }) as unknown as ExecutionContext;

const login = SampleController.prototype.login;
const list = SampleController.prototype.list;

describe("authThrottlerConfigFactory", () => {
  const limits: Limits = { api: 600, loginIp: 20, loginAccount: 10 };

  it("limits the API, the login per IP and the login per account, each by its own setting", () => {
    const { throttlers } = buildOptions(limits);

    expect(throttlers.map(({ name, limit, ttl }) => ({ name, limit, ttl }))).toEqual([
      { name: API_THROTTLER_NAME, limit: 600, ttl: 60_000 },
      { name: LOGIN_IP_THROTTLER_NAME, limit: 20, ttl: 60_000 },
      { name: LOGIN_ACCOUNT_THROTTLER_NAME, limit: 10, ttl: 60_000 },
    ]);
  });

  it("tells a limited caller to try again in a minute", () => {
    expect(buildOptions(limits).errorMessage).toBe("Too many requests, try again in a minute");
  });

  describe("the login throttlers' skip condition", () => {
    it.each([LOGIN_IP_THROTTLER_NAME, LOGIN_ACCOUNT_THROTTLER_NAME])(
      "keeps %s on for a route marked as a login route",
      (name) => {
        expect(throttlerNamed(limits, name).skipIf?.(buildContext(login, {}))).toBe(false);
      },
    );

    it.each([LOGIN_IP_THROTTLER_NAME, LOGIN_ACCOUNT_THROTTLER_NAME])(
      "switches %s off for every other route",
      (name) => {
        expect(throttlerNamed(limits, name).skipIf?.(buildContext(list, {}))).toBe(true);
        expect(
          throttlerNamed(limits, name).skipIf?.(buildContext(SampleController.prototype.probe, {})),
        ).toBe(true);
      },
    );
  });

  describe("the API throttler's tracker", () => {
    const track = (request: Record<string, unknown>) =>
      throttlerNamed(limits, API_THROTTLER_NAME).getTracker?.(request, {} as ExecutionContext);

    it("is the user's id once the JWT guard has identified them, wherever they connect from", () => {
      expect(track({ user: { id: "user-1" }, ip: "203.0.113.7" })).toBe("user-1");
      expect(track({ user: { id: "user-1" }, ip: "198.51.100.9" })).toBe("user-1");
    });

    it("is the client address for a caller nobody has identified", () => {
      expect(track({ ip: "203.0.113.7" })).toBe("203.0.113.7");
    });
  });

  describe("the per-account tracker", () => {
    const track = (request: Record<string, unknown>) =>
      throttlerNamed(limits, LOGIN_ACCOUNT_THROTTLER_NAME).getTracker?.(
        request,
        {} as ExecutionContext,
      );

    it("is the email the caller is trying to sign in as, whatever its case", () => {
      expect(track({ body: { email: "operator@capacity.local" } })).toBe("operator@capacity.local");
      expect(track({ body: { email: "Operator@Capacity.LOCAL" } })).toBe("operator@capacity.local");
    });

    it("ignores where the attempt comes from", () => {
      expect(track({ ip: "203.0.113.7", body: { email: "a@x.test" } })).toBe(
        track({ ip: "198.51.100.9", body: { email: "a@x.test" } }),
      );
    });
  });

  describe("applied by the ThrottlerGuard", () => {
    let storage: ThrottlerStorageService;

    const buildGuard = async (guardLimits: Limits) => {
      storage = new ThrottlerStorageService();
      const guard = new ThrottlerGuard(buildOptions(guardLimits), storage, new Reflector());
      await guard.onModuleInit();
      return guard;
    };

    const attempt = (
      guard: ThrottlerGuard,
      handler: () => void,
      request: Record<string, unknown>,
    ) => guard.canActivate(buildContext(handler, request));

    const outcomeOf = async (promise: Promise<boolean>): Promise<"allowed" | "limited"> => {
      try {
        await promise;
        return "allowed";
      } catch (error) {
        if (error instanceof ThrottlerException) {
          return "limited";
        }
        throw error;
      }
    };

    afterEach(() => {
      storage.onApplicationShutdown();
    });

    it("counts a signed-in caller as themselves, wherever they connect from, and nobody else with them", async () => {
      const guard = await buildGuard({ api: 2, loginIp: 100, loginAccount: 100 });
      const call = (userId: string, ip: string) =>
        outcomeOf(attempt(guard, list, { user: { id: userId }, ip }));

      expect([await call("user-1", "10.0.0.1"), await call("user-1", "10.0.0.2")]).toEqual([
        "allowed",
        "allowed",
      ]);
      expect(await call("user-1", "10.0.0.3")).toBe("limited");
      expect(await call("user-2", "10.0.0.1")).toBe("allowed");
    });

    it("counts an anonymous caller by address", async () => {
      const guard = await buildGuard({ api: 2, loginIp: 100, loginAccount: 100 });
      const call = (ip: string) => outcomeOf(attempt(guard, list, { ip }));

      expect([await call("10.0.0.1"), await call("10.0.0.1")]).toEqual(["allowed", "allowed"]);
      expect(await call("10.0.0.1")).toBe("limited");
      expect(await call("10.0.0.2")).toBe("allowed");
    });

    it("does not hold a login attempt to the general API limit", async () => {
      const guard = await buildGuard({ api: 1, loginIp: 100, loginAccount: 100 });
      const call = (email: string) =>
        outcomeOf(attempt(guard, login, { ip: "10.0.0.1", body: { email } }));

      expect([await call("a@x.test"), await call("b@x.test"), await call("c@x.test")]).toEqual([
        "allowed",
        "allowed",
        "allowed",
      ]);
    });

    it("limits login attempts per address, whichever accounts they try", async () => {
      const guard = await buildGuard({ api: 100, loginIp: 2, loginAccount: 100 });
      const call = (ip: string, email: string) =>
        outcomeOf(attempt(guard, login, { ip, body: { email } }));

      expect([await call("10.0.0.1", "a@x.test"), await call("10.0.0.1", "b@x.test")]).toEqual([
        "allowed",
        "allowed",
      ]);
      expect(await call("10.0.0.1", "c@x.test")).toBe("limited");
      expect(await call("10.0.0.2", "c@x.test")).toBe("allowed");
    });

    it("limits login attempts per account, from wherever they come and in whatever case the email is written", async () => {
      const guard = await buildGuard({ api: 100, loginIp: 100, loginAccount: 2 });
      const call = (ip: string, email: string) =>
        outcomeOf(attempt(guard, login, { ip, body: { email } }));

      expect([
        await call("10.0.0.1", "victim@x.test"),
        await call("10.0.0.2", "VICTIM@x.test"),
      ]).toEqual(["allowed", "allowed"]);
      expect(await call("10.0.0.3", "Victim@X.test")).toBe("limited");
      expect(await call("10.0.0.3", "someone-else@x.test")).toBe("allowed");
    });

    it("does not hold other routes to the login limits", async () => {
      const guard = await buildGuard({ api: 100, loginIp: 1, loginAccount: 1 });
      const call = () =>
        outcomeOf(attempt(guard, list, { ip: "10.0.0.1", body: { email: "a@x.test" } }));

      expect([await call(), await call(), await call()]).toEqual(["allowed", "allowed", "allowed"]);
    });

    it("answers with the minute-long message", async () => {
      const guard = await buildGuard({ api: 1, loginIp: 100, loginAccount: 100 });
      await attempt(guard, list, { ip: "10.0.0.1" });

      await expect(attempt(guard, list, { ip: "10.0.0.1" })).rejects.toThrow(
        "Too many requests, try again in a minute",
      );
    });
  });
});
