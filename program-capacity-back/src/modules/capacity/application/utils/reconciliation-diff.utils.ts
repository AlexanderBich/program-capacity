import { MoneyUtils } from "@/common/utils/money.utils";
import {
  ParsedPosition,
  ReconciliationDiff,
} from "@/modules/capacity/application/utils/reconciliation-diff-utils.types";
import { RECONCILIATION_MAX_RECORDED_ADJUSTMENTS } from "@/modules/capacity/capacity.constants";
import {
  ReconciliationAdjustmentAction,
  ReservationStatus,
} from "@/modules/capacity/capacity.enums";
import { ReconciliationAdjustment, RecordedAdjustment } from "@/modules/capacity/capacity.types";
import { ReservationEntity } from "@/modules/capacity/entities/reservation.entity";

export class ReconciliationDiffUtils {
  /**
   * Treasury is authoritative for what it can know about. A reservation this API changed after `cutoff`
   * is in flight: the snapshot was taken before treasury could have seen that change, so both "missing
   * from the snapshot" and "different in the snapshot" say nothing about it. It is left untouched and
   * the next snapshot settles it. Overwriting it here is how a naive reconcile would double-spend
   * capacity.
   */
  static computeDiff(params: {
    positions: ParsedPosition[];
    reservations: ReservationEntity[];
    cutoff: Date;
  }): ReconciliationDiff {
    const positionsByInvoiceId = new Map(
      params.positions.map((position) => [position.invoiceId, position]),
    );
    const diff: ReconciliationDiff = {
      toInsert: [],
      toAdjust: [],
      toClose: [],
      inFlightSkippedCount: 0,
    };

    for (const reservation of params.reservations) {
      const position = positionsByInvoiceId.get(reservation.invoiceId);
      positionsByInvoiceId.delete(reservation.invoiceId);

      if (reservation.lastApiChangeAt !== null && reservation.lastApiChangeAt > params.cutoff) {
        diff.inFlightSkippedCount += 1;
      } else if (!position) {
        if (reservation.status === ReservationStatus.ACTIVE) {
          diff.toClose.push(reservation);
        }
      } else if (this.differs(reservation, position)) {
        diff.toAdjust.push({ reservation, position });
      }
    }

    diff.toInsert = [...positionsByInvoiceId.values()];
    return diff;
  }

  /** Everything the diff is about to change, taken before it is applied to the reservations. */
  static buildAdjustments(diff: ReconciliationDiff): RecordedAdjustment[] {
    return [
      ...diff.toInsert.map((position) => ({
        invoiceId: position.invoiceId,
        action: ReconciliationAdjustmentAction.INSERTED,
        outstandingProgramBeforeMinor: 0n,
        outstandingProgramAfterMinor: position.outstandingProgramMinor,
      })),
      ...diff.toAdjust.map(({ reservation, position }) => ({
        invoiceId: reservation.invoiceId,
        action: ReconciliationAdjustmentAction.ADJUSTED,
        outstandingProgramBeforeMinor: reservation.outstandingProgramMinor,
        outstandingProgramAfterMinor: position.outstandingProgramMinor,
      })),
      ...diff.toClose.map((reservation) => ({
        invoiceId: reservation.invoiceId,
        action: ReconciliationAdjustmentAction.CLOSED,
        outstandingProgramBeforeMinor: reservation.outstandingProgramMinor,
        outstandingProgramAfterMinor: 0n,
      })),
    ];
  }

  /** A capped sample to read alongside the reconciliation. The complete list has its own table. */
  static buildAdjustmentSample(
    diff: ReconciliationDiff,
    programCurrency: string,
  ): ReconciliationAdjustment[] {
    return this.buildAdjustments(diff)
      .slice(0, RECONCILIATION_MAX_RECORDED_ADJUSTMENTS)
      .map((adjustment) => ({
        invoiceId: adjustment.invoiceId,
        action: adjustment.action,
        outstandingProgramAmountBefore: MoneyUtils.formatMinorUnits(
          adjustment.outstandingProgramBeforeMinor,
          programCurrency,
        ),
        outstandingProgramAmountAfter: MoneyUtils.formatMinorUnits(
          adjustment.outstandingProgramAfterMinor,
          programCurrency,
        ),
      }));
  }

  private static differs(reservation: ReservationEntity, position: ParsedPosition): boolean {
    return (
      reservation.status !== ReservationStatus.ACTIVE ||
      reservation.invoiceCurrency !== position.invoiceCurrency ||
      reservation.invoiceAmountMinor !== position.invoiceAmountMinor ||
      reservation.outstandingInvoiceMinor !== position.outstandingInvoiceMinor ||
      reservation.outstandingProgramMinor !== position.outstandingProgramMinor
    );
  }
}
