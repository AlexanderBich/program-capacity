export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};
