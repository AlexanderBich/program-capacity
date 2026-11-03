import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseFacade } from "@/modules/database/database.facade";
import { ReadinessResponseDto } from "@/modules/health/http/dto/readiness-response.dto";
import { TreasuryFacade } from "@/modules/treasury/treasury.facade";

@Injectable()
export class GetReadinessEndpointHandler {
  constructor(
    private readonly databaseFacade: DatabaseFacade,
    private readonly treasuryFacade: TreasuryFacade,
    private readonly config: ConfigService,
  ) {}

  /** A treasury feed problem degrades but does not unready the API: pulling every replica would only make it worse. */
  async handle(): Promise<ReadinessResponseDto> {
    if (!(await this.databaseFacade.isReachable())) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: "DATABASE_UNAVAILABLE",
        message: "Database is unreachable",
      });
    }

    const isFeedFlowing = this.treasuryFacade.isFeedFlowing();
    return {
      status:
        isFeedFlowing || !this.config.getOrThrow<boolean>("featureFlags.kafkaConsumer")
          ? "ok"
          : "degraded",
      database: true,
      treasuryFeed: isFeedFlowing,
    };
  }
}
