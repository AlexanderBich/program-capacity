import { setupServer } from 'msw/node';

/** The API as seen over HTTP. Each test describes what it needs with `server.use(...)`. */
export const server = setupServer();
