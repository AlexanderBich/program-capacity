import { ApiProperty } from "@nestjs/swagger";
import { CapacityChangeSource, ReservationStatus } from "@/modules/capacity/capacity.enums";
import { ReservationFxResponseDto } from "@/modules/capacity/http/dto/reservation-fx-response.dto";

export class ReservationResponseDto {
  @ApiProperty({ format: "uuid" })
  id: string;

  @ApiProperty({ format: "uuid" })
  programId: string;

  @ApiProperty({ example: "INV-2026-00042" })
  invoiceId: string;

  @ApiProperty({ enum: ReservationStatus })
  status: ReservationStatus;

  @ApiProperty({ enum: CapacityChangeSource })
  source: CapacityChangeSource;

  @ApiProperty({ example: "EUR" })
  invoiceCurrency: string;

  @ApiProperty({ example: "125000.00" })
  invoiceAmount: string;

  @ApiProperty({ example: "75000.00" })
  outstandingInvoiceAmount: string;

  @ApiProperty({ example: "USD" })
  programCurrency: string;

  @ApiProperty({ example: "135150.00" })
  programAmount: string;

  @ApiProperty({
    example: "81090.00",
    description: "What this reservation holds of the program now.",
  })
  outstandingProgramAmount: string;

  @ApiProperty({
    type: ReservationFxResponseDto,
    nullable: true,
    description: "Null when the invoice and the program share a currency.",
  })
  fx: ReservationFxResponseDto | null;

  @ApiProperty({ example: "2026-11-01T12:00:00.000Z" })
  createdAt: string;

  @ApiProperty({ example: "2026-11-01T12:30:00.000Z" })
  updatedAt: string;
}

export class ReservationListResponseDto {
  @ApiProperty({ type: ReservationResponseDto, isArray: true })
  items: ReservationResponseDto[];

  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
