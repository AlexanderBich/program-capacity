import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useCreateProgram } from '@/api/program/queries/use-create-program';
import type { Program } from '@/api/program/types';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Notice } from '@/components/ui/notice';
import { SelectInput } from '@/components/ui/select-input';
import { TextInput } from '@/components/ui/text-input';
import { SUPPORTED_CURRENCIES } from '@/constants/currencies';
import { createProgramSchema, type CreateProgramFormValue } from '../schema';
import styles from './create-program-form.module.scss';

type CreateProgramFormProps = {
  onCreated: (program: Program) => void;
};

export function CreateProgramForm({ onCreated }: CreateProgramFormProps) {
  const { mutateAsync: createProgram, error } = useCreateProgram();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateProgramFormValue>({
    resolver: zodResolver(createProgramSchema),
    defaultValues: { code: '', name: '', currency: 'USD', creditLimit: '' },
  });

  const submit = handleSubmit((values) =>
    createProgram(values)
      .then(onCreated)
      .catch(() => undefined),
  );

  return (
    <form onSubmit={submit} className={styles.form} noValidate>
      {error && <Notice variant="danger">{error.message}</Notice>}
      <Field label="Program code" error={errors.code?.message} hint="Treasury's identifier for it">
        <TextInput isNumeric hasError={Boolean(errors.code)} {...register('code')} />
      </Field>
      <Field label="Name" error={errors.name?.message}>
        <TextInput hasError={Boolean(errors.name)} {...register('name')} />
      </Field>
      <div className={styles.amountRow}>
        <Field label="Credit limit" error={errors.creditLimit?.message}>
          <TextInput
            isNumeric
            inputMode="decimal"
            placeholder="10000000.00"
            hasError={Boolean(errors.creditLimit)}
            {...register('creditLimit')}
          />
        </Field>
        <Field label="Currency">
          <SelectInput {...register('currency')}>
            {SUPPORTED_CURRENCIES.map((currency) => (
              <option key={currency}>{currency}</option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <Button type="submit" variant="primary" isLoading={isSubmitting}>
        Create program
      </Button>
    </form>
  );
}
