import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ProgramListResponseDto } from "@/modules/capacity/http/dto/program-response.dto";
import { ProgramResponseDtoMapper } from "@/modules/capacity/http/mappers/program-response-dto.mapper";

export class ProgramListResponseDtoMapper {
  static mapFromPage(params: {
    programs: ProgramEntity[];
    total: number;
    page: number;
    limit: number;
  }): ProgramListResponseDto {
    return {
      items: params.programs.map((program) =>
        ProgramResponseDtoMapper.mapFromProgramEntity(program),
      ),
      total: params.total,
      page: params.page,
      limit: params.limit,
    };
  }
}
