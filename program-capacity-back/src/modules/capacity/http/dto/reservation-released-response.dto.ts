import { ApiProperty } from "@nestjs/swagger";
import { ProgramAvailabilityResponseDto } from "@/modules/capacity/http/dto/program-availability-response.dto";
import { ReservationReleaseResponseDto } from "@/modules/capacity/http/dto/reservation-release-response.dto";
import { ReservationResponseDto } from "@/modules/capacity/http/dto/reservation-response.dto";

export class ReservationReleasedResponseDto {
  @ApiProperty({ type: ReservationResponseDto })
  reservation: ReservationResponseDto;

  @ApiProperty({ type: ReservationReleaseResponseDto })
  release: ReservationReleaseResponseDto;

  @ApiProperty({ type: ProgramAvailabilityResponseDto })
  availability: ProgramAvailabilityResponseDto;

  @ApiProperty({
    description: "True when this request repeated an earlier one and changed nothing.",
  })
  isIdempotentReplay: boolean;
}
