import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { API, buildProgram } from '@/test/fixtures';
import { renderWithProviders } from '@/test/render';
import { server } from '@/test/server';
import { CreateProgramForm } from './create-program-form';

const renderForm = () => {
  const onCreated = vi.fn();
  renderWithProviders(<CreateProgramForm onCreated={onCreated} />, {
    path: '/',
    initialEntry: '/',
  });
  return { onCreated };
};

const fill = async (values: {
  code?: string;
  name?: string;
  creditLimit?: string;
  currency?: string;
}) => {
  const user = userEvent.setup();
  if (values.code) await user.type(screen.getByLabelText(/program code/i), values.code);
  if (values.name) await user.type(screen.getByLabelText(/^name/i), values.name);
  if (values.creditLimit)
    await user.type(screen.getByLabelText(/credit limit/i), values.creditLimit);
  if (values.currency)
    await user.selectOptions(screen.getByLabelText(/currency/i), values.currency);
};

const submit = () =>
  userEvent.setup().click(screen.getByRole('button', { name: 'Create program' }));

const VALID = { code: 'PRG-NEW', name: 'New Program', creditLimit: '5000000.00' };

describe('CreateProgramForm', () => {
  it('asks for a code, a name and a credit limit before calling the API', async () => {
    const create = vi.fn();
    server.use(http.post(`${API}/programs`, create));
    const { onCreated } = renderForm();

    await submit();

    expect(await screen.findByText('Enter the program code')).toBeInTheDocument();
    expect(screen.getByText('Enter a name')).toBeInTheDocument();
    expect(screen.getByText('Enter the credit limit')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('refuses a code made of characters treasury does not use', async () => {
    renderForm();

    await fill({ ...VALID, code: 'PRG NEW!' });
    await submit();

    expect(
      await screen.findByText('Letters, digits, dots, dashes and underscores only'),
    ).toBeInTheDocument();
  });

  it('refuses a credit limit the chosen currency cannot represent', async () => {
    renderForm();
    await fill({ ...VALID, creditLimit: '1000.123' });
    await submit();
    expect(await screen.findByText('Enter an amount with at most 2 decimals')).toBeInTheDocument();

    await userEvent.setup().selectOptions(screen.getByLabelText(/currency/i), 'JPY');
    await submit();

    expect(await screen.findByText('Enter an amount with at most 0 decimals')).toBeInTheDocument();
  });

  it('creates the program in US dollars unless told otherwise, and hands it on', async () => {
    let body: unknown;
    const created = buildProgram({ id: 'program-9', code: 'PRG-NEW', name: 'New Program' });
    server.use(
      http.post(`${API}/programs`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    const { onCreated } = renderForm();

    await fill(VALID);
    await submit();

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(body).toEqual({ ...VALID, currency: 'USD' });
  });

  it('creates the program in the chosen currency', async () => {
    let body: unknown;
    server.use(
      http.post(`${API}/programs`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(buildProgram({ currency: 'JPY' }), { status: 201 });
      }),
    );
    const { onCreated } = renderForm();

    await fill({ ...VALID, creditLimit: '900000000', currency: 'JPY' });
    await submit();

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(body).toEqual({
      code: 'PRG-NEW',
      name: 'New Program',
      creditLimit: '900000000',
      currency: 'JPY',
    });
  });

  it('says when the program code is already taken, and keeps what was typed', async () => {
    server.use(
      http.post(`${API}/programs`, () =>
        HttpResponse.json(
          {
            statusCode: 409,
            code: 'PROGRAM_CODE_TAKEN',
            message: 'A program with this code already exists',
          },
          { status: 409 },
        ),
      ),
    );
    const { onCreated } = renderForm();

    await fill(VALID);
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A program with this code already exists',
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/program code/i)).toHaveValue('PRG-NEW');
    expect(screen.getByLabelText(/^name/i)).toHaveValue('New Program');
    expect(screen.getByLabelText(/credit limit/i)).toHaveValue('5000000.00');
  });

  it('does not blame the user for a server failure', async () => {
    server.use(
      http.post(`${API}/programs`, () =>
        HttpResponse.json(
          { statusCode: 500, message: 'relation "programs" does not exist' },
          { status: 500 },
        ),
      ),
    );
    const { onCreated } = renderForm();

    await fill(VALID);
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on the server. Try again shortly.',
    );
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('cannot be submitted again while it is creating', async () => {
    let respond!: () => void;
    const gate = new Promise<void>((resolve) => {
      respond = resolve;
    });
    server.use(
      http.post(`${API}/programs`, async () => {
        await gate;
        return HttpResponse.json(buildProgram(), { status: 201 });
      }),
    );
    const { onCreated } = renderForm();
    await fill(VALID);

    await submit();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create program' })).toBeDisabled(),
    );
    respond();
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
  });
});
