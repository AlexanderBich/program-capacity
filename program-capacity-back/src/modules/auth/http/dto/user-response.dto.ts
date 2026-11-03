import { ApiProperty } from "@nestjs/swagger";
import { UserRole } from "@/modules/auth/auth.enums";

export class UserResponseDto {
  @ApiProperty({ format: "uuid" })
  id: string;

  @ApiProperty({ example: "operator@capacity.local" })
  email: string;

  @ApiProperty({ enum: UserRole })
  role: UserRole;
}
