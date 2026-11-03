import { Injectable } from "@nestjs/common";
import { ReservationReleaseService } from "@/modules/capacity/application/services/reservation-release.service";
import { CapacityErrorMappingUtils } from "@/modules/capacity/http/capacity-error-mapping.utils";
import { ReleaseReservationBodyDto } from "@/modules/capacity/http/dto/release-reservation-body.dto";
import { ReservationReleasedResponseDto } from "@/modules/capacity/http/dto/reservation-released-response.dto";
import { ReservationReleasedResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-released-response-dto.mapper";

@Injectable()
export class ReleaseReservationEndpointHandler {
  constructor(private readonly reservationReleaseService: ReservationReleaseService) {}

  async handle(
    params: { programId: string; reservationId: string },
    body: ReleaseReservationBodyDto,
    actor: string,
  ): Promise<ReservationReleasedResponseDto> {
    try {
      return ReservationReleasedResponseDtoMapper.mapFromReleaseResult(
        await this.reservationReleaseService.releaseViaApi({ ...params, ...body, actor }),
      );
    } catch (error) {
      CapacityErrorMappingUtils.mapToHttpOrThrow(error);
    }
  }
}
