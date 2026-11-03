import { Nullable } from "@/common/types/common";
import { MoneyUtils } from "@/common/utils/money.utils";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ReservationFxResponseDto } from "@/modules/capacity/http/dto/reservation-fx-response.dto";

export class ReservationFxResponseDtoMapper {
  /** Null when the reservation did not need a conversion. */
  static mapFromReservationEntity(
    reservation: ReservationEntity,
  ): Nullable<ReservationFxResponseDto> {
    if (
      !reservation.fxBaseCurrency ||
      !reservation.fxQuoteCurrency ||
      !reservation.fxRate ||
      !reservation.fxRateAsOf
    ) {
      return null;
    }
    return {
      baseCurrency: reservation.fxBaseCurrency,
      quoteCurrency: reservation.fxQuoteCurrency,
      rate: MoneyUtils.trimRateTrailingZeros(reservation.fxRate),
      asOf: reservation.fxRateAsOf.toISOString(),
    };
  }
}
