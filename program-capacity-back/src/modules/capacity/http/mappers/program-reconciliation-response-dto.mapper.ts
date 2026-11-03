import { MoneyUtils } from "@/common/utils/money.utils";
import { ProgramReconciliationEntity } from "@/modules/capacity/entities/program-reconciliation.entity";
import { ProgramReconciliationResponseDto } from "@/modules/capacity/http/dto/program-reconciliation-response.dto";

export class ProgramReconciliationResponseDtoMapper {
  static mapFromProgramReconciliationEntity(
    reconciliation: ProgramReconciliationEntity,
    programCurrency: string,
  ): ProgramReconciliationResponseDto {
    const format = (minorUnits: bigint) => MoneyUtils.formatMinorUnits(minorUnits, programCurrency);
    return {
      id: reconciliation.id,
      treasurySequence: reconciliation.treasurySequence,
      asOf: reconciliation.asOf.toISOString(),
      creditLimitBefore: format(reconciliation.creditLimitBeforeMinor),
      creditLimitAfter: format(reconciliation.creditLimitAfterMinor),
      reservedBefore: format(reconciliation.reservedBeforeMinor),
      reservedAfter: format(reconciliation.reservedAfterMinor),
      reservedDrift: format(reconciliation.reservedAfterMinor - reconciliation.reservedBeforeMinor),
      positionsReceived: reconciliation.positionsReceived,
      insertedCount: reconciliation.insertedCount,
      adjustedCount: reconciliation.adjustedCount,
      closedCount: reconciliation.closedCount,
      inFlightSkippedCount: reconciliation.inFlightSkippedCount,
      adjustments: reconciliation.adjustments,
      createdAt: reconciliation.createdAt.toISOString(),
    };
  }
}
