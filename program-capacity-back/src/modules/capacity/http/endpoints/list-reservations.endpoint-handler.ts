import { Injectable } from "@nestjs/common";
import { PaginationUtils } from "@/common/utils/pagination.utils";
import { ProgramLookupService } from "@/modules/capacity/application/services/program-lookup.service";
import { CapacityErrorMappingUtils } from "@/modules/capacity/http/capacity-error-mapping.utils";
import { ListReservationsQueryDto } from "@/modules/capacity/http/dto/list-reservations-query.dto";
import { ReservationListResponseDto } from "@/modules/capacity/http/dto/reservation-response.dto";
import { ReservationListResponseDtoMapper } from "@/modules/capacity/http/mappers/reservation-list-response-dto.mapper";
import { ReservationRepository } from "@/modules/capacity/infrastructure/repositories/reservation.repository";

@Injectable()
export class ListReservationsEndpointHandler {
  constructor(
    private readonly programLookupService: ProgramLookupService,
    private readonly reservationRepository: ReservationRepository,
  ) {}

  async handle(
    programId: string,
    query: ListReservationsQueryDto,
  ): Promise<ReservationListResponseDto> {
    try {
      await this.programLookupService.getByIdOrThrow(programId);
      const [reservations, total] = await this.reservationRepository.findNewestPageByProgramId({
        programId,
        status: query.status,
        invoiceId: query.invoiceId,
        limit: query.limit,
        offset: PaginationUtils.toOffset(query),
      });
      return ReservationListResponseDtoMapper.mapFromPage({
        reservations,
        total,
        page: query.page,
        limit: query.limit,
      });
    } catch (error) {
      CapacityErrorMappingUtils.mapToHttpOrThrow(error);
    }
  }
}
