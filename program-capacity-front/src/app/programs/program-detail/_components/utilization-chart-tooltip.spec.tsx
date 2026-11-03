import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UtilizationChartTooltip, type UtilizationChartPoint } from './utilization-chart-tooltip';

const point = (overrides: Partial<UtilizationChartPoint> = {}): UtilizationChartPoint => ({
  time: Date.parse('2026-11-01T12:00:00.000Z'),
  reserved: 1000,
  creditLimit: 10000000,
  reservedLabel: '1000.00',
  creditLimitLabel: '10000000.00',
  type: 'RESERVED',
  invoiceId: 'INV-1',
  ...overrides,
});

describe('UtilizationChartTooltip', () => {
  it('shows nothing while no point is hovered', () => {
    const { container } = render(<UtilizationChartTooltip point={undefined} currency="USD" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows what was reserved and the limit at that moment, with the event that moved them', () => {
    const { container } = render(<UtilizationChartTooltip point={point()} currency="USD" />);

    expect(container).toHaveTextContent('1,000.00 USD');
    expect(container).toHaveTextContent('10,000,000.00 USD');
    expect(container).toHaveTextContent('Reserved · INV-1');
    expect(container).toHaveTextContent(/\d{2} [A-Z][a-z]{2,3}, \d{2}:\d{2}:\d{2}$/);
  });

  it('names no invoice when the event had none', () => {
    const { container } = render(
      <UtilizationChartTooltip
        point={point({ type: 'PROGRAM_CREATED', invoiceId: null })}
        currency="USD"
      />,
    );

    expect(container).toHaveTextContent('Program created');
    expect(container).not.toHaveTextContent('·');
  });
});
