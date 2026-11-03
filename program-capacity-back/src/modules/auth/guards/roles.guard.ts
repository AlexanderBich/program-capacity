import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_METADATA_KEY } from "@/modules/auth/auth.constants";
import { UserRole } from "@/modules/auth/auth.enums";
import { AuthenticatedRequest } from "@/modules/auth/auth.types";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowedRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!allowedRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user || !allowedRoles.includes(user.role)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: "FORBIDDEN",
        message: "Your role does not allow this action",
      });
    }
    return true;
  }
}
