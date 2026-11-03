import { ApiProperty } from "@nestjs/swagger";
import { UserResponseDto } from "@/modules/auth/http/dto/user-response.dto";

export class SessionResponseDto {
  @ApiProperty({ description: "Short-lived JWT. Send as `Authorization: Bearer <token>`." })
  accessToken: string;

  @ApiProperty({ example: "2026-11-01T12:15:00.000Z" })
  accessTokenExpiresAt: string;

  @ApiProperty({ type: UserResponseDto })
  user: UserResponseDto;
}
