export type ConsumedMessage = {
  topic: string;
  partition: number;
  offset: string;
  key: Buffer | null;
  value: Buffer | null;
  heartbeat: () => Promise<void>;
};
