import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import { ErrorResponseDto } from "@/common/dto/error-response.dto";
import { UserRole } from "@/modules/auth/auth.enums";
import { AuthedUser } from "@/modules/auth/auth.types";
import { CurrentUser } from "@/modules/auth/decorators/current-user.decorator";
import { Roles } from "@/modules/auth/decorators/roles.decorator";
import { CreateReservationBodyDto } from "@/modules/capacity/http/dto/create-reservation-body.dto";
import { ListReservationsQueryDto } from "@/modules/capacity/http/dto/list-reservations-query.dto";
import { ReleaseReservationBodyDto } from "@/modules/capacity/http/dto/release-reservation-body.dto";
import { ReservationCreatedResponseDto } from "@/modules/capacity/http/dto/reservation-created-response.dto";
import { ReservationDetailResponseDto } from "@/modules/capacity/http/dto/reservation-detail-response.dto";
import { ReservationReleasedResponseDto } from "@/modules/capacity/http/dto/reservation-released-response.dto";
import { ReservationListResponseDto } from "@/modules/capacity/http/dto/reservation-response.dto";
import { CreateReservationEndpointHandler } from "@/modules/capacity/http/endpoints/create-reservation.endpoint-handler";
import { GetReservationEndpointHandler } from "@/modules/capacity/http/endpoints/get-reservation.endpoint-handler";
import { ListReservationsEndpointHandler } from "@/modules/capacity/http/endpoints/list-reservations.endpoint-handler";
import { ReleaseReservationEndpointHandler } from "@/modules/capacity/http/endpoints/release-reservation.endpoint-handler";

@ApiTags("reservations")
@ApiBearerAuth("JWT")
@Controller("programs/:programId/reservations")
export class ReservationsController {
  constructor(
    private readonly listReservationsEndpointHandler: ListReservationsEndpointHandler,
    private readonly getReservationEndpointHandler: GetReservationEndpointHandler,
    private readonly createReservationEndpointHandler: CreateReservationEndpointHandler,
    private readonly releaseReservationEndpointHandler: ReleaseReservationEndpointHandler,
  ) {}

  @Get()
  @ApiOperation({ summary: "List a program's reservations, newest first" })
  @ApiOkResponse({ type: ReservationListResponseDto })
  list(
    @Param("programId", ParseUUIDPipe) programId: string,
    @Query() query: ListReservationsQueryDto,
  ): Promise<ReservationListResponseDto> {
    return this.listReservationsEndpointHandler.handle(programId, query);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({
    summary: "Reserve capacity for an approved invoice",
    description:
      "Idempotent per invoice. A different currency is converted at the latest published rate, rounded " +
      "up, and locked for the life of the reservation.",
  })
  @ApiCreatedResponse({ type: ReservationCreatedResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: "INSUFFICIENT_CAPACITY or RESERVATION_CONFLICT",
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: "INVALID_AMOUNT or FX_RATE_UNAVAILABLE",
  })
  @ApiServiceUnavailableResponse({
    type: ErrorResponseDto,
    description: "FX_RATE_STALE or PROGRAM_BUSY: safe to retry",
  })
  create(
    @Param("programId", ParseUUIDPipe) programId: string,
    @Body() body: CreateReservationBodyDto,
    @CurrentUser() user: AuthedUser,
  ): Promise<ReservationCreatedResponseDto> {
    return this.createReservationEndpointHandler.handle(programId, body, user.email);
  }

  @Get(":reservationId")
  @ApiOperation({ summary: "Get a reservation with its releases" })
  @ApiOkResponse({ type: ReservationDetailResponseDto })
  get(
    @Param("programId", ParseUUIDPipe) programId: string,
    @Param("reservationId", ParseUUIDPipe) reservationId: string,
  ): Promise<ReservationDetailResponseDto> {
    return this.getReservationEndpointHandler.handle(programId, reservationId);
  }

  @Post(":reservationId/releases")
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({
    summary: "Release capacity for a repayment",
    description:
      "Idempotent per repayment. Frees capacity at the rate locked when the invoice was reserved, so " +
      "FX moves can never leak or strand capacity. Partial releases sum to exactly what was reserved.",
  })
  @ApiCreatedResponse({ type: ReservationReleasedResponseDto })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description: "RELEASE_CONFLICT or RELEASE_EXCEEDS_OUTSTANDING",
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorResponseDto,
    description: "INVALID_AMOUNT or RELEASE_CURRENCY_MISMATCH",
  })
  release(
    @Param("programId", ParseUUIDPipe) programId: string,
    @Param("reservationId", ParseUUIDPipe) reservationId: string,
    @Body() body: ReleaseReservationBodyDto,
    @CurrentUser() user: AuthedUser,
  ): Promise<ReservationReleasedResponseDto> {
    return this.releaseReservationEndpointHandler.handle(
      { programId, reservationId },
      body,
      user.email,
    );
  }
}
