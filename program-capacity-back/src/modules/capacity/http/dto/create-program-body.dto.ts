import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, Matches } from "class-validator";
import {
  MONEY_AMOUNT_PATTERN,
  SUPPORTED_CURRENCIES,
} from "@/common/constants/currencies.constants";
import {
  DISPLAY_NAME_PATTERN,
  PROGRAM_CODE_PATTERN,
} from "@/common/constants/identifiers.constants";

export class CreateProgramBodyDto {
  @ApiProperty({ example: "ACME-USD", description: "Treasury's identifier for this program." })
  @IsString()
  @Matches(PROGRAM_CODE_PATTERN)
  code: string;

  @ApiProperty({ example: "Acme Supply Chain Finance" })
  @IsString()
  @Matches(DISPLAY_NAME_PATTERN)
  name: string;

  @ApiProperty({ example: "USD", enum: SUPPORTED_CURRENCIES })
  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;

  @ApiProperty({ example: "10000000.00", description: "Decimal string, in the program currency." })
  @Matches(MONEY_AMOUNT_PATTERN)
  creditLimit: string;
}
