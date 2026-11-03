import { ValueTransformer } from "typeorm";

// node-postgres returns int8 as a string; money stays exact as a native bigint in application code.
export const bigintTransformer: ValueTransformer = {
  to: (value?: bigint | null): string | null | undefined =>
    value === null || value === undefined ? value : value.toString(),
  from: (value?: string | null): bigint | null | undefined =>
    value === null || value === undefined ? value : BigInt(value),
};
