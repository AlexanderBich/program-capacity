import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('joins class names with a space, in the order given', () => {
    expect(cn('button', 'primary', 'large')).toBe('button primary large');
  });

  it('drops whatever is falsy, so a condition can switch a class off', () => {
    const isSelected = false;
    expect(cn('option', isSelected && 'selected', null, undefined, '')).toBe('option');
    expect(cn('option', !isSelected && 'selected')).toBe('option selected');
  });

  it('is empty when nothing is left', () => {
    expect(cn()).toBe('');
    expect(cn(false, null, undefined)).toBe('');
  });
});
