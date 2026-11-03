import { PaginationUtils } from "@/common/utils/pagination.utils";

describe("PaginationUtils", () => {
  describe("toOffset", () => {
    it("starts the first page at the first row whatever the page size", () => {
      expect(PaginationUtils.toOffset({ page: 1, limit: 1 })).toBe(0);
      expect(PaginationUtils.toOffset({ page: 1, limit: 20 })).toBe(0);
      expect(PaginationUtils.toOffset({ page: 1, limit: 100 })).toBe(0);
    });

    it.each([
      { page: 2, limit: 20, offset: 20 },
      { page: 3, limit: 20, offset: 40 },
      { page: 2, limit: 1, offset: 1 },
      { page: 5, limit: 100, offset: 400 },
    ])(
      "skips every row of the pages before page $page of $limit rows",
      ({ page, limit, offset }) => {
        expect(PaginationUtils.toOffset({ page, limit })).toBe(offset);
      },
    );
  });
});
