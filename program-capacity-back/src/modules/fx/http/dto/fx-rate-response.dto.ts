import { ApiProperty } from "@nestjs/swagger";

export class FxRateResponseDto {
  @ApiProperty({ example: "EUR" })
  baseCurrency: string;

  @ApiProperty({ example: "USD" })
  quoteCurrency: string;

  @ApiProperty({ example: "1.0812", description: "1 base = rate quote." })
  rate: string;

  @ApiProperty({ example: "2026-11-01T12:00:00.000Z" })
  asOf: string;

  @ApiProperty({ description: "True when the rate is too old to be reserved against." })
  isStale: boolean;
}
