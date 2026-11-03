import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EntityManager } from "typeorm";
import { ProgramCurrencyMismatchError } from "@/modules/capacity/application/errors/program-currency-mismatch.error";
import { CapacityChangeService } from "@/modules/capacity/application/services/capacity-change.service";
import { ProgramLockService } from "@/modules/capacity/application/services/program-lock.service";
import { CapacityMathUtils } from "@/modules/capacity/application/utils/capacity-math.utils";
import { ReconciliationDiff } from "@/modules/capacity/application/utils/reconciliation-diff-utils.types";
import { ReconciliationDiffUtils } from "@/modules/capacity/application/utils/reconciliation-diff.utils";
import { ValidatedSnapshot } from "@/modules/capacity/application/utils/reconciliation-snapshot-utils.types";
import { ReconciliationSnapshotUtils } from "@/modules/capacity/application/utils/reconciliation-snapshot.utils";
import {
  RECONCILIATION_LOOKUP_CHUNK_SIZE,
  RECONCILIATION_WRITE_CHUNK_SIZE,
} from "@/modules/capacity/capacity.constants";
import {
  CapacityChangeSource,
  CapacityLedgerEntryType,
  ReservationStatus,
} from "@/modules/capacity/capacity.enums";
import { ReconciliationOutcome, TreasuryProgramSnapshot } from "@/modules/capacity/capacity.types";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { CapacityOutboxEventRepository } from "@/modules/capacity/infrastructure/repositories/capacity-outbox-event.repository";
import { ProgramReconciliationRepository } from "@/modules/capacity/infrastructure/repositories/program-reconciliation.repository";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";
import { ReconciliationAdjustmentRepository } from "@/modules/capacity/infrastructure/repositories/reconciliation-adjustment.repository";
import { ReservationRepository } from "@/modules/capacity/infrastructure/repositories/reservation.repository";
import { LoggerService } from "@/modules/logger/logger.service";
import { MetricsService } from "@/modules/metrics/metrics.service";

@Injectable()
export class ProgramReconciliationService {
  private readonly logger: LoggerService;

  constructor(
    private readonly config: ConfigService,
    private readonly programRepository: ProgramRepository,
    private readonly programLockService: ProgramLockService,
    private readonly reservationRepository: ReservationRepository,
    private readonly capacityOutboxEventRepository: CapacityOutboxEventRepository,
    private readonly programReconciliationRepository: ProgramReconciliationRepository,
    private readonly reconciliationAdjustmentRepository: ReconciliationAdjustmentRepository,
    private readonly capacityChangeService: CapacityChangeService,
    private readonly metricsService: MetricsService,
    private readonly baseLogger: LoggerService,
  ) {
    this.logger = this.baseLogger.forContext(ProgramReconciliationService.name);
  }

  /**
   * Brings a program to treasury's full state. Validated before the lock and diffed in memory, so all
   * the lock waits for is one read of the active book and one bulk write of what actually drifted.
   */
  async reconcile(snapshot: TreasuryProgramSnapshot): Promise<ReconciliationOutcome> {
    const validated = ReconciliationSnapshotUtils.parseAndValidateOrThrow(snapshot);
    await this.programRepository.insertIfCodeAbsent({
      code: snapshot.programCode,
      name: snapshot.name,
      currency: snapshot.currency,
      creditLimitMinor: 0n,
      reservedMinor: 0n,
      version: 0,
      lastTreasurySequence: 0,
      lastSnapshotSequence: 0,
      lastLimitSequence: 0,
      lastReconciledAt: null,
    });

    const outcome = await this.programLockService.withLockedProgramByCode(
      snapshot.programCode,
      async (manager, program) => {
        if (snapshot.sequence <= program.lastTreasurySequence) {
          this.logger.warn("Ignoring out-of-date reconciliation snapshot", {
            programCode: snapshot.programCode,
            sequence: snapshot.sequence,
            lastTreasurySequence: program.lastTreasurySequence,
          });
          return { isApplied: false, reservedDriftMinor: 0n };
        }
        if (program.currency !== snapshot.currency) {
          throw new ProgramCurrencyMismatchError(program.code, program.currency, snapshot.currency);
        }
        return this.applySnapshot(manager, program, snapshot, validated);
      },
    );

    if (outcome.reservedDriftMinor !== 0n) {
      this.logger.warn("Reconciliation corrected reserved capacity", {
        programCode: snapshot.programCode,
        driftMinor: outcome.reservedDriftMinor.toString(),
      });
    }
    this.metricsService.recordReconciliation({
      isApplied: outcome.isApplied,
      hasDrift: outcome.reservedDriftMinor !== 0n,
    });
    return outcome;
  }

  private async applySnapshot(
    manager: EntityManager,
    program: ProgramEntity,
    snapshot: TreasuryProgramSnapshot,
    validated: ValidatedSnapshot,
  ): Promise<ReconciliationOutcome> {
    const reservedBeforeMinor = program.reservedMinor;
    const creditLimitBeforeMinor = program.creditLimitMinor;

    const diff = ReconciliationDiffUtils.computeDiff({
      positions: validated.positions,
      reservations: await this.loadRelevantReservations(manager, program.id, validated),
      cutoff: await this.computeInFlightCutoff(manager, program.code, snapshot.asOf),
    });
    const adjustments = ReconciliationDiffUtils.buildAdjustments(diff);
    const adjustmentSample = ReconciliationDiffUtils.buildAdjustmentSample(diff, program.currency);
    await this.writeDiff(manager, program, diff);

    const reservedAfterMinor =
      await this.reservationRepository.sumOutstandingProgramMinorByProgramId(manager, program.id);
    const reservedDriftMinor = reservedAfterMinor - reservedBeforeMinor;

    const updatedProgram = await this.capacityChangeService.commitChange(manager, {
      program,
      type: CapacityLedgerEntryType.RECONCILED,
      source: CapacityChangeSource.TREASURY,
      actor: null,
      reservedDeltaMinor: reservedDriftMinor,
      creditLimitDeltaMinor: validated.creditLimitMinor - creditLimitBeforeMinor,
      treasurySequence: snapshot.sequence,
      snapshotSequence: snapshot.sequence,
      limitSequence: snapshot.sequence,
      reconciledAt: new Date(),
      name: snapshot.name,
    });

    const reconciliation = await this.programReconciliationRepository.create(manager, {
      programId: program.id,
      treasurySequence: snapshot.sequence,
      asOf: snapshot.asOf,
      creditLimitBeforeMinor,
      creditLimitAfterMinor: updatedProgram.creditLimitMinor,
      reservedBeforeMinor,
      reservedAfterMinor,
      positionsReceived: snapshot.positions.length,
      insertedCount: diff.toInsert.length,
      adjustedCount: diff.toAdjust.length,
      closedCount: diff.toClose.length,
      inFlightSkippedCount: diff.inFlightSkippedCount,
      adjustments: adjustmentSample,
    });
    await this.reconciliationAdjustmentRepository.createMany(
      manager,
      reconciliation.id,
      adjustments,
    );

    if (CapacityMathUtils.computeAvailableMinor(updatedProgram) < 0n) {
      this.logger.critical("Reconciliation left a program over its credit limit", {
        programCode: program.code,
        creditLimitMinor: updatedProgram.creditLimitMinor.toString(),
        reservedMinor: updatedProgram.reservedMinor.toString(),
      });
    }

    return { isApplied: true, reservedDriftMinor };
  }

  /** Active reservations, plus closed ones a position refers to (treasury may be reopening them). */
  private async loadRelevantReservations(
    manager: EntityManager,
    programId: string,
    validated: ValidatedSnapshot,
  ): Promise<ReservationEntity[]> {
    const reservations = await this.reservationRepository.findManyActiveByProgramId(
      manager,
      programId,
    );

    const activeInvoiceIds = new Set(reservations.map((reservation) => reservation.invoiceId));
    const otherInvoiceIds = validated.positions
      .map((position) => position.invoiceId)
      .filter((invoiceId) => !activeInvoiceIds.has(invoiceId));
    for (let start = 0; start < otherInvoiceIds.length; start += RECONCILIATION_LOOKUP_CHUNK_SIZE) {
      reservations.push(
        ...(await this.reservationRepository.findManyByProgramIdAndInvoiceIds(
          manager,
          programId,
          otherInvoiceIds.slice(start, start + RECONCILIATION_LOOKUP_CHUNK_SIZE),
        )),
      );
    }
    return reservations;
  }

  /**
   * What treasury can know ends at the snapshot's asOf (never later than now), and earlier if one of our
   * events did not reach it in time: still undelivered, or delivered too shortly before asOf for treasury
   * to have absorbed it. A relay outage is what makes that case real. These timestamps come from different
   * clocks and treasury takes time to process what it hears, so the grace period moves the line further
   * back. Local changes newer than the line are kept.
   */
  private async computeInFlightCutoff(
    manager: EntityManager,
    programCode: string,
    asOf: Date,
  ): Promise<Date> {
    const graceMs = this.config.getOrThrow<number>("capacity.reconciliationGraceSeconds") * 1000;
    const oldestUnabsorbed =
      await this.capacityOutboxEventRepository.findOldestCreatedAtByProgramCodeUnpublishedOrPublishedAfter(
        manager,
        programCode,
        new Date(asOf.getTime() - graceMs),
      );
    return new Date(
      Math.min(
        asOf.getTime(),
        Date.now(),
        oldestUnabsorbed?.getTime() ?? Number.POSITIVE_INFINITY,
      ) - graceMs,
    );
  }

  private async writeDiff(
    manager: EntityManager,
    program: ProgramEntity,
    diff: ReconciliationDiff,
  ): Promise<void> {
    await this.reservationRepository.createMany(
      manager,
      diff.toInsert.map((position) => ({
        programId: program.id,
        invoiceId: position.invoiceId,
        status: ReservationStatus.ACTIVE,
        source: CapacityChangeSource.TREASURY,
        invoiceCurrency: position.invoiceCurrency,
        invoiceAmountMinor: position.invoiceAmountMinor,
        outstandingInvoiceMinor: position.outstandingInvoiceMinor,
        programCurrency: program.currency,
        programAmountMinor: position.outstandingProgramMinor,
        outstandingProgramMinor: position.outstandingProgramMinor,
        fxBaseCurrency: null,
        fxQuoteCurrency: null,
        fxRate: null,
        fxRateAsOf: null,
        createdBy: null,
        lastApiChangeAt: null,
      })),
      { chunkSize: RECONCILIATION_WRITE_CHUNK_SIZE },
    );

    for (const { reservation, position } of diff.toAdjust) {
      reservation.status = ReservationStatus.ACTIVE;
      reservation.invoiceCurrency = position.invoiceCurrency;
      reservation.invoiceAmountMinor = position.invoiceAmountMinor;
      reservation.outstandingInvoiceMinor = position.outstandingInvoiceMinor;
      reservation.outstandingProgramMinor = position.outstandingProgramMinor;
      reservation.programAmountMinor =
        position.outstandingProgramMinor > reservation.programAmountMinor
          ? position.outstandingProgramMinor
          : reservation.programAmountMinor;
    }
    for (const reservation of diff.toClose) {
      reservation.status = ReservationStatus.RELEASED;
      reservation.outstandingInvoiceMinor = 0n;
      reservation.outstandingProgramMinor = 0n;
    }
    await this.reservationRepository.updateManyFromSnapshot(manager, [
      ...diff.toAdjust.map(({ reservation }) => reservation),
      ...diff.toClose,
    ]);
  }
}
