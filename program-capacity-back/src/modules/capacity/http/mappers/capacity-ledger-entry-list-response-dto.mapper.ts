import { CapacityLedgerEntryEntity } from "@/modules/capacity/entities/capacity-ledger-entry.entity";
import { CapacityLedgerEntryListResponseDto } from "@/modules/capacity/http/dto/capacity-ledger-entry-response.dto";
import { CapacityLedgerEntryResponseDtoMapper } from "@/modules/capacity/http/mappers/capacity-ledger-entry-response-dto.mapper";

export class CapacityLedgerEntryListResponseDtoMapper {
  static mapFromPage(params: {
    entries: CapacityLedgerEntryEntity[];
    programCurrency: string;
    total: number;
    page: number;
    limit: number;
  }): CapacityLedgerEntryListResponseDto {
    return {
      items: params.entries.map((entry) =>
        CapacityLedgerEntryResponseDtoMapper.mapFromCapacityLedgerEntryEntity(
          entry,
          params.programCurrency,
        ),
      ),
      total: params.total,
      page: params.page,
      limit: params.limit,
    };
  }
}
