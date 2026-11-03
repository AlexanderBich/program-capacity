import { UserEntity } from "@/modules/auth/entities/user.entity";
import { UserResponseDto } from "@/modules/auth/http/dto/user-response.dto";

export class UserResponseDtoMapper {
  static mapFromUserEntity(user: UserEntity): UserResponseDto {
    return { id: user.id, email: user.email, role: user.role };
  }
}
