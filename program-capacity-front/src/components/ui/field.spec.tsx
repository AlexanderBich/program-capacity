import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Field } from './field';
import { TextInput } from './text-input';

describe('Field', () => {
  it('names its control by the label', () => {
    render(
      <Field label="Email">
        <TextInput />
      </Field>,
    );

    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
  });

  it('focuses the control when the label is clicked', async () => {
    render(
      <Field label="Email">
        <TextInput />
      </Field>,
    );

    await userEvent.setup().click(screen.getByText('Email'));

    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('keeps the hint and the error out of the name, and points the control at them instead', () => {
    const { rerender } = render(
      <Field label="Program code" hint="Treasury's identifier for it">
        <TextInput />
      </Field>,
    );

    const control = screen.getByRole('textbox', { name: 'Program code' });
    expect(control).toHaveAccessibleDescription("Treasury's identifier for it");

    rerender(
      <Field
        label="Program code"
        hint="Treasury's identifier for it"
        error="Enter the program code"
      >
        <TextInput hasError />
      </Field>,
    );

    expect(screen.getByRole('textbox', { name: 'Program code' })).toHaveAccessibleDescription(
      'Enter the program code',
    );
  });

  it('describes nothing when it has neither hint nor error', () => {
    render(
      <Field label="Name">
        <TextInput />
      </Field>,
    );

    expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('aria-describedby');
  });

  it('keeps an action beside the control out of its name', () => {
    render(
      <Field label="Amount" action={<button type="button">Full</button>}>
        <TextInput />
      </Field>,
    );

    expect(screen.getByRole('textbox', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Full' })).toBeInTheDocument();
  });

  it('shows the hint when there is no error', () => {
    render(
      <Field label="Program code" hint="Treasury's identifier for it">
        <TextInput />
      </Field>,
    );

    expect(screen.getByText("Treasury's identifier for it")).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces the error and drops the hint in its favour', () => {
    render(
      <Field
        label="Program code"
        hint="Treasury's identifier for it"
        error="Enter the program code"
      >
        <TextInput hasError />
      </Field>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Enter the program code');
    expect(screen.queryByText("Treasury's identifier for it")).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInvalid();
  });

  it('shows neither hint nor error when it has none', () => {
    const { container } = render(
      <Field label="Name">
        <TextInput />
      </Field>,
    );

    expect(container).toHaveTextContent(/^Name$/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
