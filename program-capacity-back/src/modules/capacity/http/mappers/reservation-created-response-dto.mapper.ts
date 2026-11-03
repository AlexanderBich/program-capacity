import { ReservationResult } from "@/modules/capacity/capacity.types";
import { ReservationCreatedResponseDto } from "@/modules/capacity/http/dto/reservation-created-response.dto";
import { ProgramAvailabilityResponseDtoMapper } from "@/modules/capacity/http/mappers/program-availability-response-dto.mapper";
import { ReservationResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-response-dto.mapper";

export class ReservationCreatedResponseDtoMapper {
  static mapFromReservationResult(result: ReservationResult): ReservationCreatedResponseDto {
    return {
      reservation: ReservationResponseDtoMapper.mapFromReservationEntity(result.reservation),
      availability: ProgramAvailabilityResponseDtoMapper.mapFromProgramEntity(result.program),
      isIdempotentReplay: result.isIdempotentReplay,
    };
  }
}
