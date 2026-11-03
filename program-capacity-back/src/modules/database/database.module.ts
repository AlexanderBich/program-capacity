import { Module } from "@nestjs/common";
import { DatabaseFacade } from "@/modules/database/database.facade";
import { DatabaseClient } from "@/modules/database/infrastructure/clients/database.client";

@Module({
  providers: [DatabaseFacade, DatabaseClient],
  exports: [DatabaseFacade],
})
export class DatabaseModule {}
