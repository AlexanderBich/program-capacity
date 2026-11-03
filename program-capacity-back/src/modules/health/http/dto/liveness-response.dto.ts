import { ApiProperty } from "@nestjs/swagger";

export class LivenessResponseDto {
  @ApiProperty({ example: "ok" })
  status: string;
}
