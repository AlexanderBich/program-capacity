import { Injectable } from "@nestjs/common";
import { PageQueryDto } from "@/common/dto/page-query.dto";
import { PaginationUtils } from "@/common/utils/pagination.utils";
import { ProgramListResponseDto } from "@/modules/capacity/http/dto/program-response.dto";
import { ProgramListResponseDtoMapper } from "@/modules/capacity/http/mappers/program-list-response-dto.mapper";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";

@Injectable()
export class ListProgramsEndpointHandler {
  constructor(private readonly programRepository: ProgramRepository) {}

  async handle(query: PageQueryDto): Promise<ProgramListResponseDto> {
    const [programs, total] = await this.programRepository.findPageOrderedByCode({
      limit: query.limit,
      offset: PaginationUtils.toOffset(query),
    });
    return ProgramListResponseDtoMapper.mapFromPage({
      programs,
      total,
      page: query.page,
      limit: query.limit,
    });
  }
}
