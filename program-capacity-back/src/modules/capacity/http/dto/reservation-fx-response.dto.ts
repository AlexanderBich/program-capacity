import { ApiProperty } from "@nestjs/swagger";

export class ReservationFxResponseDto {
  @ApiProperty({ example: "EUR" })
  baseCurrency: string;

  @ApiProperty({ example: "USD" })
  quoteCurrency: string;

  @ApiProperty({
    example: "1.0812",
    description: "1 base = rate quote, locked at reservation time.",
  })
  rate: string;

  @ApiProperty({ example: "2026-11-01T12:00:00.000Z" })
  asOf: string;
}
