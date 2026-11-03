import { IssuedSession } from "@/modules/auth/auth.types";
import { UserRole } from "@/modules/auth/auth.enums";
import { UserEntity } from "@/modules/auth/entities/user.entity";
import { SessionResponseDtoMapper } from "@/modules/auth/http/mappers/session-response-dto.mapper";

describe("SessionResponseDtoMapper", () => {
  const session: IssuedSession = {
    user: {
      id: "7b0a3f1e-3d1c-4a52-9e37-0a1f1f4c9a11",
      email: "viewer@capacity.local",
      passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
      role: UserRole.VIEWER,
      isActive: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    } as UserEntity,
    accessToken: "header.payload.signature",
    accessTokenExpiresAt: new Date("2026-11-01T12:15:00.000Z"),
    refreshToken: "opaque-refresh-token",
    refreshTokenExpiresAt: new Date("2026-11-08T12:00:00.000Z"),
  };

  it("returns the access token, when it expires as an ISO timestamp, and the user", () => {
    expect(SessionResponseDtoMapper.mapFromIssuedSession(session)).toStrictEqual({
      accessToken: "header.payload.signature",
      accessTokenExpiresAt: "2026-11-01T12:15:00.000Z",
      user: {
        id: "7b0a3f1e-3d1c-4a52-9e37-0a1f1f4c9a11",
        email: "viewer@capacity.local",
        role: UserRole.VIEWER,
      },
    });
  });

  it("keeps the refresh token and the password hash out of the body", () => {
    const body = JSON.stringify(SessionResponseDtoMapper.mapFromIssuedSession(session));

    expect(body).not.toContain("opaque-refresh-token");
    expect(body).not.toContain("argon2");
  });
});
