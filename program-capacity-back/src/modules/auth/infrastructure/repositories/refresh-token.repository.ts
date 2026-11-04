import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, IsNull, LessThan, Repository } from "typeorm";
import { Nullable } from "@/common/types/common";
import {
  CreateRefreshToken,
  RefreshTokenEntity,
} from "@/modules/auth/entities/refresh-token.entity";

@Injectable()
export class RefreshTokenRepository {
  constructor(
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokenRepositoryRaw: Repository<RefreshTokenEntity>,
  ) {}

  /** Serializes everything done to one session family. Released when the surrounding transaction ends. */
  async lockFamilyForTransaction(
    familyId: string,
    options: { manager: EntityManager },
  ): Promise<void> {
    await options.manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      familyId,
    ]);
  }

  findByTokenHashWithUser(
    tokenHash: string,
    options?: { manager?: EntityManager },
  ): Promise<Nullable<RefreshTokenEntity>> {
    const manager = options?.manager ?? this.refreshTokenRepositoryRaw.manager;
    return manager.findOne(RefreshTokenEntity, {
      where: { tokenHash },
      relations: { user: true },
    });
  }

  async create(values: CreateRefreshToken, options?: { manager?: EntityManager }): Promise<void> {
    const manager = options?.manager ?? this.refreshTokenRepositoryRaw.manager;
    await manager.insert(RefreshTokenEntity, values);
  }

  async markRotatedByIdIfNotYetRotated(
    id: string,
    rotatedAt: Date,
    options?: { manager?: EntityManager },
  ): Promise<void> {
    const manager = options?.manager ?? this.refreshTokenRepositoryRaw.manager;
    await manager.update(RefreshTokenEntity, { id, rotatedAt: IsNull() }, { rotatedAt });
  }

  async revokeActiveByFamilyId(
    familyId: string,
    revokedAt: Date,
    options?: { manager?: EntityManager },
  ): Promise<void> {
    const manager = options?.manager ?? this.refreshTokenRepositoryRaw.manager;
    await manager.update(RefreshTokenEntity, { familyId, revokedAt: IsNull() }, { revokedAt });
  }

  async deleteExpiredBefore(cutoff: Date): Promise<void> {
    await this.refreshTokenRepositoryRaw.delete({ expiresAt: LessThan(cutoff) });
  }
}
