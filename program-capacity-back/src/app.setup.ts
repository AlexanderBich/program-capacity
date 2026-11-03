import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import basicAuth from "express-basic-auth";
import helmet from "helmet";
import { API_GLOBAL_PREFIX, SWAGGER_PATH } from "@/common/constants/http.constants";
import { createAccessLogMiddleware } from "@/middlewares/access-log.middleware";
import { requestContextMiddleware } from "@/middlewares/request-context.middleware";
import { LoggerService } from "@/modules/logger/logger.service";
import { MetricsService } from "@/modules/metrics/metrics.service";

export const buildSwaggerDocument = (app: NestExpressApplication): OpenAPIObject =>
  SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Program Capacity API")
      .setDescription("Tracks financing program capacity and invoice reservations in real time.")
      .setVersion("1.0")
      .addBearerAuth(
        {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          name: "Authorization",
          in: "header",
        },
        "JWT",
      )
      .addCookieAuth("refresh_token")
      .build(),
  );

/** Everything HTTP-facing that must be identical in production and in end-to-end tests. */
export const configureApp = (app: NestExpressApplication): void => {
  const config = app.get(ConfigService);

  app.set("trust proxy", config.getOrThrow<number>("server.trustProxyHops"));
  // This API serves JSON; a content security policy would only break the Swagger page.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.use(requestContextMiddleware);
  app.use(
    createAccessLogMiddleware(
      app.get(LoggerService).forContext("AccessLog"),
      app.get(MetricsService),
    ),
  );
  app.useBodyParser("json", { limit: "1mb" });

  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.enableCors({
    origin: config.getOrThrow<string[]>("server.corsOrigins"),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new BadRequestException({
          statusCode: 400,
          code: "VALIDATION_FAILED",
          message: "Request validation failed",
          details: {
            fields: errors.map((error) => ({
              field: error.property,
              errors: Object.values(error.constraints ?? {}),
            })),
          },
        }),
    }),
  );
  app.enableShutdownHooks();

  // Everything under the prefix, because Swagger serves more than the page: -json, -yaml, static assets.
  // The trailing .* matters: Express only applies a pattern whose match ends at a path boundary.
  // Case-insensitive, because routing is: /api/DOCS-JSON reaches the same handler.
  app.use(
    new RegExp(`^/${SWAGGER_PATH}.*`, "i"),
    basicAuth({
      users: {
        [config.getOrThrow<string>("server.swagger.username")]:
          config.getOrThrow<string>("server.swagger.password"),
      },
      challenge: true,
    }),
  );
  SwaggerModule.setup(SWAGGER_PATH, app, buildSwaggerDocument(app));
};
