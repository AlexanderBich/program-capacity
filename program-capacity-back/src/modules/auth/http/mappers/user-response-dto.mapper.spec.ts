import { UserRole } from "@/modules/auth/auth.enums";
import { UserEntity } from "@/modules/auth/entities/user.entity";
import { UserResponseDtoMapper } from "@/modules/auth/http/mappers/user-response-dto.mapper";

describe("UserResponseDtoMapper", () => {
  it("shows the id, email and role of a user and nothing else", () => {
    const user: UserEntity = {
      id: "7b0a3f1e-3d1c-4a52-9e37-0a1f1f4c9a11",
      email: "operator@capacity.local",
      passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
      role: UserRole.OPERATOR,
      isActive: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    };

    expect(UserResponseDtoMapper.mapFromUserEntity(user)).toStrictEqual({
      id: "7b0a3f1e-3d1c-4a52-9e37-0a1f1f4c9a11",
      email: "operator@capacity.local",
      role: UserRole.OPERATOR,
    });
  });
});
