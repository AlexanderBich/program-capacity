export type ProgramLockSlots = {
  active: number;
  waiters: (() => void)[];
};
