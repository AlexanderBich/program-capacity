import { z } from 'zod';
import { CURRENCY_MINOR_DIGITS } from '@/constants/currencies';
import { parseToMinorUnits } from '@/utils/parse-to-minor-units';

const amountMessage = (currency: string) => {
  const digits = CURRENCY_MINOR_DIGITS[currency];
  return digits === 0
    ? `${currency} has no decimals: enter a positive whole amount`
    : `Enter a positive amount with at most ${digits} decimals`;
};

export const reserveFormSchema = z
  .object({
    invoiceId: z
      .string()
      .min(1, 'Enter the invoice id')
      .max(128, 'At most 128 characters')
      .regex(/^[A-Za-z0-9._:/-]+$/, 'Letters, digits and . _ : / - only'),
    amount: z.string().min(1, 'Enter the amount'),
    currency: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (!value.amount) return;
    const minorUnits = parseToMinorUnits(value.amount, value.currency);
    if (minorUnits === null || minorUnits <= 0n) {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: amountMessage(value.currency),
      });
    }
  });

export type ReserveFormValue = z.infer<typeof reserveFormSchema>;

export const createReleaseFormSchema = (params: { outstanding: string; currency: string }) =>
  z
    .object({
      amount: z.string().min(1, 'Enter the amount'),
      repaymentId: z
        .string()
        .min(1, 'Enter the repayment reference')
        .max(128, 'At most 128 characters')
        .regex(/^[A-Za-z0-9._:/-]+$/, 'Letters, digits and . _ : / - only'),
    })
    .superRefine((value, context) => {
      if (!value.amount) return;
      const minorUnits = parseToMinorUnits(value.amount, params.currency);
      if (minorUnits === null || minorUnits <= 0n) {
        context.addIssue({
          code: 'custom',
          path: ['amount'],
          message: amountMessage(params.currency),
        });
      } else if (minorUnits > (parseToMinorUnits(params.outstanding, params.currency) ?? 0n)) {
        context.addIssue({
          code: 'custom',
          path: ['amount'],
          message: 'More than what is outstanding',
        });
      }
    });

export type ReleaseFormValue = z.infer<ReturnType<typeof createReleaseFormSchema>>;
