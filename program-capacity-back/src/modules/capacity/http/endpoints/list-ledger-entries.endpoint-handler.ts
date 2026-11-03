import { Injectable } from "@nestjs/common";
import { PageQueryDto } from "@/common/dto/page-query.dto";
import { PaginationUtils } from "@/common/utils/pagination.utils";
import { ProgramLookupService } from "@/modules/capacity/application/services/program-lookup.service";
import { CapacityErrorMappingUtils } from "@/modules/capacity/http/capacity-error-mapping.utils";
import { CapacityLedgerEntryListResponseDto } from "@/modules/capacity/http/dto/capacity-ledger-entry-response.dto";
import { CapacityLedgerEntryListResponseDtoMapper } from "@/modules/capacity/http/mappers/capacity-ledger-entry-list-response-dto.mapper";
import { CapacityLedgerEntryRepository } from "@/modules/capacity/infrastructure/repositories/capacity-ledger-entry.repository";

@Injectable()
export class ListLedgerEntriesEndpointHandler {
  constructor(
    private readonly programLookupService: ProgramLookupService,
    private readonly capacityLedgerEntryRepository: CapacityLedgerEntryRepository,
  ) {}

  async handle(
    programId: string,
    query: PageQueryDto,
  ): Promise<CapacityLedgerEntryListResponseDto> {
    try {
      const program = await this.programLookupService.getByIdOrThrow(programId);
      const [entries, total] = await this.capacityLedgerEntryRepository.findNewestPageByProgramId({
        programId,
        limit: query.limit,
        offset: PaginationUtils.toOffset(query),
      });
      return CapacityLedgerEntryListResponseDtoMapper.mapFromPage({
        entries,
        programCurrency: program.currency,
        total,
        page: query.page,
        limit: query.limit,
      });
    } catch (error) {
      CapacityErrorMappingUtils.mapToHttpOrThrow(error);
    }
  }
}
