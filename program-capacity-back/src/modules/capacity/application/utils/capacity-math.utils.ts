import { ProgramEntity } from "@/modules/capacity/entities/program.entity";

export class CapacityMathUtils {
  /** Signed: negative when treasury lowered the limit below what is already reserved. */
  static computeAvailableMinor(program: ProgramEntity): bigint {
    return program.creditLimitMinor - program.reservedMinor;
  }

  /**
   * How much program capacity a repayment frees, using only what the reservation still holds, never a
   * current FX rate: otherwise FX moves between reserve and release would leak or strand capacity.
   * Rounds down per release; the final release (amount == outstanding) frees exactly the remainder, so
   * partial releases always sum to precisely what was reserved.
   */
  static computeProgramAmountToRelease(params: {
    releaseInvoiceMinor: bigint;
    outstandingInvoiceMinor: bigint;
    outstandingProgramMinor: bigint;
  }): bigint {
    return (
      (params.outstandingProgramMinor * params.releaseInvoiceMinor) / params.outstandingInvoiceMinor
    );
  }
}
