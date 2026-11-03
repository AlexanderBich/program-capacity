import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, Matches } from "class-validator";
import {
  MONEY_AMOUNT_PATTERN,
  SUPPORTED_CURRENCIES,
} from "@/common/constants/currencies.constants";
import { EXTERNAL_ID_PATTERN } from "@/common/constants/identifiers.constants";

export class ReleaseReservationBodyDto {
  @ApiProperty({
    example: "RPM-2026-00017",
    description: "Idempotency key: one repayment can only free capacity once.",
  })
  @IsString()
  @Matches(EXTERNAL_ID_PATTERN)
  repaymentId: string;

  @ApiProperty({ example: "50000.00", description: "Decimal string, in the invoice currency." })
  @Matches(MONEY_AMOUNT_PATTERN)
  amount: string;

  @ApiProperty({
    example: "EUR",
    enum: SUPPORTED_CURRENCIES,
    description: "Must equal the invoice currency; a guard against releasing the wrong unit.",
  })
  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;
}
