import {
  ParsedPosition,
  ReconciliationDiff,
} from "@/modules/capacity/application/utils/reconciliation-diff-utils.types";
import { ReconciliationDiffUtils } from "@/modules/capacity/application/utils/reconciliation-diff.utils";
import { RECONCILIATION_MAX_RECORDED_ADJUSTMENTS } from "@/modules/capacity/capacity.constants";
import {
  CapacityChangeSource,
  ReconciliationAdjustmentAction,
  ReservationStatus,
} from "@/modules/capacity/capacity.enums";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";

const cutoff = new Date("2026-11-01T12:00:00.000Z");
const beforeCutoff = new Date("2026-11-01T11:00:00.000Z");
const afterCutoff = new Date("2026-11-01T12:00:01.000Z");

const buildReservation = (overrides: Partial<ReservationEntity>): ReservationEntity =>
  Object.assign(new ReservationEntity(), {
    invoiceId: "INV-1",
    status: ReservationStatus.ACTIVE,
    source: CapacityChangeSource.API,
    invoiceCurrency: "USD",
    invoiceAmountMinor: 1000n,
    outstandingInvoiceMinor: 1000n,
    outstandingProgramMinor: 1000n,
    lastApiChangeAt: beforeCutoff,
    ...overrides,
  });

const buildPosition = (overrides: Partial<ParsedPosition> = {}): ParsedPosition => ({
  invoiceId: "INV-1",
  invoiceCurrency: "USD",
  invoiceAmountMinor: 1000n,
  outstandingInvoiceMinor: 1000n,
  outstandingProgramMinor: 1000n,
  ...overrides,
});

describe("ReconciliationDiffUtils", () => {
  describe("computeDiff", () => {
    it("changes nothing when treasury and the local state agree", () => {
      const diff = ReconciliationDiffUtils.computeDiff({
        positions: [buildPosition()],
        reservations: [buildReservation({})],
        cutoff,
      });

      expect(diff.toInsert).toHaveLength(0);
      expect(diff.toAdjust).toHaveLength(0);
      expect(diff.toClose).toHaveLength(0);
      expect(diff.inFlightSkippedCount).toBe(0);
    });

    it("inserts positions unknown locally", () => {
      const diff = ReconciliationDiffUtils.computeDiff({
        positions: [buildPosition({ invoiceId: "INV-NEW" })],
        reservations: [],
        cutoff,
      });

      expect(diff.toInsert.map((position) => position.invoiceId)).toEqual(["INV-NEW"]);
    });

    it("closes settled reservations treasury no longer reports", () => {
      const diff = ReconciliationDiffUtils.computeDiff({
        positions: [],
        reservations: [buildReservation({})],
        cutoff,
      });

      expect(diff.toClose).toHaveLength(1);
    });

    it("keeps a reservation created after the cutoff even though the snapshot omits it", () => {
      const diff = ReconciliationDiffUtils.computeDiff({
        positions: [],
        reservations: [buildReservation({ lastApiChangeAt: afterCutoff })],
        cutoff,
      });

      expect(diff.toClose).toHaveLength(0);
      expect(diff.inFlightSkippedCount).toBe(1);
    });

    it("keeps a release made after the cutoff even though the snapshot still shows the full position", () => {
      const diff = ReconciliationDiffUtils.computeDiff({
        positions: [buildPosition()],
        reservations: [
          buildReservation({
            status: ReservationStatus.RELEASED,
            outstandingInvoiceMinor: 0n,
            outstandingProgramMinor: 0n,
            lastApiChangeAt: afterCutoff,
          }),
        ],
        cutoff,
      });

      expect(diff.toAdjust).toHaveLength(0);
      expect(diff.toInsert).toHaveLength(0);
      expect(diff.inFlightSkippedCount).toBe(1);
    });

    it("adjusts when treasury re-marks a settled position", () => {
      const diff = ReconciliationDiffUtils.computeDiff({
        positions: [buildPosition({ outstandingProgramMinor: 1100n })],
        reservations: [buildReservation({})],
        cutoff,
      });

      expect(diff.toAdjust).toHaveLength(1);
    });

    it("reopens a released reservation treasury still reports as outstanding", () => {
      const diff = ReconciliationDiffUtils.computeDiff({
        positions: [buildPosition()],
        reservations: [
          buildReservation({
            status: ReservationStatus.RELEASED,
            outstandingInvoiceMinor: 0n,
            outstandingProgramMinor: 0n,
          }),
        ],
        cutoff,
      });

      expect(diff.toAdjust).toHaveLength(1);
    });

    it("treats treasury-sourced rows without an API change as settled", () => {
      const diff = ReconciliationDiffUtils.computeDiff({
        positions: [],
        reservations: [
          buildReservation({ source: CapacityChangeSource.TREASURY, lastApiChangeAt: null }),
        ],
        cutoff,
      });

      expect(diff.toClose).toHaveLength(1);
    });

    it.each([
      ["the invoice currency", { invoiceCurrency: "EUR" }],
      ["the invoice amount", { invoiceAmountMinor: 1200n }],
      ["the outstanding invoice amount", { outstandingInvoiceMinor: 900n }],
      ["the outstanding program amount", { outstandingProgramMinor: 1100n }],
    ])("adjusts a reservation that differs from treasury's position in %s", (_name, changes) => {
      const reservation = buildReservation({});
      const position = buildPosition(changes);

      const diff = ReconciliationDiffUtils.computeDiff({
        positions: [position],
        reservations: [reservation],
        cutoff,
      });

      expect(diff.toAdjust).toEqual([{ reservation, position }]);
      expect(diff.toClose).toHaveLength(0);
      expect(diff.toInsert).toHaveLength(0);
    });

    it("leaves a released reservation treasury does not report as it is", () => {
      const diff = ReconciliationDiffUtils.computeDiff({
        positions: [],
        reservations: [
          buildReservation({
            status: ReservationStatus.RELEASED,
            outstandingInvoiceMinor: 0n,
            outstandingProgramMinor: 0n,
          }),
        ],
        cutoff,
      });

      expect(diff).toEqual({ toInsert: [], toAdjust: [], toClose: [], inFlightSkippedCount: 0 });
    });

    it("treats a change made exactly at the cutoff as known to treasury, and one a millisecond later as not", () => {
      const atCutoff = buildReservation({ invoiceId: "AT", lastApiChangeAt: cutoff });
      const justAfter = buildReservation({
        invoiceId: "AFTER",
        lastApiChangeAt: new Date(cutoff.getTime() + 1),
      });

      const diff = ReconciliationDiffUtils.computeDiff({
        positions: [],
        reservations: [atCutoff, justAfter],
        cutoff,
      });

      expect(diff.toClose).toEqual([atCutoff]);
      expect(diff.inFlightSkippedCount).toBe(1);
    });

    it("does not insert a position whose reservation is in flight", () => {
      const diff = ReconciliationDiffUtils.computeDiff({
        positions: [buildPosition()],
        reservations: [
          buildReservation({
            status: ReservationStatus.RELEASED,
            outstandingInvoiceMinor: 0n,
            outstandingProgramMinor: 0n,
            lastApiChangeAt: afterCutoff,
          }),
        ],
        cutoff,
      });

      expect(diff.toInsert).toEqual([]);
    });

    it("counts every reservation in flight, whether or not treasury lists it", () => {
      const diff = ReconciliationDiffUtils.computeDiff({
        positions: [buildPosition({ invoiceId: "LISTED", outstandingProgramMinor: 5n })],
        reservations: [
          buildReservation({ invoiceId: "LISTED", lastApiChangeAt: afterCutoff }),
          buildReservation({ invoiceId: "UNLISTED", lastApiChangeAt: afterCutoff }),
        ],
        cutoff,
      });

      expect(diff.inFlightSkippedCount).toBe(2);
      expect(diff.toAdjust).toEqual([]);
      expect(diff.toClose).toEqual([]);
    });

    it("pairs each reservation with the position of its own invoice, in whatever order they come", () => {
      const first = buildReservation({ invoiceId: "INV-1" });
      const second = buildReservation({ invoiceId: "INV-2" });
      const positionOne = buildPosition({ invoiceId: "INV-1", outstandingProgramMinor: 1100n });
      const positionTwo = buildPosition({ invoiceId: "INV-2", outstandingProgramMinor: 1200n });

      const diff = ReconciliationDiffUtils.computeDiff({
        positions: [positionTwo, positionOne],
        reservations: [first, second],
        cutoff,
      });

      expect(diff.toAdjust).toEqual([
        { reservation: first, position: positionOne },
        { reservation: second, position: positionTwo },
      ]);
    });

    it("sorts every kind of difference out in one pass", () => {
      const settled = buildReservation({ invoiceId: "SETTLED" });
      const remarked = buildReservation({ invoiceId: "REMARKED" });
      const repaid = buildReservation({ invoiceId: "REPAID" });
      const inFlight = buildReservation({ invoiceId: "IN-FLIGHT", lastApiChangeAt: afterCutoff });
      const remarkedPosition = buildPosition({
        invoiceId: "REMARKED",
        outstandingProgramMinor: 900n,
      });
      const newPosition = buildPosition({ invoiceId: "NEW" });

      const diff = ReconciliationDiffUtils.computeDiff({
        positions: [buildPosition({ invoiceId: "SETTLED" }), remarkedPosition, newPosition],
        reservations: [settled, remarked, repaid, inFlight],
        cutoff,
      });

      expect(diff).toEqual({
        toInsert: [newPosition],
        toAdjust: [{ reservation: remarked, position: remarkedPosition }],
        toClose: [repaid],
        inFlightSkippedCount: 1,
      });
    });

    it("does not change the reservations or positions it is given", () => {
      const reservations = [
        buildReservation({ invoiceId: "INV-1" }),
        buildReservation({ invoiceId: "INV-2", lastApiChangeAt: afterCutoff }),
      ];
      const positions = [buildPosition({ invoiceId: "INV-1", outstandingProgramMinor: 5n })];
      const reservationsBefore = reservations.map((reservation) => ({ ...reservation }));
      const positionsBefore = positions.map((position) => ({ ...position }));

      ReconciliationDiffUtils.computeDiff({ positions, reservations, cutoff });

      expect(reservations).toEqual(reservationsBefore);
      expect(positions).toEqual(positionsBefore);
    });
  });

  describe("buildAdjustmentSample", () => {
    const emptyDiff = (): ReconciliationDiff => ({
      toInsert: [],
      toAdjust: [],
      toClose: [],
      inFlightSkippedCount: 0,
    });

    it("is empty when nothing changed", () => {
      expect(ReconciliationDiffUtils.buildAdjustmentSample(emptyDiff(), "USD")).toEqual([]);
    });

    it("lists inserted, then adjusted, then closed reservations with the program amount before and after", () => {
      const diff: ReconciliationDiff = {
        ...emptyDiff(),
        toInsert: [buildPosition({ invoiceId: "NEW", outstandingProgramMinor: 5000n })],
        toAdjust: [
          {
            reservation: buildReservation({
              invoiceId: "ADJUSTED",
              outstandingProgramMinor: 1000n,
            }),
            position: buildPosition({ invoiceId: "ADJUSTED", outstandingProgramMinor: 1100n }),
          },
        ],
        toClose: [buildReservation({ invoiceId: "CLOSED", outstandingProgramMinor: 700n })],
      };

      expect(ReconciliationDiffUtils.buildAdjustmentSample(diff, "USD")).toEqual([
        {
          invoiceId: "NEW",
          action: ReconciliationAdjustmentAction.INSERTED,
          outstandingProgramAmountBefore: "0.00",
          outstandingProgramAmountAfter: "50.00",
        },
        {
          invoiceId: "ADJUSTED",
          action: ReconciliationAdjustmentAction.ADJUSTED,
          outstandingProgramAmountBefore: "10.00",
          outstandingProgramAmountAfter: "11.00",
        },
        {
          invoiceId: "CLOSED",
          action: ReconciliationAdjustmentAction.CLOSED,
          outstandingProgramAmountBefore: "7.00",
          outstandingProgramAmountAfter: "0.00",
        },
      ]);
    });

    it.each([
      ["JPY", "0", "5000"],
      ["USD", "0.00", "50.00"],
      ["KWD", "0.000", "5.000"],
    ])("writes %s amounts with that currency's minor units", (currency, zero, amount) => {
      const diff: ReconciliationDiff = {
        ...emptyDiff(),
        toInsert: [buildPosition({ outstandingProgramMinor: 5000n })],
      };

      const [entry] = ReconciliationDiffUtils.buildAdjustmentSample(diff, currency);

      expect(entry.outstandingProgramAmountBefore).toBe(zero);
      expect(entry.outstandingProgramAmountAfter).toBe(amount);
    });

    it("keeps the first adjustments up to the recorded maximum, inserted ones first", () => {
      const diff: ReconciliationDiff = {
        ...emptyDiff(),
        toInsert: Array.from({ length: RECONCILIATION_MAX_RECORDED_ADJUSTMENTS - 1 }, (_, index) =>
          buildPosition({ invoiceId: `NEW-${index}` }),
        ),
        toAdjust: [1, 2, 3].map((index) => ({
          reservation: buildReservation({ invoiceId: `ADJUSTED-${index}` }),
          position: buildPosition({ invoiceId: `ADJUSTED-${index}`, outstandingProgramMinor: 5n }),
        })),
        toClose: [buildReservation({ invoiceId: "CLOSED-1" })],
      };

      const sample = ReconciliationDiffUtils.buildAdjustmentSample(diff, "USD");

      expect(sample).toHaveLength(RECONCILIATION_MAX_RECORDED_ADJUSTMENTS);
      expect(sample[0].invoiceId).toBe("NEW-0");
      expect(sample.at(-2)?.invoiceId).toBe(`NEW-${RECONCILIATION_MAX_RECORDED_ADJUSTMENTS - 2}`);
      expect(sample.at(-1)).toMatchObject({
        invoiceId: "ADJUSTED-1",
        action: ReconciliationAdjustmentAction.ADJUSTED,
      });
    });

    it("keeps everything when the changes are exactly as many as the maximum", () => {
      const diff: ReconciliationDiff = {
        ...emptyDiff(),
        toClose: Array.from({ length: RECONCILIATION_MAX_RECORDED_ADJUSTMENTS }, (_, index) =>
          buildReservation({ invoiceId: `CLOSED-${index}` }),
        ),
      };

      expect(ReconciliationDiffUtils.buildAdjustmentSample(diff, "USD")).toHaveLength(
        RECONCILIATION_MAX_RECORDED_ADJUSTMENTS,
      );
    });
  });

  describe("buildAdjustments", () => {
    it("lists everything the diff changes in minor units, with no cap", () => {
      const positions = Array.from(
        { length: RECONCILIATION_MAX_RECORDED_ADJUSTMENTS + 1 },
        (_, index) => ({
          invoiceId: `INV-${index}`,
          invoiceCurrency: "USD",
          invoiceAmountMinor: 100n,
          outstandingInvoiceMinor: 100n,
          outstandingProgramMinor: 100n,
        }),
      );

      const adjustments = ReconciliationDiffUtils.buildAdjustments({
        toInsert: positions,
        toAdjust: [],
        toClose: [],
        inFlightSkippedCount: 0,
      });

      expect(adjustments).toHaveLength(positions.length);
      expect(adjustments[0]).toEqual({
        invoiceId: "INV-0",
        action: ReconciliationAdjustmentAction.INSERTED,
        outstandingProgramBeforeMinor: 0n,
        outstandingProgramAfterMinor: 100n,
      });
    });
  });
});
