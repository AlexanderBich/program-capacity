import { Injectable } from "@nestjs/common";
import { PageQueryDto } from "@/common/dto/page-query.dto";
import { PaginationUtils } from "@/common/utils/pagination.utils";
import { ProgramLookupService } from "@/modules/capacity/application/services/program-lookup.service";
import { CapacityErrorMappingUtils } from "@/modules/capacity/http/capacity-error-mapping.utils";
import { ProgramReconciliationListResponseDto } from "@/modules/capacity/http/dto/program-reconciliation-response.dto";
import { ProgramReconciliationListResponseDtoMapper } from "@/modules/capacity/http/mappers/program-reconciliation-list-response-dto.mapper";
import { ProgramReconciliationRepository } from "@/modules/capacity/infrastructure/repositories/program-reconciliation.repository";

@Injectable()
export class ListReconciliationsEndpointHandler {
  constructor(
    private readonly programLookupService: ProgramLookupService,
    private readonly programReconciliationRepository: ProgramReconciliationRepository,
  ) {}

  async handle(
    programId: string,
    query: PageQueryDto,
  ): Promise<ProgramReconciliationListResponseDto> {
    try {
      const program = await this.programLookupService.getByIdOrThrow(programId);
      const [reconciliations, total] =
        await this.programReconciliationRepository.findNewestPageByProgramId({
          programId,
          limit: query.limit,
          offset: PaginationUtils.toOffset(query),
        });
      return ProgramReconciliationListResponseDtoMapper.mapFromPage({
        reconciliations,
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
