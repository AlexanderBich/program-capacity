import { MoneyUtils } from "@/common/utils/money.utils";
import { CapacityLedgerEntryEntity } from "@/modules/capacity/entities/capacity-ledger-entry.entity";
import { CapacityLedgerEntryResponseDto } from "@/modules/capacity/http/dto/capacity-ledger-entry-response.dto";

export class CapacityLedgerEntryResponseDtoMapper {
  static mapFromCapacityLedgerEntryEntity(
    entry: CapacityLedgerEntryEntity,
    programCurrency: string,
  ): CapacityLedgerEntryResponseDto {
    return {
      id: entry.id,
      programVersion: entry.programVersion,
      type: entry.type,
      source: entry.source,
      reservedDelta: MoneyUtils.formatMinorUnits(entry.reservedDeltaMinor, programCurrency),
      creditLimitDelta: MoneyUtils.formatMinorUnits(entry.creditLimitDeltaMinor, programCurrency),
      reservedAfter: MoneyUtils.formatMinorUnits(entry.reservedAfterMinor, programCurrency),
      creditLimitAfter: MoneyUtils.formatMinorUnits(entry.creditLimitAfterMinor, programCurrency),
      invoiceId: entry.invoiceId,
      actor: entry.actor,
      createdAt: entry.createdAt.toISOString(),
    };
  }
}
