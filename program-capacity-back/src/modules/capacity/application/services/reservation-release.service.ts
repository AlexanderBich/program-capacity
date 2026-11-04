import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { MoneyUtils } from "@/common/utils/money.utils";
import { ReleaseConflictError } from "@/modules/capacity/application/errors/release-conflict.error";
import { ReleaseCurrencyMismatchError } from "@/modules/capacity/application/errors/release-currency-mismatch.error";
import { ReleaseExceedsOutstandingError } from "@/modules/capacity/application/errors/release-exceeds-outstanding.error";
import { ReservationNotFoundError } from "@/modules/capacity/application/errors/reservation-not-found.error";
import { CapacityChangeService } from "@/modules/capacity/application/services/capacity-change.service";
import { ProgramLockService } from "@/modules/capacity/application/services/program-lock.service";
import { ApplyReleaseInput } from "@/modules/capacity/application/services/reservation-release-service.types";
import { CapacityMathUtils } from "@/modules/capacity/application/utils/capacity-math.utils";
import {
  CapacityChangeSource,
  CapacityLedgerEntryType,
  CapacityOutboxEventType,
  ReservationStatus,
} from "@/modules/capacity/capacity.enums";
import { ReleaseResult } from "@/modules/capacity/capacity.types";
import { ReservationReleaseRepository } from "@/modules/capacity/infrastructure/repositories/reservation-release.repository";
import { ReservationRepository } from "@/modules/capacity/infrastructure/repositories/reservation.repository";
import { MetricsService } from "@/modules/metrics/metrics.service";

@Injectable()
export class ReservationReleaseService {
  constructor(
    private readonly programLockService: ProgramLockService,
    private readonly reservationRepository: ReservationRepository,
    private readonly reservationReleaseRepository: ReservationReleaseRepository,
    private readonly capacityChangeService: CapacityChangeService,
    private readonly metricsService: MetricsService,
  ) {}

  /** Idempotent on (reservation, repayment): repeating a request frees nothing and returns the original. */
  async releaseViaApi(params: {
    programId: string;
    reservationId: string;
    repaymentId: string;
    amount: string;
    currency: string;
    actor: string;
  }): Promise<ReleaseResult> {
    const result = await this.programLockService.withLockedProgramById(
      params.programId,
      async (manager, program) => {
        const reservation = await this.reservationRepository.findByIdAndProgramId(
          params.reservationId,
          program.id,
          { manager },
        );
        if (!reservation) {
          throw new ReservationNotFoundError(params.reservationId);
        }
        if (params.currency !== reservation.invoiceCurrency) {
          throw new ReleaseCurrencyMismatchError({
            invoiceCurrency: reservation.invoiceCurrency,
            requestedCurrency: params.currency,
          });
        }
        const releaseInvoiceMinor = MoneyUtils.parsePositiveToMinorUnits(
          params.amount,
          params.currency,
        );

        const replayed = await this.reservationReleaseRepository.findByReservationIdAndRepaymentId(
          reservation.id,
          params.repaymentId,
          { manager },
        );
        if (replayed) {
          if (replayed.invoiceAmountMinor !== releaseInvoiceMinor) {
            throw new ReleaseConflictError(params.repaymentId);
          }
          return { reservation, release: replayed, program, isIdempotentReplay: true };
        }

        if (releaseInvoiceMinor > reservation.outstandingInvoiceMinor) {
          throw new ReleaseExceedsOutstandingError({
            requested: params.amount,
            outstanding: MoneyUtils.formatMinorUnits(
              reservation.outstandingInvoiceMinor,
              reservation.invoiceCurrency,
            ),
            currency: reservation.invoiceCurrency,
          });
        }

        return this.applyRelease(manager, {
          program,
          reservation,
          repaymentId: params.repaymentId,
          releaseInvoiceMinor,
          source: CapacityChangeSource.API,
          actor: params.actor,
        });
      },
    );
    this.metricsService.recordRelease(result.isIdempotentReplay ? "replayed" : "applied");
    return result;
  }

  /** The caller holds the program's row lock and has already validated the amount. */
  async applyRelease(manager: EntityManager, input: ApplyReleaseInput): Promise<ReleaseResult> {
    const { program, reservation } = input;
    const releaseProgramMinor = CapacityMathUtils.computeProgramAmountToRelease({
      releaseInvoiceMinor: input.releaseInvoiceMinor,
      outstandingInvoiceMinor: reservation.outstandingInvoiceMinor,
      outstandingProgramMinor: reservation.outstandingProgramMinor,
    });
    const isApiRelease = input.source === CapacityChangeSource.API;

    reservation.outstandingInvoiceMinor -= input.releaseInvoiceMinor;
    reservation.outstandingProgramMinor -= releaseProgramMinor;
    reservation.status =
      reservation.outstandingInvoiceMinor === 0n
        ? ReservationStatus.RELEASED
        : ReservationStatus.ACTIVE;
    reservation.lastApiChangeAt = isApiRelease ? new Date() : reservation.lastApiChangeAt;

    await this.reservationRepository.updateById(
      reservation.id,
      {
        status: reservation.status,
        outstandingInvoiceMinor: reservation.outstandingInvoiceMinor,
        outstandingProgramMinor: reservation.outstandingProgramMinor,
        lastApiChangeAt: reservation.lastApiChangeAt,
      },
      { manager },
    );

    const release = await this.reservationReleaseRepository.create(
      {
        reservationId: reservation.id,
        repaymentId: input.repaymentId,
        source: input.source,
        invoiceAmountMinor: input.releaseInvoiceMinor,
        programAmountMinor: releaseProgramMinor,
        createdBy: input.actor,
      },
      { manager },
    );

    const updatedProgram = await this.capacityChangeService.commitChange(manager, {
      program,
      type: CapacityLedgerEntryType.RELEASED,
      source: input.source,
      actor: input.actor,
      reservedDeltaMinor: -releaseProgramMinor,
      creditLimitDeltaMinor: 0n,
      reservation: { id: reservation.id, invoiceId: reservation.invoiceId },
      treasurySequence: input.treasurySequence,
      outboxEvent: isApiRelease
        ? {
            type: CapacityOutboxEventType.CAPACITY_RELEASED,
            details: {
              invoiceId: reservation.invoiceId,
              repaymentId: input.repaymentId,
              invoiceCurrency: reservation.invoiceCurrency,
              invoiceAmount: MoneyUtils.formatMinorUnits(
                input.releaseInvoiceMinor,
                reservation.invoiceCurrency,
              ),
              programCurrency: program.currency,
              programAmount: MoneyUtils.formatMinorUnits(releaseProgramMinor, program.currency),
            },
          }
        : undefined,
    });

    return { reservation, release, program: updatedProgram, isIdempotentReplay: false };
  }
}
