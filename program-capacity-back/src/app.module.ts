import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApplicationExceptionFilter } from "@/common/filters/application-exception.filter";
import { loadAppConfig } from "@/config/configuration";
import { AuthModule } from "@/modules/auth/auth.module";
import { CapacityModule } from "@/modules/capacity/capacity.module";
import { FxModule } from "@/modules/fx/fx.module";
import { HealthModule } from "@/modules/health/health.module";
import { LoggerModule } from "@/modules/logger/logger.module";
import { MetricsModule } from "@/modules/metrics/metrics.module";
import { TreasuryModule } from "@/modules/treasury/treasury.module";
import { typeormConfigFactory } from "@/typeorm.config-factory";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [loadAppConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: typeormConfigFactory,
    }),
    ScheduleModule.forRoot(),
    LoggerModule,
    MetricsModule,
    AuthModule,
    FxModule,
    CapacityModule,
    TreasuryModule,
    HealthModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: ApplicationExceptionFilter }],
})
export class AppModule {}
