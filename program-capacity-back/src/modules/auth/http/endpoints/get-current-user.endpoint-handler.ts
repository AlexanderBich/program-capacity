import { Injectable } from "@nestjs/common";
import { UserNotFoundError } from "@/modules/auth/application/errors/user-not-found.error";
import { AuthErrorMappingUtils } from "@/modules/auth/http/auth-error-mapping.utils";
import { UserResponseDto } from "@/modules/auth/http/dto/user-response.dto";
import { UserResponseDtoMapper } from "@/modules/auth/http/mappers/user-response-dto.mapper";
import { UserRepository } from "@/modules/auth/infrastructure/repositories/user.repository";

@Injectable()
export class GetCurrentUserEndpointHandler {
  constructor(private readonly userRepository: UserRepository) {}

  async handle(userId: string): Promise<UserResponseDto> {
    try {
      const user = await this.userRepository.findById(userId);
      if (!user?.isActive) {
        throw new UserNotFoundError(userId);
      }
      return UserResponseDtoMapper.mapFromUserEntity(user);
    } catch (error) {
      AuthErrorMappingUtils.mapToHttpOrThrow(error);
    }
  }
}
