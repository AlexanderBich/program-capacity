import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { PickPartial } from "@/common/types/common";
import { UserRole } from "@/modules/auth/auth.enums";

@Entity("users")
@Index("UQ_users_email", ["email"], { unique: true })
@Check("CHK_users_role", `"role" IN ('ADMIN', 'OPERATOR', 'VIEWER')`)
export class UserEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 320 })
  email: string;

  @Column({ name: "password_hash", type: "text" })
  passwordHash: string;

  @Column({ type: "varchar", length: 32 })
  role: UserRole;

  @Column({ name: "is_active", type: "boolean" })
  isActive: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt: Date;
}

export type CreateUser = PickPartial<UserEntity, "id" | "createdAt" | "updatedAt">;
