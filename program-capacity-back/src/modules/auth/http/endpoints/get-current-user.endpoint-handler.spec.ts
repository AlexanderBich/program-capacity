import { HttpException } from "@nestjs/common";
import { UserRole } from "@/modules/auth/auth.enums";
import { UserEntity } from "@/modules/auth/entities/user.entity";
import { GetCurrentUserEndpointHandler } from "@/modules/auth/http/endpoints/get-current-user.endpoint-handler";
import { UserRepository } from "@/modules/auth/infrastructure/repositories/user.repository";

const buildUser = (overrides: Partial<UserEntity> = {}): UserEntity =>
  ({
    id: "7b0a3f1e-3d1c-4a52-9e37-0a1f1f4c9a11",
    email: "admin@capacity.local",
    passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
    role: UserRole.ADMIN,
    isActive: true,
    ...overrides,
  }) as UserEntity;

const buildHandler = (findById: jest.Mock) =>
  new GetCurrentUserEndpointHandler({ findById } as unknown as UserRepository);

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject");
};

describe("GetCurrentUserEndpointHandler", () => {
  it("shows the signed-in user's id, email and role, and not the password hash", async () => {
    const user = buildUser();
    const handler = buildHandler(jest.fn(async (id: string) => (id === user.id ? user : null)));

    const body = await handler.handle(user.id);

    expect(body).toStrictEqual({
      id: "7b0a3f1e-3d1c-4a52-9e37-0a1f1f4c9a11",
      email: "admin@capacity.local",
      role: UserRole.ADMIN,
    });
  });

  it("answers 401 UNAUTHENTICATED when the user no longer exists", async () => {
    const handler = buildHandler(jest.fn().mockResolvedValue(null));

    const error = (await rejectionOf(handler.handle("gone-user"))) as HttpException;

    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toStrictEqual({
      statusCode: 401,
      code: "UNAUTHENTICATED",
      message: "User no longer exists",
    });
  });

  it("answers the same 401 for a deactivated user, whose access token may still be valid", async () => {
    const handler = buildHandler(jest.fn().mockResolvedValue(buildUser({ isActive: false })));

    const error = (await rejectionOf(
      handler.handle("7b0a3f1e-3d1c-4a52-9e37-0a1f1f4c9a11"),
    )) as HttpException;

    expect(error.getStatus()).toBe(401);
    expect(error.getResponse()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("lets an unexpected failure rise as it is", async () => {
    const outage = new Error("database is down");
    const handler = buildHandler(jest.fn().mockRejectedValue(outage));

    expect(await rejectionOf(handler.handle("any-user"))).toBe(outage);
  });
});
