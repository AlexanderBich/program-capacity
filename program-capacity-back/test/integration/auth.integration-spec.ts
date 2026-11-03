import { JwtService } from "@nestjs/jwt";
import { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { DataSource } from "typeorm";
import { buildSwaggerDocument } from "@/app.setup";
import { UserRole } from "@/modules/auth/auth.enums";
import {
  API,
  createTestApp,
  createUser,
  httpServer,
  loginAs,
  TEST_PASSWORD,
} from "../support/test-app";

const refreshCookieFrom = (response: request.Response): string =>
  (response.headers["set-cookie"] as unknown as string[])
    .find((cookie) => cookie.startsWith("refresh_token="))!
    .split(";")[0];

describe("Authentication", () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("every endpoint requires authentication", () => {
    const CREDENTIAL_ENDPOINTS = [`post ${API}/auth/login`];

    it("rejects an anonymous call to every route in the API", async () => {
      const paths = buildSwaggerDocument(app).paths;
      const operations = Object.entries(paths).flatMap(([path, item]) =>
        Object.keys(item).map((method) => ({ path, method })),
      );

      // Guards against this test silently enumerating nothing.
      expect(operations.length).toBeGreaterThan(15);

      for (const { path, method } of operations) {
        const url = path
          .replace(/{programId}/, "00000000-0000-4000-8000-000000000001")
          .replace(/{reservationId}/, "00000000-0000-4000-8000-000000000002");
        const response = await (request(httpServer(app)) as any)[method](url);

        if (CREDENTIAL_ENDPOINTS.includes(`${method} ${path}`)) {
          expect(response.status).toBe(400);
        } else {
          expect({ method, path, status: response.status }).toEqual({
            method,
            path,
            status: 401,
          });
        }
      }
    });

    it.each([
      "/api/docs",
      "/api/docs/",
      "/api/docs-json",
      "/api/docs-yaml",
      "/api/DOCS",
      "/API/docs-JSON",
      "/api/Docs-Yaml",
    ])("protects %s with basic auth", async (path) => {
      await request(httpServer(app)).get(path).expect(401);
      await request(httpServer(app)).get(path).auth("docs", "wrong-password").expect(401);
      await request(httpServer(app)).get(path).auth("docs", "docs-test-password").expect(200);
    });

    it("accepts probes only with the probe token", async () => {
      await request(httpServer(app)).get(`${API}/health/ready`).expect(401);
      await request(httpServer(app))
        .get(`${API}/health/ready`)
        .set("x-probe-token", "wrong")
        .expect(401);
      const response = await request(httpServer(app))
        .get(`${API}/health/ready`)
        .set("x-probe-token", "test-probe-token-0123456789")
        .expect(200);
      expect(response.body.database).toBe(true);
    });
  });

  describe("access tokens", () => {
    const callWithToken = (token: string) =>
      request(httpServer(app)).get(`${API}/programs`).set("Authorization", `Bearer ${token}`);

    it("accepts a token this service issued", async () => {
      await callWithToken(await loginAs(app, UserRole.VIEWER)).expect(200);
    });

    it("rejects a token signed with another secret", async () => {
      const forged = new JwtService({ secret: "another-secret-another-secret-another" }).sign(
        { sub: "x", email: "x@x.x", role: UserRole.ADMIN },
        { issuer: "program-capacity", audience: "program-capacity-clients" },
      );
      await callWithToken(forged).expect(401);
    });

    it("rejects an expired token", async () => {
      const expired = app
        .get(JwtService, { strict: false })
        .sign({ sub: "x", email: "x@x.x", role: UserRole.ADMIN }, { expiresIn: -10 });
      await callWithToken(expired).expect(401);
    });

    it("rejects an unsigned token", async () => {
      const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const unsigned = `${encode({ alg: "none", typ: "JWT" })}.${encode({
        sub: "x",
        email: "x@x.x",
        role: UserRole.ADMIN,
        iss: "program-capacity",
        aud: "program-capacity-clients",
        exp: Math.floor(Date.now() / 1000) + 600,
      })}.`;
      await callWithToken(unsigned).expect(401);
    });
  });

  describe("sessions", () => {
    it("rejects wrong credentials without revealing whether the account exists", async () => {
      const { email } = await createUser(app, UserRole.VIEWER);
      const wrongPassword = await request(httpServer(app))
        .post(`${API}/auth/login`)
        .send({ email, password: "wrong" })
        .expect(401);
      const unknownEmail = await request(httpServer(app))
        .post(`${API}/auth/login`)
        .send({ email: "nobody@test.local", password: TEST_PASSWORD })
        .expect(401);
      expect(wrongPassword.body).toEqual(unknownEmail.body);
    });

    it("keeps the refresh token in an httpOnly cookie, out of the response body", async () => {
      const { email } = await createUser(app, UserRole.VIEWER);
      const response = await request(httpServer(app))
        .post(`${API}/auth/login`)
        .send({ email, password: TEST_PASSWORD })
        .expect(200);

      const cookie = (response.headers["set-cookie"] as unknown as string[]).join(";");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Strict");
      expect(cookie).toContain(`Path=${API}/auth`);
      expect(JSON.stringify(response.body)).not.toContain("refresh");
    });

    it("rotates the refresh token and revokes the family when a stale one is replayed", async () => {
      const { email } = await createUser(app, UserRole.VIEWER);
      const login = await request(httpServer(app))
        .post(`${API}/auth/login`)
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      const firstCookie = refreshCookieFrom(login);

      const refreshed = await request(httpServer(app))
        .post(`${API}/auth/refresh`)
        .set("Cookie", firstCookie)
        .expect(200);
      const secondCookie = refreshCookieFrom(refreshed);
      expect(secondCookie).not.toBe(firstCookie);

      // Within the grace period a replay is treated as two tabs racing.
      await request(httpServer(app))
        .post(`${API}/auth/refresh`)
        .set("Cookie", firstCookie)
        .expect(200);

      // Long after rotation it is treated as theft: the whole family dies, including the newest token.
      await app
        .get(DataSource)
        .query(
          `UPDATE refresh_tokens SET rotated_at = now() - interval '1 minute' WHERE rotated_at IS NOT NULL`,
        );
      await request(httpServer(app))
        .post(`${API}/auth/refresh`)
        .set("Cookie", firstCookie)
        .expect(401);
      await request(httpServer(app))
        .post(`${API}/auth/refresh`)
        .set("Cookie", secondCookie)
        .expect(401);
    });

    it("leaves no live token behind when a refresh and a logout race", async () => {
      for (let round = 0; round < 15; round += 1) {
        const { email } = await createUser(app, UserRole.VIEWER);
        const login = await request(httpServer(app))
          .post(`${API}/auth/login`)
          .send({ email, password: TEST_PASSWORD })
          .expect(200);
        const cookie = refreshCookieFrom(login);

        const [refreshed] = await Promise.all([
          request(httpServer(app)).post(`${API}/auth/refresh`).set("Cookie", cookie),
          request(httpServer(app)).post(`${API}/auth/logout`).set("Cookie", cookie),
        ]);

        // Whichever won, the family is gone: a token minted by the refresh must not work.
        if (refreshed.status === 200) {
          await request(httpServer(app))
            .post(`${API}/auth/refresh`)
            .set("Cookie", refreshCookieFrom(refreshed))
            .expect(401);
        }
      }
    });

    it("treats a malformed refresh cookie as no session rather than an error", async () => {
      for (const path of ["refresh", "logout"]) {
        await request(httpServer(app))
          .post(`${API}/auth/${path}`)
          .set("Cookie", "refresh_token=j:{}")
          .expect(401);
      }
    });

    it("revokes the session on logout", async () => {
      const { email } = await createUser(app, UserRole.VIEWER);
      const login = await request(httpServer(app))
        .post(`${API}/auth/login`)
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      const cookie = refreshCookieFrom(login);

      await request(httpServer(app)).post(`${API}/auth/logout`).set("Cookie", cookie).expect(200);
      await request(httpServer(app)).post(`${API}/auth/refresh`).set("Cookie", cookie).expect(401);
    });

    it("returns the current user", async () => {
      const token = await loginAs(app, UserRole.OPERATOR);
      const response = await request(httpServer(app))
        .get(`${API}/auth/me`)
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(response.body.role).toBe(UserRole.OPERATOR);
      expect(response.body.passwordHash).toBeUndefined();
    });
  });

  describe("rate limiting", () => {
    let limitedApp: NestExpressApplication;
    const originalLimit = process.env.AUTH_RATE_LIMIT_PER_MINUTE;

    beforeAll(async () => {
      process.env.AUTH_RATE_LIMIT_PER_MINUTE = "3";
      limitedApp = await createTestApp();
    });

    afterAll(async () => {
      process.env.AUTH_RATE_LIMIT_PER_MINUTE = originalLimit;
      await limitedApp.close();
    });

    it("throttles repeated login attempts", async () => {
      const attempt = () =>
        request(httpServer(limitedApp))
          .post(`${API}/auth/login`)
          .send({ email: "nobody@test.local", password: "wrong" });

      for (let attemptNumber = 0; attemptNumber < 3; attemptNumber += 1) {
        await attempt().expect(401);
      }
      await attempt().expect(429);
    });
  });
});
