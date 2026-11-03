import { Module } from "@nestjs/common";
import { DatabaseModule } from "@/modules/database/database.module";
import { HealthController } from "@/modules/health/http/controllers/health.controller";
import { GetReadinessEndpointHandler } from "@/modules/health/http/endpoints/get-readiness.endpoint-handler";
import { TreasuryModule } from "@/modules/treasury/treasury.module";

@Module({
  imports: [DatabaseModule, TreasuryModule],
  controllers: [HealthController],
  providers: [GetReadinessEndpointHandler],
})
export class HealthModule {}
