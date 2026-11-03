import { z } from "zod";
import {
  FX_RATE_PATTERN,
  MONEY_AMOUNT_PATTERN,
  SUPPORTED_CURRENCIES,
} from "@/common/constants/currencies.constants";
import {
  DISPLAY_NAME_PATTERN,
  EXTERNAL_ID_PATTERN,
  PROGRAM_CODE_PATTERN,
} from "@/common/constants/identifiers.constants";
import { TREASURY_MAX_FUTURE_AS_OF_MS } from "@/modules/treasury/treasury.constants";

const currencySchema = z.string().refine((currency) => SUPPORTED_CURRENCIES.includes(currency));
const moneyAmountSchema = z.string().regex(MONEY_AMOUNT_PATTERN);
const externalIdSchema = z.string().regex(EXTERNAL_ID_PATTERN);
const displayNameSchema = z.string().regex(DISPLAY_NAME_PATTERN);
const asOfSchema = z.iso
  .datetime({ offset: true })
  .refine((asOf) => new Date(asOf).getTime() <= Date.now() + TREASURY_MAX_FUTURE_AS_OF_MS, {
    error: "asOf is in the future",
  });

const messageEnvelope = {
  eventId: z.string().min(1).max(128),
  programCode: z.string().regex(PROGRAM_CODE_PATTERN),
  // Strictly increasing per program, across all message types. Drives idempotency and ordering.
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  occurredAt: z.iso.datetime({ offset: true }),
};

export const TREASURY_CAPACITY_MESSAGE_SCHEMA = z.discriminatedUnion("type", [
  z.object({
    ...messageEnvelope,
    type: z.literal("PROGRAM_UPSERTED"),
    payload: z.object({
      name: displayNameSchema,
      currency: currencySchema,
      creditLimit: moneyAmountSchema,
    }),
  }),
  z.object({
    ...messageEnvelope,
    type: z.literal("CAPACITY_RESERVED"),
    payload: z.object({
      invoiceId: externalIdSchema,
      invoiceCurrency: currencySchema,
      invoiceAmount: moneyAmountSchema,
      programAmount: moneyAmountSchema,
    }),
  }),
  z.object({
    ...messageEnvelope,
    type: z.literal("CAPACITY_RELEASED"),
    payload: z.object({
      invoiceId: externalIdSchema,
      repaymentId: externalIdSchema,
      amount: moneyAmountSchema,
    }),
  }),
  z.object({
    ...messageEnvelope,
    type: z.literal("PROGRAM_RECONCILED"),
    payload: z.object({
      name: displayNameSchema,
      currency: currencySchema,
      creditLimit: moneyAmountSchema,
      asOf: asOfSchema,
      totalOutstanding: moneyAmountSchema,
      positions: z.array(
        z.object({
          invoiceId: externalIdSchema,
          invoiceCurrency: currencySchema,
          invoiceAmount: moneyAmountSchema,
          outstandingInvoiceAmount: moneyAmountSchema,
          outstandingProgramAmount: moneyAmountSchema,
        }),
      ),
    }),
  }),
]);

export const TREASURY_FX_RATE_MESSAGE_SCHEMA = z.object({
  baseCurrency: currencySchema,
  quoteCurrency: currencySchema,
  rate: z
    .string()
    .regex(FX_RATE_PATTERN)
    .refine((rate) => Number(rate) > 0),
  asOf: asOfSchema,
});
