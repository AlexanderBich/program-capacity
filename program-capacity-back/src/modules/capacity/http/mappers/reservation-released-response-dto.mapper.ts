import { ReleaseResult } from "@/modules/capacity/capacity.types";
import { ReservationReleasedResponseDto } from "@/modules/capacity/http/dto/reservation-released-response.dto";
import { ProgramAvailabilityResponseDtoMapper } from "@/modules/capacity/http/mappers/program-availability-response-dto.mapper";
import { ReservationReleaseResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-release-response-dto.mapper";
import { ReservationResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-response-dto.mapper";

export class ReservationReleasedResponseDtoMapper {
  static mapFromReleaseResult(result: ReleaseResult): ReservationReleasedResponseDto {
    return {
      reservation: ReservationResponseDtoMapper.mapFromReservationEntity(result.reservation),
      release: ReservationReleaseResponseDtoMapper.mapFromReservationReleaseEntity(
        result.release,
        result.reservation,
      ),
      availability: ProgramAvailabilityResponseDtoMapper.mapFromProgramEntity(result.program),
      isIdempotentReplay: result.isIdempotentReplay,
    };
  }
}
