import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/common/constants/currencies.constants";
import {
  TREASURY_CAPACITY_MESSAGE_SCHEMA,
  TREASURY_FX_RATE_MESSAGE_SCHEMA,
} from "@/modules/treasury/treasury-message-schemas.constants";
import { TREASURY_MAX_FUTURE_AS_OF_MS } from "@/modules/treasury/treasury.constants";

const NOW = new Date("2026-11-03T10:00:00.000Z");

const envelope = {
  eventId: "6d1f7c0e-3f4b-4a8e-9a53-0c5f2b7d9e11",
  programCode: "ACME-USD",
  sequence: 42,
  occurredAt: "2026-11-03T09:59:00.000Z",
};

const position = {
  invoiceId: "INV-2026-00042",
  invoiceCurrency: "EUR",
  invoiceAmount: "125000.00",
  outstandingInvoiceAmount: "125000.00",
  outstandingProgramAmount: "135150.00",
};

const programUpserted = {
  ...envelope,
  type: "PROGRAM_UPSERTED",
  payload: { name: "Acme Supply Chain Finance", currency: "USD", creditLimit: "10000000.00" },
};

const capacityReserved = {
  ...envelope,
  type: "CAPACITY_RESERVED",
  payload: {
    invoiceId: "INV-2026-00042",
    invoiceCurrency: "EUR",
    invoiceAmount: "125000.00",
    programAmount: "135150.00",
  },
};

const capacityReleased = {
  ...envelope,
  type: "CAPACITY_RELEASED",
  payload: { invoiceId: "INV-2026-00042", repaymentId: "RPM-2026-00017", amount: "50000.00" },
};

const programReconciled = {
  ...envelope,
  type: "PROGRAM_RECONCILED",
  payload: {
    name: "Acme Supply Chain Finance",
    currency: "USD",
    creditLimit: "10000000.00",
    asOf: "2026-11-03T09:58:00.000Z",
    totalOutstanding: "135150.00",
    positions: [position],
  },
};

const fxRate = {
  baseCurrency: "EUR",
  quoteCurrency: "USD",
  rate: "1.0812",
  asOf: "2026-11-03T09:58:00.000Z",
};

const withValue = <T extends object>(message: T, path: string, value: unknown): T => {
  const copy = structuredClone(message) as Record<string, any>;
  const keys = path.split(".");
  const last = keys.pop() as string;
  keys.reduce((node, key) => node[key], copy)[last] = value;
  return copy as T;
};

const rejectedPaths = (schema: z.ZodType, message: unknown): string[] => {
  const result = schema.safeParse(message);
  if (result.success) {
    throw new Error("the message was accepted");
  }
  return [...new Set(result.error.issues.map((issue) => issue.path.join(".")))];
};

const isAccepted = (schema: z.ZodType, message: unknown) => schema.safeParse(message).success;

const isoOffsetFromNow = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString();

describe("treasury message schemas", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("capacity messages", () => {
    it.each([
      ["PROGRAM_UPSERTED", programUpserted],
      ["CAPACITY_RESERVED", capacityReserved],
      ["CAPACITY_RELEASED", capacityReleased],
      ["PROGRAM_RECONCILED", programReconciled],
    ])("accepts a valid %s message as it is", (_type, message) => {
      const result = TREASURY_CAPACITY_MESSAGE_SCHEMA.safeParse(message);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(message);
    });

    it("accepts a reconciliation that lists nothing outstanding", () => {
      const empty = withValue(programReconciled, "payload.positions", []);
      const result = TREASURY_CAPACITY_MESSAGE_SCHEMA.safeParse(empty);

      expect(result.success).toBe(true);
      expect(result.data).toMatchObject({ payload: { positions: [] } });
    });

    it("accepts every supported currency", () => {
      for (const currency of SUPPORTED_CURRENCIES) {
        expect(
          isAccepted(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(programUpserted, "payload.currency", currency),
          ),
        ).toBe(true);
      }
    });

    it.each([
      ["PROGRAM_UPSERTED", programUpserted],
      ["CAPACITY_RESERVED", capacityReserved],
      ["CAPACITY_RELEASED", capacityReleased],
      ["PROGRAM_RECONCILED", programReconciled],
    ])(
      "drops fields a %s payload does not define, so it cannot override the envelope",
      (_type, message) => {
        const result = TREASURY_CAPACITY_MESSAGE_SCHEMA.safeParse({
          ...message,
          payload: { ...message.payload, programCode: "OTHER", sequence: 1, extra: true },
        });

        expect(result.success).toBe(true);
        expect(result.data).toEqual(message);
      },
    );

    it("drops fields a position does not define", () => {
      const result = TREASURY_CAPACITY_MESSAGE_SCHEMA.safeParse(
        withValue(programReconciled, "payload.positions.0.extra", "kept?"),
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(programReconciled);
    });

    it("drops fields the envelope does not define", () => {
      const result = TREASURY_CAPACITY_MESSAGE_SCHEMA.safeParse({ ...capacityReleased, extra: 1 });

      expect(result.data).toEqual(capacityReleased);
    });

    describe("type", () => {
      it.each([
        ["an unknown type", "PROGRAM_DELETED"],
        ["a type in lower case", "program_upserted"],
        ["an empty type", ""],
        ["a type that is not text", 7],
        ["no type", undefined],
      ])("rejects %s", (_label, type) => {
        expect(
          rejectedPaths(TREASURY_CAPACITY_MESSAGE_SCHEMA, withValue(programUpserted, "type", type)),
        ).toEqual(["type"]);
      });

      it("does not read a payload of one type as another", () => {
        expect(
          isAccepted(TREASURY_CAPACITY_MESSAGE_SCHEMA, {
            ...capacityReleased,
            type: "CAPACITY_RESERVED",
          }),
        ).toBe(false);
      });
    });

    describe("currency", () => {
      const CURRENCY_FIELDS: [string, object, string][] = [
        ["program currency", programUpserted, "payload.currency"],
        ["invoice currency", capacityReserved, "payload.invoiceCurrency"],
        ["reconciled program currency", programReconciled, "payload.currency"],
        ["position invoice currency", programReconciled, "payload.positions.0.invoiceCurrency"],
      ];

      it.each(CURRENCY_FIELDS)("rejects an unsupported %s", (_label, message, path) => {
        expect(
          rejectedPaths(TREASURY_CAPACITY_MESSAGE_SCHEMA, withValue(message, path, "XXX")),
        ).toEqual([path]);
      });

      it.each([
        ["lower case", "usd"],
        ["empty", ""],
        ["too long", "USDT"],
        ["numeric", 840],
        ["missing", undefined],
      ])("rejects a currency that is %s", (_label, currency) => {
        expect(
          rejectedPaths(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(programUpserted, "payload.currency", currency),
          ),
        ).toEqual(["payload.currency"]);
      });
    });

    describe("amounts", () => {
      const AMOUNT_FIELDS: [string, object, string][] = [
        ["credit limit", programUpserted, "payload.creditLimit"],
        ["invoice amount", capacityReserved, "payload.invoiceAmount"],
        ["program amount", capacityReserved, "payload.programAmount"],
        ["released amount", capacityReleased, "payload.amount"],
        ["reconciled credit limit", programReconciled, "payload.creditLimit"],
        ["total outstanding", programReconciled, "payload.totalOutstanding"],
        ["position invoice amount", programReconciled, "payload.positions.0.invoiceAmount"],
        [
          "position outstanding invoice amount",
          programReconciled,
          "payload.positions.0.outstandingInvoiceAmount",
        ],
        [
          "position outstanding program amount",
          programReconciled,
          "payload.positions.0.outstandingProgramAmount",
        ],
      ];

      it.each(AMOUNT_FIELDS)("rejects a malformed %s", (_label, message, path) => {
        expect(
          rejectedPaths(TREASURY_CAPACITY_MESSAGE_SCHEMA, withValue(message, path, "12.3456")),
        ).toEqual([path]);
      });

      it.each([
        ["with a thousands separator", "1,000.00"],
        ["negative", "-5.00"],
        ["in exponent notation", "1e3"],
        ["with more than three decimals", "12.3456"],
        ["without a whole part", ".50"],
        ["without decimals after the point", "5."],
        ["with surrounding space", " 5.00"],
        ["with more than fifteen whole digits", "1234567890123456"],
        ["empty", ""],
        ["a number rather than text", 5],
        ["missing", undefined],
      ])("rejects an amount %s", (_label, amount) => {
        expect(
          rejectedPaths(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(capacityReleased, "payload.amount", amount),
          ),
        ).toEqual(["payload.amount"]);
      });

      it.each(["0", "0.5", "100", "5.25", "1.234", "999999999999999", "999999999999999.999"])(
        "accepts the amount %s",
        (amount) => {
          expect(
            isAccepted(
              TREASURY_CAPACITY_MESSAGE_SCHEMA,
              withValue(capacityReleased, "payload.amount", amount),
            ),
          ).toBe(true);
        },
      );
    });

    describe("sequence", () => {
      it.each([
        ["not a whole number", 1.5],
        ["zero", 0],
        ["negative", -1],
        ["beyond the largest safe integer", Number.MAX_SAFE_INTEGER + 1],
        ["text", "42"],
        ["null", null],
        ["missing", undefined],
      ])("rejects a sequence that is %s", (_label, sequence) => {
        expect(
          rejectedPaths(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(capacityReleased, "sequence", sequence),
          ),
        ).toEqual(["sequence"]);
      });

      it.each([1, 42, Number.MAX_SAFE_INTEGER])("accepts the sequence %s", (sequence) => {
        expect(
          isAccepted(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(capacityReleased, "sequence", sequence),
          ),
        ).toBe(true);
      });
    });

    describe("identifiers", () => {
      it.each([
        ["eventId", capacityReleased, "eventId", 128, 129],
        ["programCode", capacityReleased, "programCode", 64, 65],
        ["invoiceId", capacityReserved, "payload.invoiceId", 128, 129],
        ["repaymentId", capacityReleased, "payload.repaymentId", 128, 129],
        ["position invoiceId", programReconciled, "payload.positions.0.invoiceId", 128, 129],
        ["program name", programUpserted, "payload.name", 200, 201],
      ])("limits %s to %i characters", (_label, message, path, longestAllowed, tooLong) => {
        expect(
          isAccepted(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(message, path, "A".repeat(longestAllowed)),
          ),
        ).toBe(true);
        expect(
          rejectedPaths(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(message, path, "A".repeat(tooLong)),
          ),
        ).toEqual([path]);
      });

      it.each([
        ["eventId", capacityReleased, "eventId"],
        ["programCode", capacityReleased, "programCode"],
        ["invoiceId", capacityReleased, "payload.invoiceId"],
        ["repaymentId", capacityReleased, "payload.repaymentId"],
        ["program name", programUpserted, "payload.name"],
      ])("rejects an empty %s", (_label, message, path) => {
        expect(
          rejectedPaths(TREASURY_CAPACITY_MESSAGE_SCHEMA, withValue(message, path, "")),
        ).toEqual([path]);
      });

      it.each([
        ["a space", "ACME USD"],
        ["a slash", "ACME/USD"],
        ["a colon", "ACME:USD"],
        ["a control character", "ACME\u0000USD"],
        ["a newline", "ACME\nUSD"],
      ])("rejects a program code with %s", (_label, programCode) => {
        expect(
          rejectedPaths(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(capacityReleased, "programCode", programCode),
          ),
        ).toEqual(["programCode"]);
      });

      it.each([
        ["a space", "INV 1"],
        ["a control character", "INV\u00001"],
        ["a backslash", "INV\\1"],
        ["a quote", 'INV"1'],
      ])("rejects an invoice id with %s", (_label, invoiceId) => {
        expect(
          rejectedPaths(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(capacityReleased, "payload.invoiceId", invoiceId),
          ),
        ).toEqual(["payload.invoiceId"]);
      });

      it.each(["INV-2026-00042", "inv_1.2:3/4", "A"])("accepts the invoice id %s", (invoiceId) => {
        expect(
          isAccepted(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(capacityReleased, "payload.invoiceId", invoiceId),
          ),
        ).toBe(true);
      });

      it.each([
        ["a control character", "Acme\u0000 Finance"],
        ["a newline", "Acme\nFinance"],
        ["a tab", "Acme\tFinance"],
      ])("rejects a program name with %s", (_label, name) => {
        expect(
          rejectedPaths(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(programUpserted, "payload.name", name),
          ),
        ).toEqual(["payload.name"]);
      });

      it("accepts a program name with accents, punctuation and other scripts", () => {
        expect(
          isAccepted(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(programUpserted, "payload.name", "Société Générale – Finance (日本) #1"),
          ),
        ).toBe(true);
      });
    });

    describe("timestamps", () => {
      it("accepts an asOf at the moment of the check", () => {
        expect(
          isAccepted(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(programReconciled, "payload.asOf", isoOffsetFromNow(0)),
          ),
        ).toBe(true);
      });

      it("accepts an asOf in the past, however old", () => {
        expect(
          isAccepted(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(programReconciled, "payload.asOf", "2020-01-01T00:00:00.000Z"),
          ),
        ).toBe(true);
      });

      it("accepts an asOf ahead of the clock by exactly the tolerance", () => {
        expect(
          isAccepted(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(
              programReconciled,
              "payload.asOf",
              isoOffsetFromNow(TREASURY_MAX_FUTURE_AS_OF_MS),
            ),
          ),
        ).toBe(true);
      });

      it("rejects an asOf ahead of the clock by more than the tolerance", () => {
        expect(
          rejectedPaths(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(
              programReconciled,
              "payload.asOf",
              isoOffsetFromNow(TREASURY_MAX_FUTURE_AS_OF_MS + 1),
            ),
          ),
        ).toEqual(["payload.asOf"]);
      });

      it("rejects an asOf a year ahead", () => {
        expect(
          rejectedPaths(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(programReconciled, "payload.asOf", "2027-11-03T10:00:00.000Z"),
          ),
        ).toEqual(["payload.asOf"]);
      });

      it("compares the instant, not the clock reading, when the asOf carries an offset", () => {
        const insideTolerance = "2026-11-03T12:04:00+02:00";
        const outsideTolerance = "2026-11-03T12:06:00+02:00";

        expect(
          isAccepted(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(programReconciled, "payload.asOf", insideTolerance),
          ),
        ).toBe(true);
        expect(
          isAccepted(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(programReconciled, "payload.asOf", outsideTolerance),
          ),
        ).toBe(false);
      });

      it.each([
        ["without a time zone", "2026-11-03T09:58:00"],
        ["a date alone", "2026-11-03"],
        ["free text", "yesterday"],
        ["an epoch number", 1793700000000],
        ["empty", ""],
        ["missing", undefined],
      ])("rejects an asOf that is %s", (_label, asOf) => {
        expect(
          rejectedPaths(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(programReconciled, "payload.asOf", asOf),
          ),
        ).toEqual(["payload.asOf"]);
      });

      it.each([
        ["without a time zone", "2026-11-03T09:59:00"],
        ["free text", "yesterday"],
        ["a number", 1793700000000],
        ["missing", undefined],
      ])("rejects an occurredAt that is %s", (_label, occurredAt) => {
        expect(
          rejectedPaths(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(capacityReleased, "occurredAt", occurredAt),
          ),
        ).toEqual(["occurredAt"]);
      });

      it("accepts an occurredAt with an offset", () => {
        expect(
          isAccepted(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(capacityReleased, "occurredAt", "2026-11-03T11:59:00+02:00"),
          ),
        ).toBe(true);
      });
    });

    describe("positions", () => {
      it("rejects positions that are not a list", () => {
        expect(
          rejectedPaths(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(programReconciled, "payload.positions", position),
          ),
        ).toEqual(["payload.positions"]);
      });

      it("rejects a reconciliation whose positions are missing", () => {
        expect(
          rejectedPaths(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(programReconciled, "payload.positions", undefined),
          ),
        ).toEqual(["payload.positions"]);
      });

      it("rejects the whole reconciliation when one of many positions is malformed", () => {
        const many = withValue(
          programReconciled,
          "payload.positions",
          Array.from({ length: 50 }, (_, index) => ({ ...position, invoiceId: `INV-${index}` })),
        );

        expect(isAccepted(TREASURY_CAPACITY_MESSAGE_SCHEMA, many)).toBe(true);
        expect(
          rejectedPaths(
            TREASURY_CAPACITY_MESSAGE_SCHEMA,
            withValue(many, "payload.positions.37.outstandingProgramAmount", "-1.00"),
          ),
        ).toEqual(["payload.positions.37.outstandingProgramAmount"]);
      });
    });

    describe("required fields", () => {
      it.each([
        ["eventId", capacityReleased, "eventId"],
        ["programCode", capacityReleased, "programCode"],
        ["sequence", capacityReleased, "sequence"],
        ["occurredAt", capacityReleased, "occurredAt"],
        ["payload", capacityReleased, "payload"],
        ["program name", programUpserted, "payload.name"],
        ["credit limit", programUpserted, "payload.creditLimit"],
        ["invoice id of a reservation", capacityReserved, "payload.invoiceId"],
        ["program amount of a reservation", capacityReserved, "payload.programAmount"],
        ["repayment id", capacityReleased, "payload.repaymentId"],
        ["reconciliation asOf", programReconciled, "payload.asOf"],
        ["reconciliation total outstanding", programReconciled, "payload.totalOutstanding"],
        [
          "position outstanding invoice amount",
          programReconciled,
          "payload.positions.0.outstandingInvoiceAmount",
        ],
      ])("rejects a message without the %s", (_label, message, path) => {
        expect(
          rejectedPaths(TREASURY_CAPACITY_MESSAGE_SCHEMA, withValue(message, path, undefined)),
        ).toEqual([path]);
      });

      it.each([
        ["null", null],
        ["a string", "PROGRAM_UPSERTED"],
        ["a list", [programUpserted]],
        ["an empty object", {}],
      ])("rejects a message that is %s", (_label, message) => {
        expect(isAccepted(TREASURY_CAPACITY_MESSAGE_SCHEMA, message)).toBe(false);
      });
    });
  });

  describe("FX rate messages", () => {
    it("accepts a valid rate as it is", () => {
      const result = TREASURY_FX_RATE_MESSAGE_SCHEMA.safeParse(fxRate);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(fxRate);
    });

    it("drops fields it does not define", () => {
      const result = TREASURY_FX_RATE_MESSAGE_SCHEMA.safeParse({ ...fxRate, source: "bank" });

      expect(result.data).toEqual(fxRate);
    });

    it.each([
      ["base", "baseCurrency"],
      ["quote", "quoteCurrency"],
    ])("rejects an unsupported %s currency", (_label, path) => {
      expect(
        rejectedPaths(TREASURY_FX_RATE_MESSAGE_SCHEMA, withValue(fxRate, path, "XXX")),
      ).toEqual([path]);
    });

    it.each([
      ["lower case", "eur"],
      ["empty", ""],
      ["numeric", 978],
      ["missing", undefined],
    ])("rejects a currency that is %s", (_label, currency) => {
      expect(
        rejectedPaths(TREASURY_FX_RATE_MESSAGE_SCHEMA, withValue(fxRate, "baseCurrency", currency)),
      ).toEqual(["baseCurrency"]);
    });

    it.each(["1", "1.0812", "150.25", "0.000000000001", "999999999999.999999999999"])(
      "accepts the rate %s",
      (rate) => {
        expect(isAccepted(TREASURY_FX_RATE_MESSAGE_SCHEMA, withValue(fxRate, "rate", rate))).toBe(
          true,
        );
      },
    );

    it.each([
      ["with a thousands separator", "1,081"],
      ["negative", "-1.5"],
      ["in exponent notation", "1e5"],
      ["with more than twelve decimals", "1.0000000000001"],
      ["with more than twelve whole digits", "1234567890123"],
      ["without a whole part", ".5"],
      ["with surrounding space", " 1.08"],
      ["empty", ""],
      ["a number rather than text", 1.0812],
      ["missing", undefined],
    ])("rejects a rate %s", (_label, rate) => {
      expect(
        rejectedPaths(TREASURY_FX_RATE_MESSAGE_SCHEMA, withValue(fxRate, "rate", rate)),
      ).toEqual(["rate"]);
    });

    it.each(["0", "00", "0.0", "0.000000000000"])("rejects the zero rate %s", (rate) => {
      expect(
        rejectedPaths(TREASURY_FX_RATE_MESSAGE_SCHEMA, withValue(fxRate, "rate", rate)),
      ).toEqual(["rate"]);
    });

    it("accepts an asOf ahead of the clock by exactly the tolerance", () => {
      expect(
        isAccepted(
          TREASURY_FX_RATE_MESSAGE_SCHEMA,
          withValue(fxRate, "asOf", isoOffsetFromNow(TREASURY_MAX_FUTURE_AS_OF_MS)),
        ),
      ).toBe(true);
    });

    it("rejects an asOf ahead of the clock by more than the tolerance", () => {
      expect(
        rejectedPaths(
          TREASURY_FX_RATE_MESSAGE_SCHEMA,
          withValue(fxRate, "asOf", isoOffsetFromNow(TREASURY_MAX_FUTURE_AS_OF_MS + 1)),
        ),
      ).toEqual(["asOf"]);
    });

    it.each([
      ["without a time zone", "2026-11-03T09:58:00"],
      ["free text", "yesterday"],
      ["missing", undefined],
    ])("rejects an asOf that is %s", (_label, asOf) => {
      expect(
        rejectedPaths(TREASURY_FX_RATE_MESSAGE_SCHEMA, withValue(fxRate, "asOf", asOf)),
      ).toEqual(["asOf"]);
    });
  });
});
