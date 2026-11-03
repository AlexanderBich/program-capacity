import { ApiProperty } from "@nestjs/swagger";
import { ProgramAvailabilityResponseDto } from "@/modules/capacity/http/dto/program-availability-response.dto";

export class ProgramResponseDto {
  @ApiProperty({ format: "uuid" })
  id: string;

  @ApiProperty({ example: "ACME-USD" })
  code: string;

  @ApiProperty({ example: "Acme Supply Chain Finance" })
  name: string;

  @ApiProperty({ example: "USD" })
  currency: string;

  @ApiProperty({ type: ProgramAvailabilityResponseDto })
  availability: ProgramAvailabilityResponseDto;

  @ApiProperty({ example: "2026-11-01T09:00:00.000Z" })
  createdAt: string;
}

export class ProgramListResponseDto {
  @ApiProperty({ type: ProgramResponseDto, isArray: true })
  items: ProgramResponseDto[];

  @ApiProperty({ example: 3 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
