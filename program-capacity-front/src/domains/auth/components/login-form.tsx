import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useLogin } from '@/api/auth/queries/use-login';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Notice } from '@/components/ui/notice';
import { TextInput } from '@/components/ui/text-input';
import { loginSchema, type LoginFormValue } from '../schema';
import { DemoAccounts } from './demo-accounts';
import styles from './login-form.module.scss';

export function LoginForm() {
  const { mutateAsync: login, error } = useLogin();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValue>({ resolver: zodResolver(loginSchema) });

  const fillAccount = (account: LoginFormValue) => {
    setValue('email', account.email, { shouldValidate: true });
    setValue('password', account.password, { shouldValidate: true });
  };

  const submit = handleSubmit((values) => login(values).catch(() => undefined));

  return (
    <form onSubmit={submit} className={styles.form} noValidate>
      {error && <Notice variant="danger">{error.message}</Notice>}
      <Field label="Email" error={errors.email?.message}>
        <TextInput
          type="email"
          autoComplete="username"
          hasError={Boolean(errors.email)}
          {...register('email')}
        />
      </Field>
      <Field label="Password" error={errors.password?.message}>
        <TextInput
          type="password"
          autoComplete="current-password"
          hasError={Boolean(errors.password)}
          {...register('password')}
        />
      </Field>
      <Button type="submit" variant="primary" isLoading={isSubmitting}>
        Sign in
      </Button>
      <DemoAccounts onSelect={fillAccount} />
    </form>
  );
}
