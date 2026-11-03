import { IssuedSession } from "@/modules/auth/auth.types";
import { SessionResponseDto } from "@/modules/auth/http/dto/session-response.dto";
import { UserResponseDtoMapper } from "@/modules/auth/http/mappers/user-response-dto.mapper";

export class SessionResponseDtoMapper {
  static mapFromIssuedSession(session: IssuedSession): SessionResponseDto {
    return {
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
      user: UserResponseDtoMapper.mapFromUserEntity(session.user),
    };
  }
}
