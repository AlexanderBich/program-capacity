import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Server } from "http";
import { WINSTON_MODULE_NEST_PROVIDER } from "nest-winston";
import { AppModule } from "@/app.module";
import { configureApp } from "@/app.setup";
import { HTTP_DRAIN_TIMEOUT_MS } from "@/common/constants/http.constants";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  configureApp(app);

  // A shutdown ends the streams itself and lets requests in flight finish, but not indefinitely.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      setTimeout(
        () => (app.getHttpServer() as Server).closeAllConnections(),
        HTTP_DRAIN_TIMEOUT_MS,
      ).unref();
    });
  }

  await app.listen(app.get(ConfigService).getOrThrow<number>("server.port"));
}

void bootstrap();
