import { DatabaseFacade } from "@/modules/database/database.facade";
import { DatabaseClient } from "@/modules/database/infrastructure/clients/database.client";

describe("DatabaseFacade", () => {
  describe("isReachable", () => {
    it.each([true, false])("reports what the client finds out: %s", async (isReachable) => {
      const facade = new DatabaseFacade({
        isReachable: async () => isReachable,
      } as unknown as DatabaseClient);

      await expect(facade.isReachable()).resolves.toBe(isReachable);
    });
  });
});
