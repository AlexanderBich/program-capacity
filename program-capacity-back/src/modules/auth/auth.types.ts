import { Request } from "express";
import { UserRole } from "@/modules/auth/auth.enums";
import { UserEntity } from "@/modules/auth/entities/user.entity";

export type AuthedUser = {
  id: string;
  email: string;
  role: UserRole;
  accessTokenExpiresAt: Date;
};

export type AccessTokenClaims = {
  sub: string;
  email: string;
  role: UserRole;
  exp: number;
};

export type AuthenticatedRequest = Request & { user?: AuthedUser };

export type IssuedSession = {
  user: UserEntity;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
};
