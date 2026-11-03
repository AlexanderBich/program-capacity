import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Nullable, PickPartial } from "@/common/types/common";
import { UserEntity } from "@/modules/auth/entities/user.entity";

@Entity("refresh_tokens")
@Index("UQ_refresh_tokens_token_hash", ["tokenHash"], { unique: true })
@Index("IDX_refresh_tokens_user_id", ["userId"])
@Index("IDX_refresh_tokens_family_id", ["familyId"])
@Index("IDX_refresh_tokens_expires_at", ["expiresAt"])
export class RefreshTokenEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id", type: "uuid" })
  userId: string;

  @Column({ name: "family_id", type: "uuid" })
  familyId: string;

  // SHA-256 of the token: a database leak must not yield usable sessions.
  @Column({ name: "token_hash", type: "char", length: 64 })
  tokenHash: string;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt: Date;

  @Column({ name: "rotated_at", type: "timestamptz", nullable: true })
  rotatedAt: Nullable<Date>;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt: Nullable<Date>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @ManyToOne(() => UserEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user?: UserEntity;
}

export type CreateRefreshToken = PickPartial<RefreshTokenEntity, "id" | "createdAt">;
