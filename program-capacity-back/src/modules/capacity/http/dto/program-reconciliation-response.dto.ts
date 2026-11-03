import { ApiProperty } from "@nestjs/swagger";
import { ReconciliationAdjustmentResponseDto } from "@/modules/capacity/http/dto/reconciliation-adjustment-response.dto";

export class ProgramReconciliationResponseDto {
  @ApiProperty({ format: "uuid" })
  id: string;

  @ApiProperty({ example: 1042 })
  treasurySequence: number;

  @ApiProperty({
    example: "2026-11-01T12:00:00.000Z",
    description: "Treasury's state as of this time.",
  })
  asOf: string;

  @ApiProperty({ example: "10000000.00" })
  creditLimitBefore: string;

  @ApiProperty({ example: "10000000.00" })
  creditLimitAfter: string;

  @ApiProperty({ example: "2635150.00" })
  reservedBefore: string;

  @ApiProperty({ example: "2635400.00" })
  reservedAfter: string;

  @ApiProperty({ example: "250.00", description: "Signed correction to reserved capacity." })
  reservedDrift: string;

  @ApiProperty({ example: 57 })
  positionsReceived: number;

  @ApiProperty({ example: 1 })
  insertedCount: number;

  @ApiProperty({ example: 2 })
  adjustedCount: number;

  @ApiProperty({ example: 1 })
  closedCount: number;

  @ApiProperty({
    example: 3,
    description: "Reservations too recent for this snapshot to know about.",
  })
  inFlightSkippedCount: number;

  @ApiProperty({
    type: ReconciliationAdjustmentResponseDto,
    isArray: true,
    description: "Capped sample of what changed; the counts are always complete.",
  })
  adjustments: ReconciliationAdjustmentResponseDto[];

  @ApiProperty({ example: "2026-11-01T12:00:03.000Z" })
  createdAt: string;
}

export class ProgramReconciliationListResponseDto {
  @ApiProperty({ type: ProgramReconciliationResponseDto, isArray: true })
  items: ProgramReconciliationResponseDto[];

  @ApiProperty({ example: 8 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
