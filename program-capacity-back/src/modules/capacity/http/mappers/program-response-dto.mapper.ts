import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ProgramResponseDto } from "@/modules/capacity/http/dto/program-response.dto";
import { ProgramAvailabilityResponseDtoMapper } from "@/modules/capacity/http/mappers/program-availability-response-dto.mapper";

export class ProgramResponseDtoMapper {
  static mapFromProgramEntity(program: ProgramEntity): ProgramResponseDto {
    return {
      id: program.id,
      code: program.code,
      name: program.name,
      currency: program.currency,
      availability: ProgramAvailabilityResponseDtoMapper.mapFromProgramEntity(program),
      createdAt: program.createdAt.toISOString(),
    };
  }
}
