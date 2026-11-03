import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { UserRole } from "@/modules/auth/auth.enums";
import { AuthedUser, AuthenticatedRequest } from "@/modules/auth/auth.types";
import { Roles } from "@/modules/auth/decorators/roles.decorator";
import { RolesGuard } from "@/modules/auth/guards/roles.guard";

class WriteController {
  @Roles(UserRole.ADMIN)
  adminOnly() {}

  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  writers() {}

  @Roles()
  nobody() {}

  anyone() {}
}

@Roles(UserRole.ADMIN)
class AdminController {
  inheritsAdminOnly() {}

  @Roles(UserRole.VIEWER)
  overridesToViewer() {}
}

const buildUser = (role: UserRole): AuthedUser => ({
  id: "user-1",
  email: "someone@capacity.local",
  role,
  accessTokenExpiresAt: new Date("2026-11-01T12:15:00.000Z"),
});

const buildContext = (
  target: { handler: () => void; cls: new () => unknown },
  user: AuthedUser | undefined,
) =>
  ({
    getHandler: () => target.handler,
    getClass: () => target.cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) as AuthenticatedRequest }),
  }) as unknown as ExecutionContext;

const thrownBy = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the action to throw");
};

describe("RolesGuard", () => {
  const guard = new RolesGuard(new Reflector());
  const handler = (name: keyof WriteController) => ({
    handler: WriteController.prototype[name],
    cls: WriteController,
  });

  it("lets anyone through a route that names no roles, even a caller with no identity", () => {
    expect(guard.canActivate(buildContext(handler("anyone"), buildUser(UserRole.VIEWER)))).toBe(
      true,
    );
    expect(guard.canActivate(buildContext(handler("anyone"), undefined))).toBe(true);
  });

  it.each([
    [UserRole.ADMIN, "adminOnly"],
    [UserRole.ADMIN, "writers"],
    [UserRole.OPERATOR, "writers"],
  ] as const)("admits a %s on %s", (role, name) => {
    expect(guard.canActivate(buildContext(handler(name), buildUser(role)))).toBe(true);
  });

  it.each([
    [UserRole.OPERATOR, "adminOnly"],
    [UserRole.VIEWER, "adminOnly"],
    [UserRole.VIEWER, "writers"],
  ] as const)("turns a %s away from %s with 403 FORBIDDEN", (role, name) => {
    const outcome = thrownBy(() => guard.canActivate(buildContext(handler(name), buildUser(role))));

    expect(outcome).toBeInstanceOf(ForbiddenException);
    expect((outcome as ForbiddenException).getStatus()).toBe(403);
    expect((outcome as ForbiddenException).getResponse()).toStrictEqual({
      statusCode: 403,
      code: "FORBIDDEN",
      message: "Your role does not allow this action",
    });
  });

  it("turns away a caller with no identity from a route that names roles", () => {
    const outcome = thrownBy(() =>
      guard.canActivate(buildContext(handler("adminOnly"), undefined)),
    );

    expect(outcome).toBeInstanceOf(ForbiddenException);
  });

  it("admits nobody when the list of roles is empty, rather than everybody", () => {
    for (const role of Object.values(UserRole)) {
      const outcome = thrownBy(() =>
        guard.canActivate(buildContext(handler("nobody"), buildUser(role))),
      );

      expect(outcome).toBeInstanceOf(ForbiddenException);
    }
  });

  it("applies the roles of the class to a handler that names none", () => {
    const target = { handler: AdminController.prototype.inheritsAdminOnly, cls: AdminController };

    expect(guard.canActivate(buildContext(target, buildUser(UserRole.ADMIN)))).toBe(true);
    expect(
      thrownBy(() => guard.canActivate(buildContext(target, buildUser(UserRole.OPERATOR)))),
    ).toBeInstanceOf(ForbiddenException);
  });

  it("lets the roles of a handler replace those of its class", () => {
    const target = { handler: AdminController.prototype.overridesToViewer, cls: AdminController };

    expect(guard.canActivate(buildContext(target, buildUser(UserRole.VIEWER)))).toBe(true);
    expect(
      thrownBy(() => guard.canActivate(buildContext(target, buildUser(UserRole.ADMIN)))),
    ).toBeInstanceOf(ForbiddenException);
  });
});
