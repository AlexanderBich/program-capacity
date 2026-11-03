import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsEnum, IsOptional, Matches } from "class-validator";
import { EXTERNAL_ID_PATTERN } from "@/common/constants/identifiers.constants";
import { PageQueryDto } from "@/common/dto/page-query.dto";
import { ReservationStatus } from "@/modules/capacity/capacity.enums";

export class ListReservationsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ReservationStatus })
  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;

  @ApiPropertyOptional({ example: "INV-2026-00042", description: "Exact invoice id." })
  @IsOptional()
  @Matches(EXTERNAL_ID_PATTERN)
  invoiceId?: string;
}
