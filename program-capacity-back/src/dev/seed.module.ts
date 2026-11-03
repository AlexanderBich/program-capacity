import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { loadAppConfig } from "@/config/configuration";
import { AuthModule } from "@/modules/auth/auth.module";
import { CapacityModule } from "@/modules/capacity/capacity.module";
import { FxModule } from "@/modules/fx/fx.module";
import { LoggerModule } from "@/modules/logger/logger.module";
import { MetricsModule } from "@/modules/metrics/metrics.module";
import { typeormConfigFactory } from "@/typeorm.config-factory";

/** The application without its HTTP-facing and Kafka-facing parts. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [loadAppConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: typeormConfigFactory,
    }),
    LoggerModule,
    MetricsModule,
    AuthModule,
    FxModule,
    CapacityModule,
  ],
})
export class SeedModule {}
