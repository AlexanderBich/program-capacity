import { Injectable, MessageEvent } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { finalize, interval, map, merge, Observable, takeUntil, timer } from "rxjs";
import { AuthedUser } from "@/modules/auth/auth.types";
import { AvailabilityStreamService } from "@/modules/capacity/application/services/availability-stream.service";
import { AVAILABILITY_SSE_EVENT, HEARTBEAT_SSE_EVENT } from "@/modules/capacity/capacity.constants";
import { CapacityErrorMappingUtils } from "@/modules/capacity/http/capacity-error-mapping.utils";
import { StreamAvailabilityQueryDto } from "@/modules/capacity/http/dto/stream-availability-query.dto";
import { ProgramAvailabilityResponseDtoMapper } from "@/modules/capacity/http/mappers/program-availability-response-dto.mapper";

@Injectable()
export class StreamAvailabilityEndpointHandler {
  constructor(
    private readonly availabilityStreamService: AvailabilityStreamService,
    private readonly config: ConfigService,
  ) {}

  handle(query: StreamAvailabilityQueryDto, user: AuthedUser): Observable<MessageEvent> {
    try {
      const releaseStream = this.availabilityStreamService.admitStreamOrThrow(user.id);
      return merge(
        this.availabilityStreamService
          .watchAvailability({ programId: query.programId ?? null })
          .pipe(
            map((program) => ({
              id: String(program.version),
              type: AVAILABILITY_SSE_EVENT,
              data: ProgramAvailabilityResponseDtoMapper.mapFromProgramEntity(program),
            })),
          ),
        // Keeps proxies from closing an idle connection and lets the client notice a dead one.
        interval(this.config.getOrThrow<number>("capacity.streamHeartbeatSeconds") * 1000).pipe(
          map(() => ({ type: HEARTBEAT_SSE_EVENT, data: {} })),
        ),
      ).pipe(
        // A stream must not outlive the credential that opened it: the client reconnects with a fresh token.
        takeUntil(
          merge(timer(user.accessTokenExpiresAt), this.availabilityStreamService.shutdown$),
        ),
        finalize(releaseStream),
      );
    } catch (error) {
      CapacityErrorMappingUtils.mapToHttpOrThrow(error);
    }
  }
}
