import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import type { ApiError } from '@/api/errors';
import { useCreateReservation } from '@/api/reservation/queries/use-create-reservation';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Notice } from '@/components/ui/notice';
import { SelectInput } from '@/components/ui/select-input';
import { TextInput } from '@/components/ui/text-input';
import { showToast } from '@/components/ui/toast-store';
import { SUPPORTED_CURRENCIES } from '@/constants/currencies';
import { formatAmount } from '@/utils/format-amount';
import { reserveFormSchema, type ReserveFormValue } from '../schema';
import { ConversionPreview } from './conversion-preview';
import styles from './reserve-form.module.scss';

type ReserveFormProps = {
  programId: string;
  programCurrency: string;
};

const describeError = (error: ApiError) => {
  const details = error.details as {
    requested?: string;
    available?: string;
    currency?: string;
  } | null;
  if (error.code === 'INSUFFICIENT_CAPACITY' && details?.currency) {
    return `This needs ${formatAmount(details.requested ?? '0', details.currency)} ${details.currency}, but only ${formatAmount(details.available ?? '0', details.currency)} ${details.currency} is available.`;
  }
  return error.message;
};

export function ReserveForm({ programId, programCurrency }: ReserveFormProps) {
  const { mutateAsync: createReservation, error } = useCreateReservation(programId);
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<ReserveFormValue>({
    resolver: zodResolver(reserveFormSchema),
    defaultValues: { invoiceId: '', amount: '', currency: programCurrency },
  });
  const amount = useWatch({ control, name: 'amount' });
  const currency = useWatch({ control, name: 'currency' });

  const submit = handleSubmit((values) =>
    createReservation(values)
      .then(({ reservation, isIdempotentReplay }) => {
        showToast(
          isIdempotentReplay
            ? {
                variant: 'info',
                message: `${reservation.invoiceId} was already reserved: nothing changed.`,
              }
            : {
                variant: 'success',
                message: `Reserved ${formatAmount(reservation.programAmount, reservation.programCurrency)} ${reservation.programCurrency} for ${reservation.invoiceId}.`,
              },
        );
        reset({ invoiceId: '', amount: '', currency: values.currency });
      })
      .catch(() => undefined),
  );

  return (
    <form onSubmit={submit} className={styles.form} noValidate>
      {error && <Notice variant="danger">{describeError(error)}</Notice>}
      <Field
        label="Invoice id"
        error={errors.invoiceId?.message}
        hint="Retrying with the same id is safe: it reserves only once."
      >
        <TextInput isNumeric hasError={Boolean(errors.invoiceId)} {...register('invoiceId')} />
      </Field>
      <div className={styles.amountRow}>
        <Field label="Amount" error={errors.amount?.message}>
          <TextInput
            isNumeric
            inputMode="decimal"
            placeholder="0.00"
            hasError={Boolean(errors.amount)}
            {...register('amount')}
          />
        </Field>
        <Field label="Currency">
          <SelectInput {...register('currency')}>
            {SUPPORTED_CURRENCIES.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </SelectInput>
        </Field>
      </div>
      {currency !== programCurrency && (
        <ConversionPreview
          amount={amount}
          invoiceCurrency={currency}
          programCurrency={programCurrency}
        />
      )}
      <Button type="submit" variant="primary" isLoading={isSubmitting}>
        Reserve capacity
      </Button>
    </form>
  );
}
