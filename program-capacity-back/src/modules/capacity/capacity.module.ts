import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CapacityInvariantCheckCrons } from "@/modules/capacity/application/crons/capacity-invariant-check.crons";
import { PublishedOutboxEventCleanupCrons } from "@/modules/capacity/application/crons/published-outbox-event-cleanup.crons";
import { AvailabilityStreamService } from "@/modules/capacity/application/services/availability-stream.service";
import { CapacityChangeService } from "@/modules/capacity/application/services/capacity-change.service";
import { CapacityOutboxService } from "@/modules/capacity/application/services/capacity-outbox.service";
import { ProgramCreationService } from "@/modules/capacity/application/services/program-creation.service";
import { ProgramLockService } from "@/modules/capacity/application/services/program-lock.service";
import { ProgramLookupService } from "@/modules/capacity/application/services/program-lookup.service";
import { ProgramReconciliationService } from "@/modules/capacity/application/services/program-reconciliation.service";
import { ReservationReleaseService } from "@/modules/capacity/application/services/reservation-release.service";
import { ReservationService } from "@/modules/capacity/application/services/reservation.service";
import { TreasuryCapacitySyncService } from "@/modules/capacity/application/services/treasury-capacity-sync.service";
import { CapacityFacade } from "@/modules/capacity/capacity.facade";
import { CapacityLedgerEntryEntity } from "@/modules/capacity/entities/capacity-ledger-entry.entity";
import { CapacityOutboxEventEntity } from "@/modules/capacity/entities/capacity-outbox-event.entity";
import { ProgramReconciliationEntity } from "@/modules/capacity/entities/program-reconciliation.entity";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ReconciliationAdjustmentEntity } from "@/modules/capacity/entities/reconciliation-adjustment.entity";
import { ReservationReleaseEntity } from "@/modules/capacity/entities/reservation-release.entity";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ProgramsController } from "@/modules/capacity/http/controllers/programs.controller";
import { ReservationsController } from "@/modules/capacity/http/controllers/reservations.controller";
import { CreateProgramEndpointHandler } from "@/modules/capacity/http/endpoints/create-program.endpoint-handler";
import { CreateReservationEndpointHandler } from "@/modules/capacity/http/endpoints/create-reservation.endpoint-handler";
import { GetProgramAvailabilityEndpointHandler } from "@/modules/capacity/http/endpoints/get-program-availability.endpoint-handler";
import { GetProgramEndpointHandler } from "@/modules/capacity/http/endpoints/get-program.endpoint-handler";
import { GetReservationEndpointHandler } from "@/modules/capacity/http/endpoints/get-reservation.endpoint-handler";
import { ListLedgerEntriesEndpointHandler } from "@/modules/capacity/http/endpoints/list-ledger-entries.endpoint-handler";
import { ListProgramsEndpointHandler } from "@/modules/capacity/http/endpoints/list-programs.endpoint-handler";
import { ListReconciliationsEndpointHandler } from "@/modules/capacity/http/endpoints/list-reconciliations.endpoint-handler";
import { ListReservationsEndpointHandler } from "@/modules/capacity/http/endpoints/list-reservations.endpoint-handler";
import { ReleaseReservationEndpointHandler } from "@/modules/capacity/http/endpoints/release-reservation.endpoint-handler";
import { StreamAvailabilityEndpointHandler } from "@/modules/capacity/http/endpoints/stream-availability.endpoint-handler";
import { AvailabilityChangeChannelClient } from "@/modules/capacity/infrastructure/clients/availability-change-channel.client";
import { CapacityLedgerEntryRepository } from "@/modules/capacity/infrastructure/repositories/capacity-ledger-entry.repository";
import { CapacityOutboxEventRepository } from "@/modules/capacity/infrastructure/repositories/capacity-outbox-event.repository";
import { ProgramReconciliationRepository } from "@/modules/capacity/infrastructure/repositories/program-reconciliation.repository";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";
import { ReconciliationAdjustmentRepository } from "@/modules/capacity/infrastructure/repositories/reconciliation-adjustment.repository";
import { ReservationReleaseRepository } from "@/modules/capacity/infrastructure/repositories/reservation-release.repository";
import { ReservationRepository } from "@/modules/capacity/infrastructure/repositories/reservation.repository";
import { FxModule } from "@/modules/fx/fx.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProgramEntity,
      ReservationEntity,
      ReservationReleaseEntity,
      CapacityLedgerEntryEntity,
      CapacityOutboxEventEntity,
      ProgramReconciliationEntity,
      ReconciliationAdjustmentEntity,
    ]),
    FxModule,
  ],
  controllers: [ProgramsController, ReservationsController],
  providers: [
    CapacityFacade,
    CapacityInvariantCheckCrons,
    PublishedOutboxEventCleanupCrons,
    AvailabilityStreamService,
    CapacityChangeService,
    CapacityOutboxService,
    ProgramCreationService,
    ProgramLockService,
    ProgramLookupService,
    ProgramReconciliationService,
    ReservationReleaseService,
    ReservationService,
    TreasuryCapacitySyncService,
    AvailabilityChangeChannelClient,
    CapacityLedgerEntryRepository,
    CapacityOutboxEventRepository,
    ProgramReconciliationRepository,
    ProgramRepository,
    ReconciliationAdjustmentRepository,
    ReservationReleaseRepository,
    ReservationRepository,
    CreateProgramEndpointHandler,
    CreateReservationEndpointHandler,
    GetProgramAvailabilityEndpointHandler,
    GetProgramEndpointHandler,
    GetReservationEndpointHandler,
    ListLedgerEntriesEndpointHandler,
    ListProgramsEndpointHandler,
    ListReconciliationsEndpointHandler,
    ListReservationsEndpointHandler,
    ReleaseReservationEndpointHandler,
    StreamAvailabilityEndpointHandler,
  ],
  exports: [CapacityFacade],
})
export class CapacityModule {}
