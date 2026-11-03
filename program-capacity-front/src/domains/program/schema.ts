import { z } from 'zod';
import { CURRENCY_MINOR_DIGITS } from '@/constants/currencies';
import { parseToMinorUnits } from '@/utils/parse-to-minor-units';

export const createProgramSchema = z
  .object({
    code: z
      .string()
      .min(1, 'Enter the program code')
      .max(64, 'At most 64 characters')
      .regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dots, dashes and underscores only'),
    name: z.string().min(1, 'Enter a name').max(200, 'At most 200 characters'),
    currency: z.string().min(1),
    creditLimit: z.string().min(1, 'Enter the credit limit'),
  })
  .refine((value) => parseToMinorUnits(value.creditLimit, value.currency) !== null, {
    path: ['creditLimit'],
    error: (issue) => {
      const { currency } = issue.input as { currency: string };
      return `Enter an amount with at most ${CURRENCY_MINOR_DIGITS[currency]} decimals`;
    },
  });

export type CreateProgramFormValue = z.infer<typeof createProgramSchema>;
