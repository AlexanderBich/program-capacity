import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  auditTime,
  catchError,
  concatMap,
  defer,
  EMPTY,
  filter,
  from,
  groupBy,
  merge,
  mergeMap,
  Observable,
  ReplaySubject,
  share,
  switchMap,
} from "rxjs";
import { Nullable } from "@/common/types/common";
import { TooManyStreamsError } from "@/modules/capacity/application/errors/too-many-streams.error";
import { AVAILABILITY_STREAM_COALESCE_MS } from "@/modules/capacity/capacity.constants";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { AvailabilityChangeChannelClient } from "@/modules/capacity/infrastructure/clients/availability-change-channel.client";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";
import { LoggerService } from "@/modules/logger/logger.service";
import { MetricsService } from "@/modules/metrics/metrics.service";

@Injectable()
export class AvailabilityStreamService implements OnModuleDestroy {
  private readonly logger: LoggerService;
  // Replays, so that a stream opened while the application is shutting down ends right away as well.
  private readonly shutdownSubject = new ReplaySubject<void>(1);
  // Shared by every subscriber on this replica, so N clients never cost N row reads per change.
  private readonly liveChanges$: Observable<ProgramEntity>;

  private readonly openStreamsByUser = new Map<string, number>();

  // Streams end cleanly on shutdown, so clients reconnect to another replica right away.
  readonly shutdown$ = this.shutdownSubject.asObservable();

  constructor(
    private readonly availabilityChangeChannelClient: AvailabilityChangeChannelClient,
    private readonly programRepository: ProgramRepository,
    private readonly config: ConfigService,
    private readonly metricsService: MetricsService,
    private readonly baseLogger: LoggerService,
  ) {
    this.logger = this.baseLogger.forContext(AvailabilityStreamService.name);
    this.liveChanges$ = merge(
      this.availabilityChangeChannelClient.changes$.pipe(
        groupBy((change) => change.programId),
        mergeMap((programChanges$) =>
          programChanges$.pipe(
            auditTime(AVAILABILITY_STREAM_COALESCE_MS),
            concatMap((change) => this.loadProgramsIgnoringFailure(change.programId)),
          ),
        ),
      ),
      this.availabilityChangeChannelClient.reconnected$.pipe(
        switchMap(() => this.loadProgramsIgnoringFailure(null)),
      ),
    ).pipe(share());
  }

  onModuleDestroy(): void {
    this.shutdownSubject.next();
    this.shutdownSubject.complete();
  }

  /**
   * A stream holds a connection and a share of every change's fan-out, so one user's are bounded. Counted
   * per replica, which is what they cost. The returned function gives the place back when the stream ends.
   */
  admitStreamOrThrow(userId: string): () => void {
    const maxStreams = this.config.getOrThrow<number>("capacity.maxStreamsPerUser");
    const openStreams = this.openStreamsByUser.get(userId) ?? 0;
    if (openStreams >= maxStreams) {
      throw new TooManyStreamsError(userId, maxStreams);
    }

    this.openStreamsByUser.set(userId, openStreams + 1);
    this.metricsService.incrementOpenAvailabilityStreams();
    return () => {
      const remaining = (this.openStreamsByUser.get(userId) ?? 1) - 1;
      if (remaining === 0) {
        this.openStreamsByUser.delete(userId);
      } else {
        this.openStreamsByUser.set(userId, remaining);
      }
      this.metricsService.decrementOpenAvailabilityStreams();
    };
  }

  /**
   * Current state first, then every change. Live changes are subscribed before the baseline is read, so
   * nothing can fall between the two; an overlap is harmless because clients order by version.
   */
  watchAvailability(params: { programId: Nullable<string> }): Observable<ProgramEntity> {
    return merge(this.liveChanges$, this.loadPrograms(params.programId)).pipe(
      filter((program) => params.programId === null || program.id === params.programId),
    );
  }

  private loadPrograms(programId: Nullable<string>): Observable<ProgramEntity> {
    return defer(() =>
      programId === null
        ? this.programRepository.findManyOrderedByCode()
        : this.programRepository.findById(programId).then((program) => (program ? [program] : [])),
    ).pipe(mergeMap((programs) => from(programs)));
  }

  private loadProgramsIgnoringFailure(programId: Nullable<string>): Observable<ProgramEntity> {
    return this.loadPrograms(programId).pipe(
      catchError((error) => {
        // One lost update must not kill every open stream; the next change for this program heals it.
        this.logger.error("Could not load programs for availability stream", { error, programId });
        return EMPTY;
      }),
    );
  }
}
