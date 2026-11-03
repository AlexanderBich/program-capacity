import { ParsedPosition } from "@/modules/capacity/application/utils/reconciliation-diff-utils.types";

export type ValidatedSnapshot = {
  creditLimitMinor: bigint;
  positions: ParsedPosition[];
};
