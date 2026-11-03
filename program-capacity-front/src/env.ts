import { z } from 'zod';

const schema = z.object({
  VITE_API_URL: z.string().min(1),
  VITE_SHOW_DEMO_ACCOUNTS: z.enum(['true', 'false']),
  VITE_DEMO_PASSWORD: z.string().optional(),
});

export const env = schema.parse({
  VITE_API_URL: import.meta.env.VITE_API_URL,
  VITE_SHOW_DEMO_ACCOUNTS: import.meta.env.VITE_SHOW_DEMO_ACCOUNTS,
  VITE_DEMO_PASSWORD: import.meta.env.VITE_DEMO_PASSWORD,
});
