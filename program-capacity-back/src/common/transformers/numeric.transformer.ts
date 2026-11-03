import { ValueTransformer } from "typeorm";

// For int8 counters (versions, sequences) that stay far below Number.MAX_SAFE_INTEGER. Never for money.
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null): number | null | undefined => value,
  from: (value?: string | null): number | null | undefined =>
    value === null || value === undefined ? value : Number(value),
};
