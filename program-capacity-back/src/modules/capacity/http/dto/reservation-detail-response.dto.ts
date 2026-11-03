import { ApiProperty } from "@nestjs/swagger";
import { ReservationReleaseResponseDto } from "@/modules/capacity/http/dto/reservation-release-response.dto";
import { ReservationResponseDto } from "@/modules/capacity/http/dto/reservation-response.dto";

export class ReservationDetailResponseDto {
  @ApiProperty({ type: ReservationResponseDto })
  reservation: ReservationResponseDto;

  @ApiProperty({ type: ReservationReleaseResponseDto, isArray: true })
  releases: ReservationReleaseResponseDto[];
}
