import { FxRateEntity } from "@/modules/fx/entities/fx-rate.entity";
import { FxRateResponseDtoMapper } from "@/modules/fx/http/mappers/fx-rate-response-dto.mapper";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const MAX_AGE_MS = 3_600_000;

const ago = (ms: number) => new Date(NOW.getTime() - ms);

const entity = (overrides: Partial<FxRateEntity> = {}): FxRateEntity => ({
  baseCurrency: "EUR",
  quoteCurrency: "USD",
  rate: "1.081200000000",
  asOf: ago(60_000),
  updatedAt: ago(30_000),
  ...overrides,
});

describe("FxRateResponseDtoMapper", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("mapFromFxRateEntity", () => {
    it("shows the pair, the rate without PostgreSQL's zero padding, and when it was published", () => {
      expect(
        FxRateResponseDtoMapper.mapFromFxRateEntity(entity(), { maxAgeMs: MAX_AGE_MS }),
      ).toStrictEqual({
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        rate: "1.0812",
        asOf: "2026-11-01T11:59:00.000Z",
        isStale: false,
      });
    });

    it("keeps the zeros of a whole-number rate", () => {
      const dto = FxRateResponseDtoMapper.mapFromFxRateEntity(
        entity({ baseCurrency: "USD", quoteCurrency: "JPY", rate: "150.000000000000" }),
        { maxAgeMs: MAX_AGE_MS },
      );

      expect(dto.rate).toBe("150");
    });

    it("calls a rate stale only once it is older than the maximum age", () => {
      const map = (ageMs: number) =>
        FxRateResponseDtoMapper.mapFromFxRateEntity(entity({ asOf: ago(ageMs) }), {
          maxAgeMs: MAX_AGE_MS,
        }).isStale;

      expect(map(0)).toBe(false);
      expect(map(MAX_AGE_MS - 1)).toBe(false);
      expect(map(MAX_AGE_MS)).toBe(false);
      expect(map(MAX_AGE_MS + 1)).toBe(true);
      expect(map(MAX_AGE_MS * 24)).toBe(true);
    });

    it("measures staleness against the maximum age it is given", () => {
      const old = entity({ asOf: ago(10_000) });

      expect(FxRateResponseDtoMapper.mapFromFxRateEntity(old, { maxAgeMs: 5_000 }).isStale).toBe(
        true,
      );
      expect(FxRateResponseDtoMapper.mapFromFxRateEntity(old, { maxAgeMs: 20_000 }).isStale).toBe(
        false,
      );
    });
  });
});
