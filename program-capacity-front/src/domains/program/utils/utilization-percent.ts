/** For display only: the bar width and a rounded label, so floating point is fine here. */
export const utilizationPercent = (reserved: string, creditLimit: string) => {
  const limit = Number(creditLimit);
  if (limit <= 0) return Number(reserved) > 0 ? 100 : 0;
  return (Number(reserved) / limit) * 100;
};
