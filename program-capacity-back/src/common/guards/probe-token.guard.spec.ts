import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ProbeTokenGuard } from "@/common/guards/probe-token.guard";

const PROBE_TOKEN = "probe-token-0123456789";

const buildContext = (headers: Record<string, string>) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ header: (name: string) => headers[name.toLowerCase()] }),
    }),
  }) as unknown as ExecutionContext;

const thrownBy = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the action to throw");
};

describe("ProbeTokenGuard", () => {
  const guard = new ProbeTokenGuard({
    getOrThrow: (key: string) => {
      if (key !== "server.probeToken") {
        throw new Error(`Unexpected config key ${key}`);
      }
      return PROBE_TOKEN;
    },
  } as unknown as ConfigService);

  it("lets a probe through when it presents the configured token", () => {
    expect(guard.canActivate(buildContext({ "x-probe-token": PROBE_TOKEN }))).toBe(true);
  });

  it("turns away a call that presents no token, with a stable code", () => {
    const error = thrownBy(() => guard.canActivate(buildContext({}))) as UnauthorizedException;

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toEqual({
      statusCode: 401,
      code: "UNAUTHENTICATED",
      message: "A valid probe token is required",
    });
  });

  it.each([
    ["a wrong token of the same length", "probe-token-9876543210"],
    ["a prefix of the right token", PROBE_TOKEN.slice(0, -1)],
    ["the right token with something appended", `${PROBE_TOKEN}x`],
    ["the right token in another case", PROBE_TOKEN.toUpperCase()],
    ["a much shorter token", "x"],
    ["an empty token", ""],
  ])("turns away %s with 401 rather than failing", (_description, token) => {
    const error = thrownBy(() => guard.canActivate(buildContext({ "x-probe-token": token })));

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("reads the token from the x-probe-token header only", () => {
    const error = thrownBy(() =>
      guard.canActivate(
        buildContext({ authorization: `Bearer ${PROBE_TOKEN}`, "x-token": PROBE_TOKEN }),
      ),
    );

    expect(error).toBeInstanceOf(UnauthorizedException);
  });
});
