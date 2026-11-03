import { CapacityMathUtils } from "@/modules/capacity/application/utils/capacity-math.utils";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";

const buildProgram = (creditLimitMinor: bigint, reservedMinor: bigint): ProgramEntity =>
  Object.assign(new ProgramEntity(), { creditLimitMinor, reservedMinor });

describe("CapacityMathUtils", () => {
  describe("computeAvailableMinor", () => {
    it("is what the limit leaves after the reserved total", () => {
      expect(CapacityMathUtils.computeAvailableMinor(buildProgram(100000n, 25000n))).toBe(75000n);
    });

    it("is zero for a program that uses exactly its limit", () => {
      expect(CapacityMathUtils.computeAvailableMinor(buildProgram(100000n, 100000n))).toBe(0n);
    });

    it("goes negative when treasury lowered the limit below what is reserved", () => {
      expect(CapacityMathUtils.computeAvailableMinor(buildProgram(100000n, 130000n))).toBe(-30000n);
    });
  });

  describe("computeProgramAmountToRelease", () => {
    it("frees exactly the remainder on a full release", () => {
      expect(
        CapacityMathUtils.computeProgramAmountToRelease({
          releaseInvoiceMinor: 10000n,
          outstandingInvoiceMinor: 10000n,
          outstandingProgramMinor: 10813n,
        }),
      ).toBe(10813n);
    });

    it("sums to exactly what was reserved across uneven partial releases", () => {
      let outstandingInvoiceMinor = 10000n;
      let outstandingProgramMinor = 10813n;
      let released = 0n;

      for (const releaseInvoiceMinor of [3333n, 3333n, 1n, 3333n]) {
        const programAmount = CapacityMathUtils.computeProgramAmountToRelease({
          releaseInvoiceMinor,
          outstandingInvoiceMinor,
          outstandingProgramMinor,
        });
        released += programAmount;
        outstandingInvoiceMinor -= releaseInvoiceMinor;
        outstandingProgramMinor -= programAmount;
      }

      expect(outstandingInvoiceMinor).toBe(0n);
      expect(outstandingProgramMinor).toBe(0n);
      expect(released).toBe(10813n);
    });

    it("frees the share of what is held that the repayment is of what is owed", () => {
      expect(
        CapacityMathUtils.computeProgramAmountToRelease({
          releaseInvoiceMinor: 2500n,
          outstandingInvoiceMinor: 10000n,
          outstandingProgramMinor: 8000n,
        }),
      ).toBe(2000n);
    });

    it("rounds the share down, never freeing more than the repayment's proportion", () => {
      expect(
        CapacityMathUtils.computeProgramAmountToRelease({
          releaseInvoiceMinor: 3333n,
          outstandingInvoiceMinor: 10000n,
          outstandingProgramMinor: 10813n,
        }),
      ).toBe(3603n);
    });

    it("frees nothing for a repayment worth less than one minor unit of the program's currency", () => {
      expect(
        CapacityMathUtils.computeProgramAmountToRelease({
          releaseInvoiceMinor: 1n,
          outstandingInvoiceMinor: 10000n,
          outstandingProgramMinor: 67n,
        }),
      ).toBe(0n);
    });

    it("works from what the reservation still holds, not from what it started with", () => {
      expect(
        CapacityMathUtils.computeProgramAmountToRelease({
          releaseInvoiceMinor: 1000n,
          outstandingInvoiceMinor: 5000n,
          outstandingProgramMinor: 6000n,
        }),
      ).toBe(1200n);
    });
  });
});
