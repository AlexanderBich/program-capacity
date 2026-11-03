import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ReservationListResponseDto } from "@/modules/capacity/http/dto/reservation-response.dto";
import { ReservationResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-response-dto.mapper";

export class ReservationListResponseDtoMapper {
  static mapFromPage(params: {
    reservations: ReservationEntity[];
    total: number;
    page: number;
    limit: number;
  }): ReservationListResponseDto {
    return {
      items: params.reservations.map((reservation) =>
        ReservationResponseDtoMapper.mapFromReservationEntity(reservation),
      ),
      total: params.total,
      page: params.page,
      limit: params.limit,
    };
  }
}
