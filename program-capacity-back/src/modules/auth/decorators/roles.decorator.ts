import { SetMetadata } from "@nestjs/common";
import { ROLES_METADATA_KEY } from "@/modules/auth/auth.constants";
import { UserRole } from "@/modules/auth/auth.enums";

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_METADATA_KEY, roles);
