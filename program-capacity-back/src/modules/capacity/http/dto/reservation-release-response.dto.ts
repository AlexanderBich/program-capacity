import { ApiProperty } from "@nestjs/swagger";
import { CapacityChangeSource } from "@/modules/capacity/capacity.enums";

export class ReservationReleaseResponseDto {
  @ApiProperty({ format: "uuid" })
  id: string;

  @ApiProperty({ example: "RPM-2026-00017" })
  repaymentId: string;

  @ApiProperty({ enum: CapacityChangeSource })
  source: CapacityChangeSource;

  @ApiProperty({ example: "50000.00", description: "In the invoice currency." })
  invoiceAmount: string;

  @ApiProperty({ example: "54060.00", description: "Capacity freed, in the program currency." })
  programAmount: string;

  @ApiProperty({ example: "2026-11-01T12:30:00.000Z" })
  createdAt: string;
}
