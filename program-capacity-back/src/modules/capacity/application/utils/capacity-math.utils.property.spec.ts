import * as fc from "fast-check";
import { CapacityMathUtils } from "@/modules/capacity/application/utils/capacity-math.utils";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";

const RUNS = { numRuns: 500 };

const programAmountMinor = fc.bigInt({ min: 1n, max: 10n ** 18n });

const repayments = fc.array(
  fc.oneof(fc.bigInt({ min: 1n, max: 100n }), fc.bigInt({ min: 1n, max: 10n ** 15n })),
  { minLength: 1, maxLength: 30 },
);

type Step = {
  releaseInvoiceMinor: bigint;
  outstandingInvoiceMinor: bigint;
  outstandingProgramMinor: bigint;
  releasedProgramMinor: bigint;
};

const repayInParts = (programAmount: bigint, parts: bigint[]) => {
  let outstandingInvoiceMinor = parts.reduce((total, part) => total + part, 0n);
  let outstandingProgramMinor = programAmount;
  const steps: Step[] = [];

  for (const releaseInvoiceMinor of parts) {
    const releasedProgramMinor = CapacityMathUtils.computeProgramAmountToRelease({
      releaseInvoiceMinor,
      outstandingInvoiceMinor,
      outstandingProgramMinor,
    });
    steps.push({
      releaseInvoiceMinor,
      outstandingInvoiceMinor,
      outstandingProgramMinor,
      releasedProgramMinor,
    });
    outstandingInvoiceMinor -= releaseInvoiceMinor;
    outstandingProgramMinor -= releasedProgramMinor;
  }

  return { steps, outstandingInvoiceMinor, outstandingProgramMinor };
};

describe("CapacityMathUtils properties", () => {
  describe("releasing a reservation in parts that add up to the invoice amount", () => {
    it("frees program amounts that add up to exactly the amount reserved", () => {
      fc.assert(
        fc.property(programAmountMinor, repayments, (programAmount, parts) => {
          const { steps } = repayInParts(programAmount, parts);

          const released = steps.reduce((total, step) => total + step.releasedProgramMinor, 0n);
          expect(released).toBe(programAmount);
        }),
        RUNS,
      );
    });

    it("never frees a negative amount or more than the reservation still holds", () => {
      fc.assert(
        fc.property(programAmountMinor, repayments, (programAmount, parts) => {
          const { steps } = repayInParts(programAmount, parts);

          for (const step of steps) {
            expect(step.releasedProgramMinor).toBeGreaterThanOrEqual(0n);
            expect(step.releasedProgramMinor).toBeLessThanOrEqual(step.outstandingProgramMinor);
          }
        }),
        RUNS,
      );
    });

    it("leaves nothing outstanding once the last repayment is in", () => {
      fc.assert(
        fc.property(programAmountMinor, repayments, (programAmount, parts) => {
          const left = repayInParts(programAmount, parts);

          expect(left.outstandingInvoiceMinor).toBe(0n);
          expect(left.outstandingProgramMinor).toBe(0n);
        }),
        RUNS,
      );
    });

    it("frees exactly what is left with the last repayment", () => {
      fc.assert(
        fc.property(programAmountMinor, repayments, (programAmount, parts) => {
          const { steps } = repayInParts(programAmount, parts);

          const last = steps[steps.length - 1];
          expect(last.releasedProgramMinor).toBe(last.outstandingProgramMinor);
        }),
        RUNS,
      );
    });

    it("keeps program capacity held for as long as part of the invoice is outstanding", () => {
      fc.assert(
        fc.property(programAmountMinor, repayments, (programAmount, parts) => {
          const { steps } = repayInParts(programAmount, parts);

          for (const step of steps) {
            const isPartial = step.releaseInvoiceMinor < step.outstandingInvoiceMinor;
            if (isPartial) {
              expect(step.outstandingProgramMinor - step.releasedProgramMinor).toBeGreaterThan(0n);
            }
          }
        }),
        RUNS,
      );
    });
  });

  describe("computeProgramAmountToRelease", () => {
    const heldByReservation = fc.tuple(
      fc.bigInt({ min: 1n, max: 10n ** 15n }),
      fc.bigInt({ min: 0n, max: 10n ** 18n }),
    );

    const repayment = heldByReservation.chain(
      ([outstandingInvoiceMinor, outstandingProgramMinor]) =>
        fc.bigInt({ min: 1n, max: outstandingInvoiceMinor }).map((releaseInvoiceMinor) => ({
          outstandingInvoiceMinor,
          outstandingProgramMinor,
          releaseInvoiceMinor,
        })),
    );

    const twoRepayments = heldByReservation.chain(
      ([outstandingInvoiceMinor, outstandingProgramMinor]) =>
        fc
          .tuple(
            fc.bigInt({ min: 1n, max: outstandingInvoiceMinor }),
            fc.bigInt({ min: 1n, max: outstandingInvoiceMinor }),
          )
          .map(([first, second]) => ({
            outstandingInvoiceMinor,
            outstandingProgramMinor,
            smallerMinor: first < second ? first : second,
            largerMinor: first < second ? second : first,
          })),
    );

    it("frees exactly the repayment's proportion of what is held, rounded down", () => {
      fc.assert(
        fc.property(repayment, (state) => {
          const released = CapacityMathUtils.computeProgramAmountToRelease(state);

          const exact = state.outstandingProgramMinor * state.releaseInvoiceMinor;
          expect(released * state.outstandingInvoiceMinor).toBeLessThanOrEqual(exact);
          expect((released + 1n) * state.outstandingInvoiceMinor).toBeGreaterThan(exact);
        }),
        RUNS,
      );
    });

    it("frees everything that is held when everything owed is repaid", () => {
      fc.assert(
        fc.property(repayment, (state) => {
          const released = CapacityMathUtils.computeProgramAmountToRelease({
            ...state,
            releaseInvoiceMinor: state.outstandingInvoiceMinor,
          });

          expect(released).toBe(state.outstandingProgramMinor);
        }),
        RUNS,
      );
    });

    it("never frees less for a larger repayment", () => {
      fc.assert(
        fc.property(twoRepayments, (state) => {
          const releasedForSmaller = CapacityMathUtils.computeProgramAmountToRelease({
            ...state,
            releaseInvoiceMinor: state.smallerMinor,
          });
          const releasedForLarger = CapacityMathUtils.computeProgramAmountToRelease({
            ...state,
            releaseInvoiceMinor: state.largerMinor,
          });

          expect(releasedForSmaller).toBeLessThanOrEqual(releasedForLarger);
        }),
        RUNS,
      );
    });
  });

  describe("computeAvailableMinor", () => {
    const program = fc
      .tuple(fc.bigInt({ min: 0n, max: 10n ** 18n }), fc.bigInt({ min: 0n, max: 10n ** 18n }))
      .map(([creditLimitMinor, reservedMinor]) =>
        Object.assign(new ProgramEntity(), { creditLimitMinor, reservedMinor }),
      );

    it("is what is left of the limit once the reserved total is taken", () => {
      fc.assert(
        fc.property(program, (subject) => {
          const available = CapacityMathUtils.computeAvailableMinor(subject);

          expect(available + subject.reservedMinor).toBe(subject.creditLimitMinor);
        }),
        RUNS,
      );
    });

    it("is negative exactly when the program is over its limit, and zero exactly when it is full", () => {
      fc.assert(
        fc.property(program, (subject) => {
          const available = CapacityMathUtils.computeAvailableMinor(subject);

          expect(available < 0n).toBe(subject.reservedMinor > subject.creditLimitMinor);
          expect(available === 0n).toBe(subject.reservedMinor === subject.creditLimitMinor);
        }),
        RUNS,
      );
    });
  });
});
