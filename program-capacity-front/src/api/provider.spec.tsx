import { useQueryClient } from '@tanstack/react-query';
import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiProvider } from './provider';

describe('ApiProvider', () => {
  it('renders what it wraps', () => {
    render(
      <ApiProvider>
        <p>Inside</p>
      </ApiProvider>,
    );

    expect(screen.getByText('Inside')).toBeInTheDocument();
  });

  it('gives its children the query client the app is configured with', () => {
    const { result } = renderHook(() => useQueryClient(), { wrapper: ApiProvider });

    expect(result.current.getDefaultOptions().queries).toMatchObject({
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    });
  });

  it('keeps the same client across re-renders, so the cache survives them', () => {
    const { result, rerender } = renderHook(() => useQueryClient(), { wrapper: ApiProvider });
    const first = result.current;

    rerender();
    rerender();

    expect(result.current).toBe(first);
  });

  it('gives every provider a cache of its own', () => {
    const { result: first } = renderHook(() => useQueryClient(), { wrapper: ApiProvider });
    const { result: second } = renderHook(() => useQueryClient(), { wrapper: ApiProvider });

    first.current.setQueryData(['only-here'], 'data');

    expect(second.current).not.toBe(first.current);
    expect(second.current.getQueryData(['only-here'])).toBeUndefined();
  });
});
