import { Injectable } from "@nestjs/common";
import { ProgramLookupService } from "@/modules/capacity/application/services/program-lookup.service";
import { CapacityErrorMappingUtils } from "@/modules/capacity/http/capacity-error-mapping.utils";
import { ProgramResponseDto } from "@/modules/capacity/http/dto/program-response.dto";
import { ProgramResponseDtoMapper } from "@/modules/capacity/http/mappers/program-response-dto.mapper";

@Injectable()
export class GetProgramEndpointHandler {
  constructor(private readonly programLookupService: ProgramLookupService) {}

  async handle(programId: string): Promise<ProgramResponseDto> {
    try {
      return ProgramResponseDtoMapper.mapFromProgramEntity(
        await this.programLookupService.getByIdOrThrow(programId),
      );
    } catch (error) {
      CapacityErrorMappingUtils.mapToHttpOrThrow(error);
    }
  }
}
