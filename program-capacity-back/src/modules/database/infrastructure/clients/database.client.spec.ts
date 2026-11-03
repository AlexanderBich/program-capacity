import { DataSource } from "typeorm";
import { DatabaseClient } from "@/modules/database/infrastructure/clients/database.client";

describe("DatabaseClient", () => {
  describe("isReachable", () => {
    it("is true when the database answers a trivial query", async () => {
      const answers = new Set<string>();
      const client = new DatabaseClient({
        query: async (sql: string) => {
          answers.add(sql);
          return [{ "?column?": 1 }];
        },
      } as unknown as DataSource);

      await expect(client.isReachable()).resolves.toBe(true);

      expect(answers).toEqual(new Set(["SELECT 1"]));
    });

    it("is false when the query fails, rather than an error", async () => {
      const client = new DatabaseClient({
        query: async () => {
          throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
        },
      } as unknown as DataSource);

      await expect(client.isReachable()).resolves.toBe(false);
    });

    it("asks again every time instead of remembering an earlier answer", async () => {
      let isUp = false;
      const client = new DatabaseClient({
        query: async () => {
          if (!isUp) {
            throw new Error("down");
          }
          return [];
        },
      } as unknown as DataSource);

      expect(await client.isReachable()).toBe(false);
      isUp = true;
      expect(await client.isReachable()).toBe(true);
      isUp = false;
      expect(await client.isReachable()).toBe(false);
    });
  });
});
