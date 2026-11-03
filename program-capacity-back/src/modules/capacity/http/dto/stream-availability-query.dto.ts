import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsUUID } from "class-validator";

export class StreamAvailabilityQueryDto {
  @ApiPropertyOptional({
    format: "uuid",
    description: "Only this program. Without it, the stream covers every program.",
  })
  @IsOptional()
  @IsUUID()
  programId?: string;
}
