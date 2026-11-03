const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const STARTUP_TIMEOUT_MS = 180_000;

/** The stack is started separately, so this only waits for it to answer through the same door users use. */
export default async function globalSetup() {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const isReady = await fetch(`${BASE_URL}/api/v1/auth/me`)
      .then((response) => response.status === 401)
      .catch(() => false);
    if (isReady) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Nothing answered at ${BASE_URL}. Start the stack first: npm run stack:up`);
}
