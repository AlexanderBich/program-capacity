import { ApiProperty } from "@nestjs/swagger";
import { ProgramAvailabilityResponseDto } from "@/modules/capacity/http/dto/program-availability-response.dto";
import { ReservationResponseDto } from "@/modules/capacity/http/dto/reservation-response.dto";

export class ReservationCreatedResponseDto {
  @ApiProperty({ type: ReservationResponseDto })
  reservation: ReservationResponseDto;

  @ApiProperty({ type: ProgramAvailabilityResponseDto })
  availability: ProgramAvailabilityResponseDto;

  @ApiProperty({
    description: "True when this request repeated an earlier one and changed nothing.",
  })
  isIdempotentReplay: boolean;
}
