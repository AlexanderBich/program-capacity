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
  async lockFamilyForTransaction(manager: EntityManager, familyId: string): Promise<void> {
    await manager.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [familyId]);
  }

  findByTokenHashWithUser(
    tokenHash: string,
    manager: EntityManager = this.refreshTokenRepositoryRaw.manager,
  ): Promise<Nullable<RefreshTokenEntity>> {
    return manager.findOne(RefreshTokenEntity, {
      where: { tokenHash },
      relations: { user: true },
    });
  }

  async create(manager: EntityManager, values: CreateRefreshToken): Promise<void> {
    await manager.insert(RefreshTokenEntity, values);
  }

  async markRotatedByIdIfNotYetRotated(
    manager: EntityManager,
    id: string,
    rotatedAt: Date,
  ): Promise<void> {
    await manager.update(RefreshTokenEntity, { id, rotatedAt: IsNull() }, { rotatedAt });
  }

  async revokeActiveByFamilyId(
    manager: EntityManager,
    familyId: string,
    revokedAt: Date,
  ): Promise<void> {
    await manager.update(RefreshTokenEntity, { familyId, revokedAt: IsNull() }, { revokedAt });
  }

  async deleteExpiredBefore(cutoff: Date): Promise<void> {
    await this.refreshTokenRepositoryRaw.delete({ expiresAt: LessThan(cutoff) });
  }
}
