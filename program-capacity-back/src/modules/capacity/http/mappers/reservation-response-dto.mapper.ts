import { MoneyUtils } from "@/common/utils/money.utils";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ReservationResponseDto } from "@/modules/capacity/http/dto/reservation-response.dto";
import { ReservationFxResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-fx-response-dto.mapper";

export class ReservationResponseDtoMapper {
  static mapFromReservationEntity(reservation: ReservationEntity): ReservationResponseDto {
    const { invoiceCurrency, programCurrency } = reservation;
    return {
      id: reservation.id,
      programId: reservation.programId,
      invoiceId: reservation.invoiceId,
      status: reservation.status,
      source: reservation.source,
      invoiceCurrency,
      invoiceAmount: MoneyUtils.formatMinorUnits(reservation.invoiceAmountMinor, invoiceCurrency),
      outstandingInvoiceAmount: MoneyUtils.formatMinorUnits(
        reservation.outstandingInvoiceMinor,
        invoiceCurrency,
      ),
      programCurrency,
      programAmount: MoneyUtils.formatMinorUnits(reservation.programAmountMinor, programCurrency),
      outstandingProgramAmount: MoneyUtils.formatMinorUnits(
        reservation.outstandingProgramMinor,
        programCurrency,
      ),
      fx: ReservationFxResponseDtoMapper.mapFromReservationEntity(reservation),
      createdAt: reservation.createdAt.toISOString(),
      updatedAt: reservation.updatedAt.toISOString(),
    };
  }
}
