import { Injectable } from "@nestjs/common";
import { ProgramCreationService } from "@/modules/capacity/application/services/program-creation.service";
import { CapacityErrorMappingUtils } from "@/modules/capacity/http/capacity-error-mapping.utils";
import { CreateProgramBodyDto } from "@/modules/capacity/http/dto/create-program-body.dto";
import { ProgramResponseDto } from "@/modules/capacity/http/dto/program-response.dto";
import { ProgramResponseDtoMapper } from "@/modules/capacity/http/mappers/program-response-dto.mapper";

@Injectable()
export class CreateProgramEndpointHandler {
  constructor(private readonly programCreationService: ProgramCreationService) {}

  async handle(body: CreateProgramBodyDto, actor: string): Promise<ProgramResponseDto> {
    try {
      return ProgramResponseDtoMapper.mapFromProgramEntity(
        await this.programCreationService.createProgram({ ...body, actor }),
      );
    } catch (error) {
      CapacityErrorMappingUtils.mapToHttpOrThrow(error);
    }
  }
}
