import { ProgramReconciliationEntity } from "@/modules/capacity/entities/program-reconciliation.entity";
import { ProgramReconciliationListResponseDto } from "@/modules/capacity/http/dto/program-reconciliation-response.dto";
import { ProgramReconciliationResponseDtoMapper } from "@/modules/capacity/http/mappers/program-reconciliation-response-dto.mapper";

export class ProgramReconciliationListResponseDtoMapper {
  static mapFromPage(params: {
    reconciliations: ProgramReconciliationEntity[];
    programCurrency: string;
    total: number;
    page: number;
    limit: number;
  }): ProgramReconciliationListResponseDto {
    return {
      items: params.reconciliations.map((reconciliation) =>
        ProgramReconciliationResponseDtoMapper.mapFromProgramReconciliationEntity(
          reconciliation,
          params.programCurrency,
        ),
      ),
      total: params.total,
      page: params.page,
      limit: params.limit,
    };
  }
}
