import { Injectable } from "@nestjs/common";
import { ProgramLookupService } from "@/modules/capacity/application/services/program-lookup.service";
import { CapacityErrorMappingUtils } from "@/modules/capacity/http/capacity-error-mapping.utils";
import { ProgramAvailabilityResponseDto } from "@/modules/capacity/http/dto/program-availability-response.dto";
import { ProgramAvailabilityResponseDtoMapper } from "@/modules/capacity/http/mappers/program-availability-response-dto.mapper";

@Injectable()
export class GetProgramAvailabilityEndpointHandler {
  constructor(private readonly programLookupService: ProgramLookupService) {}

  async handle(programId: string): Promise<ProgramAvailabilityResponseDto> {
    try {
      return ProgramAvailabilityResponseDtoMapper.mapFromProgramEntity(
        await this.programLookupService.getByIdOrThrow(programId),
      );
    } catch (error) {
      CapacityErrorMappingUtils.mapToHttpOrThrow(error);
    }
  }
}
