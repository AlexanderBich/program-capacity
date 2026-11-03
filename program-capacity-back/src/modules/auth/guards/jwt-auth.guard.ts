import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { requestMetadataContext } from "@/common/contexts/request-metadata.context";
import { SKIP_JWT_AUTH_METADATA_KEY } from "@/modules/auth/auth.constants";
import { AccessTokenClaims, AuthenticatedRequest } from "@/modules/auth/auth.types";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isJwtSkipped = this.reflector.getAllAndOverride<boolean>(SKIP_JWT_AUTH_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isJwtSkipped) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token) {
      throw this.buildUnauthorizedException();
    }

    try {
      const claims = await this.jwtService.verifyAsync<AccessTokenClaims>(token);
      request.user = {
        id: claims.sub,
        email: claims.email,
        role: claims.role,
        accessTokenExpiresAt: new Date(claims.exp * 1000),
      };
      requestMetadataContext.getStore()?.set("userId", claims.sub);
      return true;
    } catch {
      throw this.buildUnauthorizedException();
    }
  }

  private buildUnauthorizedException() {
    return new UnauthorizedException({
      statusCode: 401,
      code: "UNAUTHENTICATED",
      message: "A valid access token is required",
    });
  }
}
