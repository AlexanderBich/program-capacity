import { useEffect, useRef, useState } from 'react';

const FLASH_DURATION_MS = 900;

/** True for a moment after `value` changes, never on first render. */
export const useFlashOnChange = (value: unknown) => {
  const [isFlashing, setIsFlashing] = useState(false);
  const previousValue = useRef(value);

  useEffect(() => {
    if (previousValue.current === value) return;
    previousValue.current = value;
    setIsFlashing(true);
    const timeout = setTimeout(() => setIsFlashing(false), FLASH_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [value]);

  return isFlashing;
};
