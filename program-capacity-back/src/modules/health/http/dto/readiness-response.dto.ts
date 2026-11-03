import { ApiProperty } from "@nestjs/swagger";

export class ReadinessResponseDto {
  @ApiProperty({
    example: "ok",
    enum: ["ok", "degraded"],
    description: "Degraded still serves traffic: only the treasury feed is behind.",
  })
  status: "ok" | "degraded";

  @ApiProperty()
  database: boolean;

  @ApiProperty({
    description: "This replica has joined the treasury feed and no message is stuck retrying.",
  })
  treasuryFeed: boolean;
}
