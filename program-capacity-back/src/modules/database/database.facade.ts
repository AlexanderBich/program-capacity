import { Injectable } from "@nestjs/common";
import { DatabaseClient } from "@/modules/database/infrastructure/clients/database.client";

@Injectable()
export class DatabaseFacade {
  constructor(private readonly databaseClient: DatabaseClient) {}

  isReachable(): Promise<boolean> {
    return this.databaseClient.isReachable();
  }
}
