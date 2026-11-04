import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { hash, verify } from "@node-rs/argon2";
import { randomUUID } from "crypto";
import { DataSource, EntityManager } from "typeorm";
import { Nullable } from "@/common/types/common";
import { REFRESH_TOKEN_ROTATION_GRACE_MS } from "@/modules/auth/auth.constants";
import { AccessTokenClaims, IssuedSession } from "@/modules/auth/auth.types";
import { InvalidCredentialsError } from "@/modules/auth/application/errors/invalid-credentials.error";
import { RefreshTokenInvalidError } from "@/modules/auth/application/errors/refresh-token-invalid.error";
import { RefreshTokenUtils } from "@/modules/auth/application/utils/refresh-token.utils";
import { UserEntity } from "@/modules/auth/entities/user.entity";
import { RefreshTokenRepository } from "@/modules/auth/infrastructure/repositories/refresh-token.repository";
import { UserRepository } from "@/modules/auth/infrastructure/repositories/user.repository";
import { LoggerService } from "@/modules/logger/logger.service";

@Injectable()
export class AuthSessionService {
  private readonly logger: LoggerService;
  // Verified against when the email is unknown, so response time does not reveal which accounts exist.
  private readonly decoyPasswordHash = hash(randomUUID());

  constructor(
    private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly userRepository: UserRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly config: ConfigService,
    private readonly baseLogger: LoggerService,
  ) {
    this.logger = this.baseLogger.forContext(AuthSessionService.name);
  }

  async login(params: { email: string; password: string }): Promise<IssuedSession> {
    const user = await this.userRepository.findByEmail(params.email.toLowerCase());
    const isPasswordValid = await verify(
      user?.passwordHash ?? (await this.decoyPasswordHash),
      params.password,
    );
    if (!user || !user.isActive || !isPasswordValid) {
      throw new InvalidCredentialsError();
    }
    return this.issueSession(user, randomUUID());
  }

  async rotateRefreshToken(refreshToken: string): Promise<IssuedSession> {
    const tokenHash = RefreshTokenUtils.hashToken(refreshToken);
    const known = await this.refreshTokenRepository.findByTokenHashWithUser(tokenHash);
    if (!known) {
      throw new RefreshTokenInvalidError();
    }

    const session = await this.dataSource.transaction(async (manager) => {
      await this.refreshTokenRepository.lockFamilyForTransaction(known.familyId, { manager });
      return this.rotateInLockedFamily(manager, tokenHash);
    });
    // Thrown out here: revoking a stolen family has to commit even though the caller gets an error.
    if (!session) {
      throw new RefreshTokenInvalidError();
    }
    return session;
  }

  async revokeSession(refreshToken: string): Promise<void> {
    const stored = await this.refreshTokenRepository.findByTokenHashWithUser(
      RefreshTokenUtils.hashToken(refreshToken),
    );
    if (!stored) {
      throw new RefreshTokenInvalidError();
    }

    await this.dataSource.transaction(async (manager) => {
      await this.refreshTokenRepository.lockFamilyForTransaction(stored.familyId, { manager });
      await this.refreshTokenRepository.revokeActiveByFamilyId(stored.familyId, new Date(), {
        manager,
      });
    });
  }

  /** Read again under the lock: a logout or another rotation may have got there first. */
  private async rotateInLockedFamily(
    manager: EntityManager,
    tokenHash: string,
  ): Promise<Nullable<IssuedSession>> {
    const now = new Date();
    const stored = await this.refreshTokenRepository.findByTokenHashWithUser(tokenHash, {
      manager,
    });
    if (!stored?.user?.isActive || stored.revokedAt || stored.expiresAt <= now) {
      return null;
    }

    if (stored.rotatedAt) {
      const isReplayedAfterGrace =
        now.getTime() - stored.rotatedAt.getTime() > REFRESH_TOKEN_ROTATION_GRACE_MS;
      if (isReplayedAfterGrace) {
        await this.refreshTokenRepository.revokeActiveByFamilyId(stored.familyId, now, { manager });
        this.logger.warn("Rotated refresh token replayed, session family revoked", {
          familyId: stored.familyId,
          targetUserId: stored.userId,
        });
        return null;
      }
    } else {
      await this.refreshTokenRepository.markRotatedByIdIfNotYetRotated(stored.id, now, { manager });
    }

    return this.issueSession(stored.user, stored.familyId, { manager });
  }

  private async issueSession(
    user: UserEntity,
    familyId: string,
    options?: { manager: EntityManager },
  ): Promise<IssuedSession> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });
    const refreshToken = RefreshTokenUtils.generateToken();
    const refreshTokenExpiresAt = new Date(
      Date.now() + this.config.getOrThrow<number>("auth.refreshTtlSeconds") * 1000,
    );

    await this.refreshTokenRepository.create(
      {
        userId: user.id,
        familyId,
        tokenHash: RefreshTokenUtils.hashToken(refreshToken),
        expiresAt: refreshTokenExpiresAt,
        rotatedAt: null,
        revokedAt: null,
      },
      options,
    );

    return {
      user,
      accessToken,
      accessTokenExpiresAt: new Date(
        this.jwtService.decode<AccessTokenClaims>(accessToken).exp * 1000,
      ),
      refreshToken,
      refreshTokenExpiresAt,
    };
  }
}
