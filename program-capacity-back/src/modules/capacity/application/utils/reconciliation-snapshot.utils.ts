import { MoneyUtils } from "@/common/utils/money.utils";
import { SnapshotRejectedError } from "@/modules/capacity/application/errors/snapshot-rejected.error";
import { ValidatedSnapshot } from "@/modules/capacity/application/utils/reconciliation-snapshot-utils.types";
import { TreasuryProgramSnapshot } from "@/modules/capacity/capacity.types";

export class ReconciliationSnapshotUtils {
  /** Rejects anything internally inconsistent: applying a broken snapshot could silently free capacity. */
  static parseAndValidateOrThrow(snapshot: TreasuryProgramSnapshot): ValidatedSnapshot {
    const positions = snapshot.positions.map((position) => ({
      invoiceId: position.invoiceId,
      invoiceCurrency: position.invoiceCurrency,
      invoiceAmountMinor: MoneyUtils.parsePositiveToMinorUnits(
        position.invoiceAmount,
        position.invoiceCurrency,
      ),
      outstandingInvoiceMinor: MoneyUtils.parsePositiveToMinorUnits(
        position.outstandingInvoiceAmount,
        position.invoiceCurrency,
      ),
      outstandingProgramMinor: MoneyUtils.parsePositiveToMinorUnits(
        position.outstandingProgramAmount,
        snapshot.currency,
      ),
    }));

    if (new Set(positions.map((position) => position.invoiceId)).size !== positions.length) {
      throw new SnapshotRejectedError("duplicate invoice in positions", {
        programCode: snapshot.programCode,
      });
    }
    if (
      positions.some((position) => position.outstandingInvoiceMinor > position.invoiceAmountMinor)
    ) {
      throw new SnapshotRejectedError("outstanding exceeds invoice amount", {
        programCode: snapshot.programCode,
      });
    }

    // Control total: a truncated or corrupted message must not be able to wipe out reservations.
    const positionsTotalMinor = positions.reduce(
      (total, position) => total + position.outstandingProgramMinor,
      0n,
    );
    if (
      positionsTotalMinor !==
      MoneyUtils.parseToMinorUnits(snapshot.totalOutstanding, snapshot.currency)
    ) {
      throw new SnapshotRejectedError("positions do not add up to totalOutstanding", {
        programCode: snapshot.programCode,
        totalOutstanding: snapshot.totalOutstanding,
        positionsTotal: MoneyUtils.formatMinorUnits(positionsTotalMinor, snapshot.currency),
      });
    }

    return {
      creditLimitMinor: MoneyUtils.parseToMinorUnits(snapshot.creditLimit, snapshot.currency),
      positions,
    };
  }
}
