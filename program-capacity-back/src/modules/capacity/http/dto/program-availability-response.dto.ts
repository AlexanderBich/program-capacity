import { ApiProperty } from "@nestjs/swagger";

export class ProgramAvailabilityResponseDto {
  @ApiProperty({ format: "uuid" })
  programId: string;

  @ApiProperty({ example: "USD" })
  currency: string;

  @ApiProperty({ example: "10000000.00" })
  creditLimit: string;

  @ApiProperty({ example: "2500000.00" })
  reserved: string;

  @ApiProperty({
    example: "7500000.00",
    description: "Signed: negative when treasury lowered the limit below what is reserved.",
  })
  available: string;

  @ApiProperty({
    description: "Reserved exceeds the credit limit; no new reservations are accepted.",
  })
  isOverLimit: boolean;

  @ApiProperty({
    example: 42,
    description: "Increases with every change. Ignore anything older than what you already hold.",
  })
  version: number;

  @ApiProperty({ type: String, nullable: true, example: "2026-11-01T12:00:00.000Z" })
  lastReconciledAt: string | null;

  @ApiProperty({ example: "2026-11-01T12:00:05.000Z" })
  updatedAt: string;
}
