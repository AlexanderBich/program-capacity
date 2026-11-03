import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WinstonModule } from "nest-winston";
import { loggerConfigFactory } from "@/modules/logger/logger.config-factory";
import { LoggerService } from "@/modules/logger/logger.service";

@Global()
@Module({
  imports: [
    WinstonModule.forRootAsync({
      useFactory: loggerConfigFactory,
      inject: [ConfigService],
    }),
  ],
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule {}
