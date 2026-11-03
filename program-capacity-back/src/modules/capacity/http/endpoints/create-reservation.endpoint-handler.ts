import { Injectable } from "@nestjs/common";
import { ReservationService } from "@/modules/capacity/application/services/reservation.service";
import { CapacityErrorMappingUtils } from "@/modules/capacity/http/capacity-error-mapping.utils";
import { CreateReservationBodyDto } from "@/modules/capacity/http/dto/create-reservation-body.dto";
import { ReservationCreatedResponseDto } from "@/modules/capacity/http/dto/reservation-created-response.dto";
import { ReservationCreatedResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-created-response-dto.mapper";

@Injectable()
export class CreateReservationEndpointHandler {
  constructor(private readonly reservationService: ReservationService) {}

  async handle(
    programId: string,
    body: CreateReservationBodyDto,
    actor: string,
  ): Promise<ReservationCreatedResponseDto> {
    try {
      return ReservationCreatedResponseDtoMapper.mapFromReservationResult(
        await this.reservationService.reserve({ programId, ...body, actor }),
      );
    } catch (error) {
      CapacityErrorMappingUtils.mapToHttpOrThrow(error);
    }
  }
}
