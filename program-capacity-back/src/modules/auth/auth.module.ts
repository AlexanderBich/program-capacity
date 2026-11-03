import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ExpiredRefreshTokenCrons } from "@/modules/auth/application/crons/expired-refresh-token.crons";
import { AuthSessionService } from "@/modules/auth/application/services/auth-session.service";
import { authThrottlerConfigFactory } from "@/modules/auth/auth-throttler.config-factory";
import { RefreshTokenEntity } from "@/modules/auth/entities/refresh-token.entity";
import { UserEntity } from "@/modules/auth/entities/user.entity";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";
import { RolesGuard } from "@/modules/auth/guards/roles.guard";
import { AuthController } from "@/modules/auth/http/controllers/auth.controller";
import { GetCurrentUserEndpointHandler } from "@/modules/auth/http/endpoints/get-current-user.endpoint-handler";
import { LoginEndpointHandler } from "@/modules/auth/http/endpoints/login.endpoint-handler";
import { LogoutEndpointHandler } from "@/modules/auth/http/endpoints/logout.endpoint-handler";
import { RefreshSessionEndpointHandler } from "@/modules/auth/http/endpoints/refresh-session.endpoint-handler";
import { RefreshTokenRepository } from "@/modules/auth/infrastructure/repositories/refresh-token.repository";
import { UserRepository } from "@/modules/auth/infrastructure/repositories/user.repository";

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, RefreshTokenEntity]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("auth.jwt.secret"),
        signOptions: {
          algorithm: "HS256",
          issuer: config.getOrThrow<string>("auth.jwt.issuer"),
          audience: config.getOrThrow<string>("auth.jwt.audience"),
          expiresIn: config.getOrThrow<number>("auth.jwt.accessTtlSeconds"),
        },
        verifyOptions: {
          algorithms: ["HS256"],
          issuer: config.getOrThrow<string>("auth.jwt.issuer"),
          audience: config.getOrThrow<string>("auth.jwt.audience"),
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: authThrottlerConfigFactory,
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthSessionService,
    ExpiredRefreshTokenCrons,
    UserRepository,
    RefreshTokenRepository,
    LoginEndpointHandler,
    RefreshSessionEndpointHandler,
    LogoutEndpointHandler,
    GetCurrentUserEndpointHandler,
    // In this order: the rate limit counts a caller the JWT guard has already identified.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
