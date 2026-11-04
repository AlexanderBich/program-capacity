import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import { RecordedAdjustment } from "@/modules/capacity/capacity.types";
import { ReconciliationAdjustmentEntity } from "@/modules/capacity/entities/reconciliation-adjustment.entity";

@Injectable()
export class ReconciliationAdjustmentRepository {
  constructor(
    @InjectRepository(ReconciliationAdjustmentEntity)
    private readonly reconciliationAdjustmentRepositoryRaw: Repository<ReconciliationAdjustmentEntity>,
  ) {}

  /** One statement however many rows, because a program's writers are waiting behind this. */
  async createMany(
    reconciliationId: string,
    adjustments: RecordedAdjustment[],
    options?: { manager?: EntityManager },
  ): Promise<void> {
    if (adjustments.length === 0) {
      return;
    }
    const manager = options?.manager ?? this.reconciliationAdjustmentRepositoryRaw.manager;
    await manager.query(
      `INSERT INTO reconciliation_adjustments
         (reconciliation_id, invoice_id, action, outstanding_program_before_minor, outstanding_program_after_minor)
       SELECT $1, v.invoice_id, v.action, v.before_minor, v.after_minor
         FROM unnest($2::text[], $3::text[], $4::bigint[], $5::bigint[])
              AS v(invoice_id, action, before_minor, after_minor)`,
      [
        reconciliationId,
        adjustments.map((adjustment) => adjustment.invoiceId),
        adjustments.map((adjustment) => adjustment.action),
        adjustments.map((adjustment) => adjustment.outstandingProgramBeforeMinor.toString()),
        adjustments.map((adjustment) => adjustment.outstandingProgramAfterMinor.toString()),
      ],
    );
  }
}
