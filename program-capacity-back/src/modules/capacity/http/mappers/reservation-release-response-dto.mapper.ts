import { MoneyUtils } from "@/common/utils/money.utils";
import { ReservationReleaseEntity } from "@/modules/capacity/entities/reservation-release.entity";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ReservationReleaseResponseDto } from "@/modules/capacity/http/dto/reservation-release-response.dto";

export class ReservationReleaseResponseDtoMapper {
  static mapFromReservationReleaseEntity(
    release: ReservationReleaseEntity,
    reservation: ReservationEntity,
  ): ReservationReleaseResponseDto {
    return {
      id: release.id,
      repaymentId: release.repaymentId,
      source: release.source,
      invoiceAmount: MoneyUtils.formatMinorUnits(
        release.invoiceAmountMinor,
        reservation.invoiceCurrency,
      ),
      programAmount: MoneyUtils.formatMinorUnits(
        release.programAmountMinor,
        reservation.programCurrency,
      ),
      createdAt: release.createdAt.toISOString(),
    };
  }
}
