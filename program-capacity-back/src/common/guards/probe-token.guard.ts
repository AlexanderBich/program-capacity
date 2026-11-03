import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, timingSafeEqual } from "crypto";
import { Request } from "express";

/** Orchestrator probes have no user session, so they authenticate with a shared token instead. */
@Injectable()
export class ProbeTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const token = context.switchToHttp().getRequest<Request>().header("x-probe-token");
    const isValid =
      token !== undefined &&
      timingSafeEqual(
        this.digest(token),
        this.digest(this.config.getOrThrow<string>("server.probeToken")),
      );
    if (!isValid) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: "UNAUTHENTICATED",
        message: "A valid probe token is required",
      });
    }
    return true;
  }

  private digest(value: string): Buffer {
    return createHash("sha256").update(value).digest();
  }
}
