import { ConfigService } from "@nestjs/config";
import { WinstonModuleOptions, utilities as nestWinstonUtilities } from "nest-winston";
import { format, transports } from "winston";

export const loggerConfigFactory = (config: ConfigService): WinstonModuleOptions => {
  const nodeEnv = config.getOrThrow<string>("nodeEnv");
  const isDevelopment = nodeEnv === "development";

  return {
    level: isDevelopment ? "debug" : "info",
    silent: nodeEnv === "test",
    transports: [
      new transports.Console({
        format: isDevelopment
          ? format.combine(
              format.timestamp(),
              nestWinstonUtilities.format.nestLike("ProgramCapacity", {
                colors: true,
                prettyPrint: true,
              }),
            )
          : format.combine(format.timestamp(), format.errors({ stack: true }), format.json()),
      }),
    ],
  };
};
