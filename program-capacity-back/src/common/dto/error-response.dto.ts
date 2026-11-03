import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ErrorResponseDto {
  @ApiProperty({ example: 409 })
  statusCode: number;

  @ApiProperty({
    example: "INSUFFICIENT_CAPACITY",
    description: "Stable machine-readable identifier; safe to branch on, unlike the message.",
  })
  code: string;

  @ApiProperty({ example: "Program has insufficient available capacity" })
  message: string;

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: true,
    example: { requested: "1000.00", available: "250.00", currency: "USD" },
  })
  details?: Record<string, unknown>;
}
