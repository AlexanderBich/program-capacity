import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { RefreshTokenRepository } from "@/modules/auth/infrastructure/repositories/refresh-token.repository";

@Injectable()
export class ExpiredRefreshTokenCrons {
  constructor(
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async deleteExpiredRefreshTokens(): Promise<void> {
    if (!this.config.getOrThrow<boolean>("featureFlags.crons")) {
      return;
    }
    await this.refreshTokenRepository.deleteExpiredBefore(new Date());
  }
}
