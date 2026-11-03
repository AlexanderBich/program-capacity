import * as fc from "fast-check";
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

const CUTOFF = new Date("2026-11-01T12:00:00.000Z");
const RUNS = { numRuns: 500 };

type Figures = Pick<
  ParsedPosition,
  "invoiceCurrency" | "invoiceAmountMinor" | "outstandingInvoiceMinor" | "outstandingProgramMinor"
>;
type Tweak = "none" | "currency" | "invoiceAmount" | "outstandingInvoice" | "outstandingProgram";
type ReservationSeed = {
  mirrorsPosition: boolean;
  tweak: Tweak;
  status: ReservationStatus;
  figures: Figures;
  lastApiChangeAt: Date | null;
};
type Scenario = { positions: ParsedPosition[]; reservations: ReservationEntity[] };

const figures: fc.Arbitrary<Figures> = fc
  .tuple(
    fc.constantFrom("USD", "EUR"),
    fc.bigInt({ min: 1n, max: 30n }),
    fc.bigInt({ min: 1n, max: 30n }),
    fc.bigInt({ min: 1n, max: 30n }),
  )
  .map(([invoiceCurrency, first, second, outstandingProgramMinor]) => ({
    invoiceCurrency,
    invoiceAmountMinor: first > second ? first : second,
    outstandingInvoiceMinor: first > second ? second : first,
    outstandingProgramMinor,
  }));

const lastApiChangeAt = fc.constantFrom<Date | null>(
  null,
  new Date(CUTOFF.getTime() - 86_400_000),
  new Date(CUTOFF.getTime() - 1),
  CUTOFF,
  new Date(CUTOFF.getTime() + 1),
  new Date(CUTOFF.getTime() + 86_400_000),
);

const reservationSeed: fc.Arbitrary<ReservationSeed> = fc.record({
  mirrorsPosition: fc.boolean(),
  tweak: fc.constantFrom<Tweak>(
    "none",
    "none",
    "currency",
    "invoiceAmount",
    "outstandingInvoice",
    "outstandingProgram",
  ),
  status: fc.constantFrom(
    ReservationStatus.ACTIVE,
    ReservationStatus.ACTIVE,
    ReservationStatus.RELEASED,
  ),
  figures,
  lastApiChangeAt,
});

const tweaked = (base: Figures, tweak: Tweak): Figures => {
  switch (tweak) {
    case "currency":
      return { ...base, invoiceCurrency: base.invoiceCurrency === "USD" ? "EUR" : "USD" };
    case "invoiceAmount":
      return { ...base, invoiceAmountMinor: base.invoiceAmountMinor + 1n };
    case "outstandingInvoice":
      return { ...base, outstandingInvoiceMinor: base.outstandingInvoiceMinor + 1n };
    case "outstandingProgram":
      return { ...base, outstandingProgramMinor: base.outstandingProgramMinor + 1n };
    default:
      return base;
  }
};

const buildReservation = (
  invoiceId: string,
  seed: ReservationSeed,
  position: ParsedPosition | null,
): ReservationEntity => {
  const source = seed.mirrorsPosition && position ? tweaked(position, seed.tweak) : seed.figures;
  const isReleased = seed.status === ReservationStatus.RELEASED;
  return Object.assign(new ReservationEntity(), {
    id: `reservation-${invoiceId}`,
    invoiceId,
    status: seed.status,
    source: CapacityChangeSource.API,
    invoiceCurrency: source.invoiceCurrency,
    invoiceAmountMinor: source.invoiceAmountMinor,
    outstandingInvoiceMinor: isReleased ? 0n : source.outstandingInvoiceMinor,
    outstandingProgramMinor: isReleased ? 0n : source.outstandingProgramMinor,
    lastApiChangeAt: seed.lastApiChangeAt,
  });
};

const scenario: fc.Arbitrary<Scenario> = fc
  .array(
    fc.record({
      position: fc.option(figures, { nil: null }),
      reservation: fc.option(reservationSeed, { nil: null }),
    }),
    { maxLength: 15 },
  )
  .map((slots) => {
    const positions: ParsedPosition[] = [];
    const reservations: ReservationEntity[] = [];
    slots.forEach((slot, index) => {
      const invoiceId = `INV-${index}`;
      const position = slot.position ? { invoiceId, ...slot.position } : null;
      if (position) {
        positions.push(position);
      }
      if (slot.reservation) {
        reservations.push(buildReservation(invoiceId, slot.reservation, position));
      }
    });
    return { positions, reservations };
  });

const isInFlight = (reservation: ReservationEntity) =>
  reservation.lastApiChangeAt !== null && reservation.lastApiChangeAt.getTime() > CUTOFF.getTime();

const agreesWith = (reservation: ReservationEntity, position: ParsedPosition) =>
  reservation.status === ReservationStatus.ACTIVE &&
  reservation.invoiceCurrency === position.invoiceCurrency &&
  reservation.invoiceAmountMinor === position.invoiceAmountMinor &&
  reservation.outstandingInvoiceMinor === position.outstandingInvoiceMinor &&
  reservation.outstandingProgramMinor === position.outstandingProgramMinor;

type Outcome = "inserted" | "adjusted" | "matching" | "skipped";

const outcomesOf = ({ positions, reservations }: Scenario) => {
  const reservationsByInvoice = new Map(
    reservations.map((reservation) => [reservation.invoiceId, reservation]),
  );
  return positions.map((position): { position: ParsedPosition; outcome: Outcome } => {
    const reservation = reservationsByInvoice.get(position.invoiceId);
    if (!reservation) {
      return { position, outcome: "inserted" };
    }
    if (isInFlight(reservation)) {
      return { position, outcome: "skipped" };
    }
    return { position, outcome: agreesWith(reservation, position) ? "matching" : "adjusted" };
  });
};

const sortedIds = (items: { invoiceId: string }[]) => items.map((item) => item.invoiceId).sort();

const total = (reservations: ReservationEntity[]) =>
  reservations.reduce((sum, reservation) => sum + reservation.outstandingProgramMinor, 0n);

const copyOf = (reservation: ReservationEntity) =>
  Object.assign(new ReservationEntity(), reservation);

const applyDiff = (reservations: ReservationEntity[], diff: ReconciliationDiff) => {
  const book = reservations.map(copyOf);
  const byInvoice = new Map(book.map((reservation) => [reservation.invoiceId, reservation]));
  for (const { reservation, position } of diff.toAdjust) {
    Object.assign(byInvoice.get(reservation.invoiceId) as ReservationEntity, {
      status: ReservationStatus.ACTIVE,
      invoiceCurrency: position.invoiceCurrency,
      invoiceAmountMinor: position.invoiceAmountMinor,
      outstandingInvoiceMinor: position.outstandingInvoiceMinor,
      outstandingProgramMinor: position.outstandingProgramMinor,
    });
  }
  for (const reservation of diff.toClose) {
    Object.assign(byInvoice.get(reservation.invoiceId) as ReservationEntity, {
      status: ReservationStatus.RELEASED,
      outstandingInvoiceMinor: 0n,
      outstandingProgramMinor: 0n,
    });
  }
  for (const position of diff.toInsert) {
    book.push(
      Object.assign(new ReservationEntity(), {
        invoiceId: position.invoiceId,
        status: ReservationStatus.ACTIVE,
        invoiceCurrency: position.invoiceCurrency,
        invoiceAmountMinor: position.invoiceAmountMinor,
        outstandingInvoiceMinor: position.outstandingInvoiceMinor,
        outstandingProgramMinor: position.outstandingProgramMinor,
        lastApiChangeAt: null,
      }),
    );
  }
  return book;
};

const diffOf = ({ positions, reservations }: Scenario) =>
  ReconciliationDiffUtils.computeDiff({ positions, reservations, cutoff: CUTOFF });

describe("ReconciliationDiffUtils properties", () => {
  describe("computeDiff", () => {
    it("never touches a reservation that was changed after the cutoff", () => {
      fc.assert(
        fc.property(scenario, (subject) => {
          const reservationsBefore = subject.reservations.map(copyOf);
          const positionsBefore = subject.positions.map((position) => ({ ...position }));

          const diff = diffOf(subject);

          const inFlight = subject.reservations.filter(isInFlight);
          const adjusted = diff.toAdjust.map((change) => change.reservation);
          const inserted = diff.toInsert.map((position) => position.invoiceId);
          for (const reservation of inFlight) {
            expect(diff.toClose).not.toContain(reservation);
            expect(adjusted).not.toContain(reservation);
            expect(inserted).not.toContain(reservation.invoiceId);
          }
          expect(diff.inFlightSkippedCount).toBe(inFlight.length);
          expect(subject.reservations).toEqual(reservationsBefore);
          expect(subject.positions).toEqual(positionsBefore);
        }),
        RUNS,
      );
    });

    it("puts every position in exactly one place: inserted, adjusted, matching or skipped", () => {
      fc.assert(
        fc.property(scenario, (subject) => {
          const diff = diffOf(subject);

          const outcomes = outcomesOf(subject);
          const withOutcome = (wanted: Outcome) =>
            outcomes.filter(({ outcome }) => outcome === wanted).map(({ position }) => position);
          expect(sortedIds(diff.toInsert)).toEqual(sortedIds(withOutcome("inserted")));
          expect(sortedIds(diff.toAdjust.map((change) => change.position))).toEqual(
            sortedIds(withOutcome("adjusted")),
          );
          expect(diff.toInsert.length + diff.toAdjust.length).toBe(
            withOutcome("inserted").length + withOutcome("adjusted").length,
          );
          expect(
            diff.toInsert.length +
              diff.toAdjust.length +
              withOutcome("matching").length +
              withOutcome("skipped").length,
          ).toBe(subject.positions.length);
          for (const { reservation, position } of diff.toAdjust) {
            expect(reservation.invoiceId).toBe(position.invoiceId);
          }
        }),
        RUNS,
      );
    });

    it("closes every active reservation that treasury omits and that is not in flight, and nothing else", () => {
      fc.assert(
        fc.property(scenario, (subject) => {
          const diff = diffOf(subject);

          const listed = new Set(subject.positions.map((position) => position.invoiceId));
          const shouldClose = subject.reservations.filter(
            (reservation) =>
              reservation.status === ReservationStatus.ACTIVE &&
              !isInFlight(reservation) &&
              !listed.has(reservation.invoiceId),
          );
          expect(sortedIds(diff.toClose)).toEqual(sortedIds(shouldClose));
        }),
        RUNS,
      );
    });

    it("asks for nothing more once its changes are applied", () => {
      fc.assert(
        fc.property(scenario, (subject) => {
          const diff = diffOf(subject);

          const again = diffOf({
            positions: subject.positions,
            reservations: applyDiff(subject.reservations, diff),
          });

          expect(again.toInsert).toEqual([]);
          expect(again.toAdjust).toEqual([]);
          expect(again.toClose).toEqual([]);
          expect(again.inFlightSkippedCount).toBe(diff.inFlightSkippedCount);
        }),
        RUNS,
      );
    });

    it("leaves the reserved total at treasury's figure plus whatever is in flight", () => {
      fc.assert(
        fc.property(scenario, (subject) => {
          const diff = diffOf(subject);

          const afterwards = applyDiff(subject.reservations, diff);

          const inFlight = subject.reservations.filter(isInFlight);
          const inFlightInvoices = new Set(inFlight.map((reservation) => reservation.invoiceId));
          const treasuryKnows = subject.positions
            .filter((position) => !inFlightInvoices.has(position.invoiceId))
            .reduce((sum, position) => sum + position.outstandingProgramMinor, 0n);
          expect(total(afterwards)).toBe(treasuryKnows + total(inFlight));
        }),
        RUNS,
      );
    });

    it("does not depend on the order reservations and positions come in", () => {
      fc.assert(
        fc.property(scenario, (subject) => {
          const diff = diffOf(subject);

          const reversed = diffOf({
            positions: [...subject.positions].reverse(),
            reservations: [...subject.reservations].reverse(),
          });

          expect(sortedIds(reversed.toInsert)).toEqual(sortedIds(diff.toInsert));
          expect(sortedIds(reversed.toAdjust.map((change) => change.reservation))).toEqual(
            sortedIds(diff.toAdjust.map((change) => change.reservation)),
          );
          expect(sortedIds(reversed.toClose)).toEqual(sortedIds(diff.toClose));
          expect(reversed.inFlightSkippedCount).toBe(diff.inFlightSkippedCount);
        }),
        RUNS,
      );
    });
  });

  describe("buildAdjustmentSample", () => {
    const usd = (minor: bigint) => `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;

    const diffWith = (counts: { inserted: number; adjusted: number; closed: number }) => {
      const reservation = (invoiceId: string) =>
        Object.assign(new ReservationEntity(), { invoiceId, outstandingProgramMinor: 700n });
      const position = (invoiceId: string): ParsedPosition => ({
        invoiceId,
        invoiceCurrency: "USD",
        invoiceAmountMinor: 5000n,
        outstandingInvoiceMinor: 5000n,
        outstandingProgramMinor: 5000n,
      });
      const ids = (prefix: string, count: number) =>
        Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
      return {
        toInsert: ids("NEW", counts.inserted).map(position),
        toAdjust: ids("ADJ", counts.adjusted).map((id) => ({
          reservation: reservation(id),
          position: position(id),
        })),
        toClose: ids("GONE", counts.closed).map(reservation),
        inFlightSkippedCount: 0,
      } satisfies ReconciliationDiff;
    };

    it("lists the first changes, inserted then adjusted then closed, up to the recorded maximum", () => {
      fc.assert(
        fc.property(
          fc.record({
            inserted: fc.integer({ min: 0, max: 700 }),
            adjusted: fc.integer({ min: 0, max: 700 }),
            closed: fc.integer({ min: 0, max: 700 }),
          }),
          (counts) => {
            const sample = ReconciliationDiffUtils.buildAdjustmentSample(diffWith(counts), "USD");

            const everything = [
              ...Array.from({ length: counts.inserted }, (_, index) => ({
                invoiceId: `NEW-${index}`,
                action: ReconciliationAdjustmentAction.INSERTED,
                before: "0.00",
                after: usd(5000n),
              })),
              ...Array.from({ length: counts.adjusted }, (_, index) => ({
                invoiceId: `ADJ-${index}`,
                action: ReconciliationAdjustmentAction.ADJUSTED,
                before: usd(700n),
                after: usd(5000n),
              })),
              ...Array.from({ length: counts.closed }, (_, index) => ({
                invoiceId: `GONE-${index}`,
                action: ReconciliationAdjustmentAction.CLOSED,
                before: usd(700n),
                after: "0.00",
              })),
            ].slice(0, RECONCILIATION_MAX_RECORDED_ADJUSTMENTS);
            expect(sample).toEqual(
              everything.map((entry) => ({
                invoiceId: entry.invoiceId,
                action: entry.action,
                outstandingProgramAmountBefore: entry.before,
                outstandingProgramAmountAfter: entry.after,
              })),
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    it("describes only changes the diff makes, one entry each", () => {
      fc.assert(
        fc.property(scenario, (subject) => {
          const diff = diffOf(subject);

          const sample = ReconciliationDiffUtils.buildAdjustmentSample(diff, "USD");

          expect(sample.map((entry) => entry.invoiceId)).toEqual([
            ...diff.toInsert.map((position) => position.invoiceId),
            ...diff.toAdjust.map((change) => change.reservation.invoiceId),
            ...diff.toClose.map((reservation) => reservation.invoiceId),
          ]);
        }),
        RUNS,
      );
    });
  });
});
