import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, Matches } from "class-validator";
import {
  MONEY_AMOUNT_PATTERN,
  SUPPORTED_CURRENCIES,
} from "@/common/constants/currencies.constants";
import { EXTERNAL_ID_PATTERN } from "@/common/constants/identifiers.constants";

export class CreateReservationBodyDto {
  @ApiProperty({
    example: "INV-2026-00042",
    description: "Idempotency key: repeating a request for the same invoice returns the original.",
  })
  @IsString()
  @Matches(EXTERNAL_ID_PATTERN)
  invoiceId: string;

  @ApiProperty({ example: "125000.00", description: "Decimal string, in the invoice currency." })
  @Matches(MONEY_AMOUNT_PATTERN)
  amount: string;

  @ApiProperty({ example: "EUR", enum: SUPPORTED_CURRENCIES })
  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;
}
