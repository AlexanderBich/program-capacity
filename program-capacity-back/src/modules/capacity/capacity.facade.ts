import { Injectable } from "@nestjs/common";
import { CapacityOutboxService } from "@/modules/capacity/application/services/capacity-outbox.service";
import { ProgramReconciliationService } from "@/modules/capacity/application/services/program-reconciliation.service";
import { TreasuryCapacitySyncService } from "@/modules/capacity/application/services/treasury-capacity-sync.service";
import {
  OutboxBacklog,
  OutboxEventForPublishing,
  ReconciliationOutcome,
  TreasuryCapacityReleased,
  TreasuryCapacityReserved,
  TreasuryProgramSnapshot,
  TreasuryProgramUpsert,
} from "@/modules/capacity/capacity.types";
import { CapacityOutboxEventRepository } from "@/modules/capacity/infrastructure/repositories/capacity-outbox-event.repository";

@Injectable()
export class CapacityFacade {
  constructor(
    private readonly treasuryCapacitySyncService: TreasuryCapacitySyncService,
    private readonly programReconciliationService: ProgramReconciliationService,
    private readonly capacityOutboxService: CapacityOutboxService,
    private readonly capacityOutboxEventRepository: CapacityOutboxEventRepository,
  ) {}

  applyTreasuryProgramUpsert(event: TreasuryProgramUpsert): Promise<void> {
    return this.treasuryCapacitySyncService.applyProgramUpsert(event);
  }

  applyTreasuryCapacityReserved(event: TreasuryCapacityReserved): Promise<void> {
    return this.treasuryCapacitySyncService.applyCapacityReserved(event);
  }

  applyTreasuryCapacityReleased(event: TreasuryCapacityReleased): Promise<void> {
    return this.treasuryCapacitySyncService.applyCapacityReleased(event);
  }

  reconcileProgram(snapshot: TreasuryProgramSnapshot): Promise<ReconciliationOutcome> {
    return this.programReconciliationService.reconcile(snapshot);
  }

  publishOldestOutboxEvents(params: {
    batchSize: number;
    publish: (events: OutboxEventForPublishing[]) => Promise<void>;
  }): Promise<number> {
    return this.capacityOutboxService.publishOldestEvents(params);
  }

  getOutboxBacklog(): Promise<OutboxBacklog> {
    return this.capacityOutboxEventRepository.findUnpublishedBacklog();
  }
}
