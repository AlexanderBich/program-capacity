import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ReservationDetailResponseDto } from "@/modules/capacity/http/dto/reservation-detail-response.dto";
import { ReservationReleaseResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-release-response-dto.mapper";
import { ReservationResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-response-dto.mapper";

export class ReservationDetailResponseDtoMapper {
  static mapFromReservationEntityWithReleases(
    reservation: ReservationEntity,
  ): ReservationDetailResponseDto {
    return {
      reservation: ReservationResponseDtoMapper.mapFromReservationEntity(reservation),
      releases: (reservation.releases ?? []).map((release) =>
        ReservationReleaseResponseDtoMapper.mapFromReservationReleaseEntity(release, reservation),
      ),
    };
  }
}
