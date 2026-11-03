import { ApiProperty } from "@nestjs/swagger";
import { CapacityChangeSource, CapacityLedgerEntryType } from "@/modules/capacity/capacity.enums";

export class CapacityLedgerEntryResponseDto {
  @ApiProperty({ format: "uuid" })
  id: string;

  @ApiProperty({ example: 42 })
  programVersion: number;

  @ApiProperty({ enum: CapacityLedgerEntryType })
  type: CapacityLedgerEntryType;

  @ApiProperty({ enum: CapacityChangeSource })
  source: CapacityChangeSource;

  @ApiProperty({ example: "135150.00", description: "Signed change to reserved capacity." })
  reservedDelta: string;

  @ApiProperty({ example: "0.00", description: "Signed change to the credit limit." })
  creditLimitDelta: string;

  @ApiProperty({ example: "2635150.00" })
  reservedAfter: string;

  @ApiProperty({ example: "10000000.00" })
  creditLimitAfter: string;

  @ApiProperty({ type: String, nullable: true, example: "INV-2026-00042" })
  invoiceId: string | null;

  @ApiProperty({ type: String, nullable: true, example: "operator@capacity.local" })
  actor: string | null;

  @ApiProperty({ example: "2026-11-01T12:00:00.000Z" })
  createdAt: string;
}

export class CapacityLedgerEntryListResponseDto {
  @ApiProperty({ type: CapacityLedgerEntryResponseDto, isArray: true })
  items: CapacityLedgerEntryResponseDto[];

  @ApiProperty({ example: 120 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
