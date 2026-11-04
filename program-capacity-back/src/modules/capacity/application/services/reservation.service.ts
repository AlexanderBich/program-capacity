import { Injectable } from "@nestjs/common";
import { MoneyUtils } from "@/common/utils/money.utils";
import { InsufficientCapacityError } from "@/modules/capacity/application/errors/insufficient-capacity.error";
import { ReservationConflictError } from "@/modules/capacity/application/errors/reservation-conflict.error";
import { CapacityChangeService } from "@/modules/capacity/application/services/capacity-change.service";
import { ProgramLockService } from "@/modules/capacity/application/services/program-lock.service";
import { ProgramLookupService } from "@/modules/capacity/application/services/program-lookup.service";
import { CapacityMathUtils } from "@/modules/capacity/application/utils/capacity-math.utils";
import {
  CapacityChangeSource,
  CapacityLedgerEntryType,
  CapacityOutboxEventType,
  ReservationStatus,
} from "@/modules/capacity/capacity.enums";
import { ReservationResult } from "@/modules/capacity/capacity.types";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";
import { ReservationRepository } from "@/modules/capacity/infrastructure/repositories/reservation.repository";
import { FxFacade } from "@/modules/fx/fx.facade";
import { FxRateQuote } from "@/modules/fx/fx.types";
import { MetricsService } from "@/modules/metrics/metrics.service";

@Injectable()
export class ReservationService {
  constructor(
    private readonly programLookupService: ProgramLookupService,
    private readonly programLockService: ProgramLockService,
    private readonly reservationRepository: ReservationRepository,
    private readonly capacityChangeService: CapacityChangeService,
    private readonly fxFacade: FxFacade,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Idempotent on (program, invoice): repeating a request returns the original reservation. The FX rate
   * is read before the row lock is taken, so a lock is never held across another connection's work, and
   * replays are answered before it, so they keep working while the FX feed is down.
   */
  async reserve(params: {
    programId: string;
    invoiceId: string;
    amount: string;
    currency: string;
    actor: string;
  }): Promise<ReservationResult> {
    const invoiceAmountMinor = MoneyUtils.parsePositiveToMinorUnits(params.amount, params.currency);
    const program = await this.programLookupService.getByIdOrThrow(params.programId);

    const replayed = await this.reservationRepository.findByProgramIdAndInvoiceId(
      program.id,
      params.invoiceId,
    );
    if (replayed) {
      this.assertSameRequest(replayed, { invoiceAmountMinor, currency: params.currency });
      this.metricsService.recordReservation("replayed");
      return { reservation: replayed, program, isIdempotentReplay: true };
    }

    const fxRate =
      params.currency === program.currency
        ? null
        : await this.fxFacade.getFreshRateForPairOrThrow(params.currency, program.currency);
    const programAmountMinor = fxRate
      ? MoneyUtils.convertRoundingUp({
          amountMinor: invoiceAmountMinor,
          fromCurrency: params.currency,
          toCurrency: program.currency,
          fxRate,
        })
      : invoiceAmountMinor;

    const result = await this.programLockService.withLockedProgramById(
      params.programId,
      async (manager, lockedProgram) => {
        // The pre-check above ran without the lock; a concurrent duplicate may have won since.
        const concurrent = await this.reservationRepository.findByProgramIdAndInvoiceId(
          lockedProgram.id,
          params.invoiceId,
          { manager },
        );
        if (concurrent) {
          this.assertSameRequest(concurrent, { invoiceAmountMinor, currency: params.currency });
          return { reservation: concurrent, program: lockedProgram, isIdempotentReplay: true };
        }

        const availableMinor = CapacityMathUtils.computeAvailableMinor(lockedProgram);
        if (programAmountMinor > availableMinor) {
          this.metricsService.recordReservation("refused");
          throw new InsufficientCapacityError({
            requested: MoneyUtils.formatMinorUnits(programAmountMinor, lockedProgram.currency),
            available: MoneyUtils.formatMinorUnits(availableMinor, lockedProgram.currency),
            currency: lockedProgram.currency,
          });
        }

        const reservation = await this.reservationRepository.create(
          {
            programId: lockedProgram.id,
            invoiceId: params.invoiceId,
            status: ReservationStatus.ACTIVE,
            source: CapacityChangeSource.API,
            invoiceCurrency: params.currency,
            invoiceAmountMinor,
            outstandingInvoiceMinor: invoiceAmountMinor,
            programCurrency: lockedProgram.currency,
            programAmountMinor,
            outstandingProgramMinor: programAmountMinor,
            ...this.mapFxRateToColumns(fxRate),
            createdBy: params.actor,
            lastApiChangeAt: new Date(),
          },
          { manager },
        );

        const updatedProgram = await this.capacityChangeService.commitChange(manager, {
          program: lockedProgram,
          type: CapacityLedgerEntryType.RESERVED,
          source: CapacityChangeSource.API,
          actor: params.actor,
          reservedDeltaMinor: programAmountMinor,
          creditLimitDeltaMinor: 0n,
          reservation: { id: reservation.id, invoiceId: reservation.invoiceId },
          outboxEvent: {
            type: CapacityOutboxEventType.CAPACITY_RESERVED,
            details: {
              invoiceId: reservation.invoiceId,
              invoiceCurrency: reservation.invoiceCurrency,
              invoiceAmount: params.amount,
              programCurrency: lockedProgram.currency,
              programAmount: MoneyUtils.formatMinorUnits(
                programAmountMinor,
                lockedProgram.currency,
              ),
            },
          },
        });

        return { reservation, program: updatedProgram, isIdempotentReplay: false };
      },
    );
    this.metricsService.recordReservation(result.isIdempotentReplay ? "replayed" : "created");
    return result;
  }

  private assertSameRequest(
    reservation: ReservationEntity,
    request: { invoiceAmountMinor: bigint; currency: string },
  ): void {
    if (
      reservation.invoiceCurrency !== request.currency ||
      reservation.invoiceAmountMinor !== request.invoiceAmountMinor
    ) {
      throw new ReservationConflictError(reservation.invoiceId);
    }
  }

  private mapFxRateToColumns(fxRate: FxRateQuote | null) {
    return {
      fxBaseCurrency: fxRate?.baseCurrency ?? null,
      fxQuoteCurrency: fxRate?.quoteCurrency ?? null,
      fxRate: fxRate?.rate ?? null,
      fxRateAsOf: fxRate?.asOf ?? null,
    };
  }
}
