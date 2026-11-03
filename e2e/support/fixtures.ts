import { randomUUID } from 'node:crypto';
import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test';

export type Role = 'admin' | 'operator' | 'viewer';

const PASSWORD = process.env.E2E_PASSWORD ?? 'capacity-demo-password';
const API = '/api/v1';

export const emailOf = (role: Role) => `${role}@capacity.local`;

export const uniqueId = (prefix: string) => `${prefix}-${randomUUID().slice(0, 13)}`;

/** Programs list by code, so a newer one sorts first and stays on the first page however many exist. */
export const uniqueProgramCode = () =>
  `0-${9_999_999_999_999 - Date.now()}-${randomUUID().slice(0, 8)}`;

export const signIn = async (page: Page, role: Role) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(emailOf(role));
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/programs$/);
};

/** What another system or another person does, straight through the API, while a test watches the screen. */
export class ApiClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly token: string,
  ) {}

  private headers() {
    return { Authorization: `Bearer ${this.token}` };
  }

  post(path: string, data: unknown) {
    return this.request.post(`${API}${path}`, { headers: this.headers(), data });
  }

  get(path: string) {
    return this.request.get(`${API}${path}`, { headers: this.headers() });
  }

  async createProgram(params: { currency: string; creditLimit: string }) {
    const code = uniqueProgramCode();
    const response = await this.post('/programs', {
      code,
      name: `Program ${code}`,
      ...params,
    });
    expect(response.status()).toBe(201);
    return (await response.json()) as { id: string; code: string; name: string };
  }

  async reserve(programId: string, body: { invoiceId: string; amount: string; currency: string }) {
    const response = await this.post(`/programs/${programId}/reservations`, body);
    expect(response.status()).toBe(201);
    return response.json();
  }
}

const loginApi = async (request: APIRequestContext, role: Role) => {
  const response = await request.post(`${API}/auth/login`, {
    data: { email: emailOf(role), password: PASSWORD },
  });
  expect(response.status()).toBe(200);
  return new ApiClient(request, (await response.json()).accessToken);
};

export const test = base.extend<{
  adminApi: ApiClient;
  operatorApi: ApiClient;
  viewerApi: ApiClient;
}>({
  adminApi: async ({ playwright }, use) => {
    const request = await playwright.request.newContext({
      baseURL: base.info().project.use.baseURL,
    });
    await use(await loginApi(request, 'admin'));
    await request.dispose();
  },
  operatorApi: async ({ playwright }, use) => {
    const request = await playwright.request.newContext({
      baseURL: base.info().project.use.baseURL,
    });
    await use(await loginApi(request, 'operator'));
    await request.dispose();
  },
  viewerApi: async ({ playwright }, use) => {
    const request = await playwright.request.newContext({
      baseURL: base.info().project.use.baseURL,
    });
    await use(await loginApi(request, 'viewer'));
    await request.dispose();
  },
});

export { expect };
