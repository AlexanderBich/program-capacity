import { Injectable } from "@nestjs/common";
import { ReservationNotFoundError } from "@/modules/capacity/application/errors/reservation-not-found.error";
import { CapacityErrorMappingUtils } from "@/modules/capacity/http/capacity-error-mapping.utils";
import { ReservationDetailResponseDto } from "@/modules/capacity/http/dto/reservation-detail-response.dto";
import { ReservationDetailResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-detail-response-dto.mapper";
import { ReservationRepository } from "@/modules/capacity/infrastructure/repositories/reservation.repository";

@Injectable()
export class GetReservationEndpointHandler {
  constructor(private readonly reservationRepository: ReservationRepository) {}

  async handle(programId: string, reservationId: string): Promise<ReservationDetailResponseDto> {
    try {
      const reservation =
        await this.reservationRepository.findByIdAndProgramIdWithReleasesOldestFirst(
          reservationId,
          programId,
        );
      if (!reservation) {
        throw new ReservationNotFoundError(reservationId);
      }
      return ReservationDetailResponseDtoMapper.mapFromReservationEntityWithReleases(reservation);
    } catch (error) {
      CapacityErrorMappingUtils.mapToHttpOrThrow(error);
    }
  }
}
