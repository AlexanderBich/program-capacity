import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

@Injectable()
export class DatabaseClient {
  constructor(private readonly dataSource: DataSource) {}

  async isReachable(): Promise<boolean> {
    try {
      await this.dataSource.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}
