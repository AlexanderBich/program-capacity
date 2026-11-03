import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthedUser, AuthenticatedRequest } from "@/modules/auth/auth.types";

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthedUser =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user as AuthedUser,
);
