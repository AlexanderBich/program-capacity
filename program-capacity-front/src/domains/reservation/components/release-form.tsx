import { useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useReleaseReservation } from '@/api/reservation/queries/use-release-reservation';
import type { Reservation } from '@/api/reservation/types';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Notice } from '@/components/ui/notice';
import { TextInput } from '@/components/ui/text-input';
import { showToast } from '@/components/ui/toast-store';
import { formatAmount } from '@/utils/format-amount';
import { createReleaseFormSchema, type ReleaseFormValue } from '../schema';
import styles from './release-form.module.scss';

type ReleaseFormProps = {
  reservation: Reservation;
  onReleased: () => void;
};

export function ReleaseForm({ reservation, onReleased }: ReleaseFormProps) {
  const { mutateAsync: release, error } = useReleaseReservation(
    reservation.programId,
    reservation.id,
  );
  const schema = useMemo(
    () =>
      createReleaseFormSchema({
        outstanding: reservation.outstandingInvoiceAmount,
        currency: reservation.invoiceCurrency,
      }),
    [reservation.outstandingInvoiceAmount, reservation.invoiceCurrency],
  );
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ReleaseFormValue>({
    resolver: zodResolver(schema),
    // Generated once per form: a double submit or a retry carries the same id and frees capacity once.
    defaultValues: {
      amount: reservation.outstandingInvoiceAmount,
      repaymentId: `RPM-${crypto.randomUUID()}`,
    },
  });

  const submit = handleSubmit((values) =>
    release({ ...values, currency: reservation.invoiceCurrency })
      .then((result) => {
        showToast(
          result.isIdempotentReplay
            ? { variant: 'info', message: 'This repayment was already applied: nothing changed.' }
            : {
                variant: 'success',
                message: `Released ${formatAmount(result.release.programAmount, reservation.programCurrency)} ${reservation.programCurrency} back to the program.`,
              },
        );
        onReleased();
      })
      .catch(() => undefined),
  );

  return (
    <form onSubmit={submit} className={styles.form} noValidate>
      {error && <Notice variant="danger">{error.message}</Notice>}
      <Field
        label={`Repaid amount (${reservation.invoiceCurrency})`}
        error={errors.amount?.message}
        hint={`Outstanding: ${formatAmount(reservation.outstandingInvoiceAmount, reservation.invoiceCurrency)} ${reservation.invoiceCurrency}`}
        action={
          <Button
            variant="secondary"
            onClick={() =>
              setValue('amount', reservation.outstandingInvoiceAmount, { shouldValidate: true })
            }
          >
            Full
          </Button>
        }
      >
        <TextInput
          isNumeric
          inputMode="decimal"
          hasError={Boolean(errors.amount)}
          {...register('amount')}
        />
      </Field>
      <Field label="Repayment reference" error={errors.repaymentId?.message}>
        <TextInput isNumeric hasError={Boolean(errors.repaymentId)} {...register('repaymentId')} />
      </Field>
      <Button type="submit" variant="primary" isLoading={isSubmitting}>
        Release capacity
      </Button>
    </form>
  );
}
