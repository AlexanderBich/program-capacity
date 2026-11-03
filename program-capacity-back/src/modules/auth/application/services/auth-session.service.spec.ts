import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { hash, verify } from "@node-rs/argon2";
import { createHash } from "crypto";
import { DataSource, EntityManager } from "typeorm";
import { REFRESH_TOKEN_ROTATION_GRACE_MS } from "@/modules/auth/auth.constants";
import { UserRole } from "@/modules/auth/auth.enums";
import { InvalidCredentialsError } from "@/modules/auth/application/errors/invalid-credentials.error";
import { RefreshTokenInvalidError } from "@/modules/auth/application/errors/refresh-token-invalid.error";
import { AuthSessionService } from "@/modules/auth/application/services/auth-session.service";
import { RefreshTokenEntity } from "@/modules/auth/entities/refresh-token.entity";
import { UserEntity } from "@/modules/auth/entities/user.entity";
import { RefreshTokenRepository } from "@/modules/auth/infrastructure/repositories/refresh-token.repository";
import { UserRepository } from "@/modules/auth/infrastructure/repositories/user.repository";
import { LoggerService } from "@/modules/logger/logger.service";

// Real argon2id, with the cheapest parameters, so that hashing does not dominate the run.
jest.mock("@node-rs/argon2", () => {
  const actual = jest.requireActual("@node-rs/argon2");
  return {
    ...actual,
    hash: jest.fn((password: string) => actual.hash(password, { memoryCost: 8, timeCost: 1 })),
    verify: jest.fn(actual.verify),
  };
});

const NOW = new Date("2026-11-01T12:00:00.000Z");
const ACCESS_TTL_SECONDS = 900;
const REFRESH_TTL_SECONDS = 604_800;
const PASSWORD = "right-password";

// Only the clock is faked: signing a token and hashing a password need the real timers.
const EVERYTHING_BUT_DATE = [
  "hrtime",
  "nextTick",
  "performance",
  "queueMicrotask",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "setImmediate",
  "clearImmediate",
  "setInterval",
  "clearInterval",
  "setTimeout",
  "clearTimeout",
] as const;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const buildHarness = (user: UserEntity) => {
  const users = [user];
  let tokens: RefreshTokenEntity[] = [];
  let nextTokenNumber = 1;
  const events: string[] = [];
  const whileWaitingForLock: { run: () => void } = { run: () => undefined };

  const defaultManager = { kind: "default" } as unknown as EntityManager;
  const transactionManager = { kind: "transaction" } as unknown as EntityManager;
  const where = (manager?: EntityManager) =>
    manager === transactionManager
      ? "in transaction"
      : manager
        ? "on another connection"
        : "without one";

  const userRepository = {
    findByEmail: jest.fn(
      async (email: string) => users.find((candidate) => candidate.email === email) ?? null,
    ),
  };

  const refreshTokenRepository = {
    findByTokenHashWithUser: jest.fn(async (tokenHash: string, manager?: EntityManager) => {
      events.push(`read ${where(manager)}`);
      const token = tokens.find((candidate) => candidate.tokenHash === tokenHash);
      return token
        ? { ...token, user: users.find((candidate) => candidate.id === token.userId) }
        : null;
    }),
    lockFamilyForTransaction: jest.fn(async (manager: EntityManager) => {
      events.push(`lock ${where(manager)}`);
      whileWaitingForLock.run();
    }),
    create: jest.fn(async (manager: EntityManager, values: Partial<RefreshTokenEntity>) => {
      events.push(`create ${where(manager)}`);
      tokens.push({
        id: `token-${nextTokenNumber++}`,
        createdAt: new Date(),
        ...values,
      } as RefreshTokenEntity);
    }),
    markRotatedByIdIfNotYetRotated: jest.fn(
      async (manager: EntityManager, id: string, rotatedAt: Date) => {
        events.push(`mark rotated ${where(manager)}`);
        const token = tokens.find(
          (candidate) => candidate.id === id && candidate.rotatedAt === null,
        );
        if (token) {
          token.rotatedAt = rotatedAt;
        }
      },
    ),
    revokeActiveByFamilyId: jest.fn(
      async (manager: EntityManager, familyId: string, revokedAt: Date) => {
        events.push(`revoke family ${where(manager)}`);
        for (const token of tokens) {
          if (token.familyId === familyId && token.revokedAt === null) {
            token.revokedAt = revokedAt;
          }
        }
      },
    ),
  };

  // A rolled-back transaction leaves no trace, a committed one keeps everything it wrote.
  const dataSource = {
    manager: defaultManager,
    transaction: jest.fn(async (work: (manager: EntityManager) => Promise<unknown>) => {
      const snapshot = tokens.map((token) => ({ ...token }));
      try {
        return await work(transactionManager);
      } catch (error) {
        tokens = snapshot;
        throw error;
      }
    }),
  };

  const logger = { warn: jest.fn(), forContext: jest.fn() };
  logger.forContext.mockReturnValue(logger);

  const jwtService = new JwtService({
    secret: "unit-test-secret-unit-test-secret-0123",
    signOptions: { expiresIn: ACCESS_TTL_SECONDS },
  });

  const service = new AuthSessionService(
    dataSource as unknown as DataSource,
    jwtService,
    userRepository as unknown as UserRepository,
    refreshTokenRepository as unknown as RefreshTokenRepository,
    {
      getOrThrow: (key: string) => {
        if (key !== "auth.refreshTtlSeconds") {
          throw new Error(`Unexpected config key ${key}`);
        }
        return REFRESH_TTL_SECONDS;
      },
    } as unknown as ConfigService,
    logger as unknown as LoggerService,
  );

  return {
    service,
    jwtService,
    logger,
    events,
    dataSource,
    refreshTokenRepository,
    whileWaitingForLock,
    tokens: () => tokens,
    tokenRow: (refreshToken: string) => {
      const row = tokens.find((candidate) => candidate.tokenHash === sha256(refreshToken));
      if (!row) {
        throw new Error("No stored token for that refresh token");
      }
      return row;
    },
  };
};

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject");
};

describe("AuthSessionService", () => {
  let user: UserEntity;
  let harness: ReturnType<typeof buildHarness>;
  const verifyMock = jest.mocked(verify);

  beforeAll(async () => {
    user = {
      id: "7b0a3f1e-3d1c-4a52-9e37-0a1f1f4c9a11",
      email: "operator@capacity.local",
      passwordHash: await hash(PASSWORD),
      role: UserRole.OPERATOR,
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    };
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: [...EVERYTHING_BUT_DATE] });
    user.isActive = true;
    harness = buildHarness(user);
    verifyMock.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("login", () => {
    it("issues a session for the right credentials", async () => {
      const session = await harness.service.login({ email: user.email, password: PASSWORD });

      expect(session.user).toBe(user);
      expect(harness.jwtService.verify(session.accessToken)).toMatchObject({
        sub: user.id,
        email: "operator@capacity.local",
        role: UserRole.OPERATOR,
      });
      expect(session.accessTokenExpiresAt).toEqual(at(ACCESS_TTL_SECONDS * 1000));
      expect(session.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(session.refreshTokenExpiresAt).toEqual(at(REFRESH_TTL_SECONDS * 1000));
    });

    it("stores only a hash of the refresh token, as the first token of a new session family", async () => {
      const session = await harness.service.login({ email: user.email, password: PASSWORD });

      expect(harness.tokens()).toHaveLength(1);
      const [stored] = harness.tokens();
      expect(stored.tokenHash).toBe(sha256(session.refreshToken));
      expect(JSON.stringify(stored)).not.toContain(session.refreshToken);
      expect(stored).toMatchObject({
        userId: user.id,
        expiresAt: session.refreshTokenExpiresAt,
        rotatedAt: null,
        revokedAt: null,
      });
      expect(stored.familyId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it("starts a separate family for every login", async () => {
      await harness.service.login({ email: user.email, password: PASSWORD });
      await harness.service.login({ email: user.email, password: PASSWORD });

      const [first, second] = harness.tokens();
      expect(first.familyId).not.toBe(second.familyId);
    });

    it("finds the account whatever the case of the email it is given", async () => {
      const session = await harness.service.login({
        email: "Operator@Capacity.LOCAL",
        password: PASSWORD,
      });

      expect(session.user).toBe(user);
    });

    it("refuses a wrong password and stores nothing", async () => {
      const error = await rejectionOf(
        harness.service.login({ email: user.email, password: "wrong-password" }),
      );

      expect(error).toBeInstanceOf(InvalidCredentialsError);
      expect(harness.tokens()).toHaveLength(0);
    });

    it("refuses an unknown email after checking the password against a decoy hash, so timing does not reveal which accounts exist", async () => {
      const error = await rejectionOf(
        harness.service.login({ email: "nobody@capacity.local", password: "whatever" }),
      );

      expect(error).toBeInstanceOf(InvalidCredentialsError);
      expect(verifyMock).toHaveBeenCalledTimes(1);
      const [checkedHash, checkedPassword] = verifyMock.mock.calls[0];
      expect(checkedHash).toMatch(/^\$argon2id\$/);
      expect(checkedHash).not.toBe(user.passwordHash);
      expect(checkedPassword).toBe("whatever");
      expect(harness.tokens()).toHaveLength(0);
    });

    it("refuses a deactivated account even for the right password, after checking it like any other", async () => {
      user.isActive = false;

      const error = await rejectionOf(
        harness.service.login({ email: user.email, password: PASSWORD }),
      );

      expect(error).toBeInstanceOf(InvalidCredentialsError);
      expect(verifyMock).toHaveBeenCalledTimes(1);
      expect(verifyMock.mock.calls[0][0]).toBe(user.passwordHash);
      expect(harness.tokens()).toHaveLength(0);
    });

    it("gives the same refusal whether the email is unknown, the account is deactivated or the password is wrong", async () => {
      const unknown = await rejectionOf(
        harness.service.login({ email: "nobody@capacity.local", password: PASSWORD }),
      );
      const wrongPassword = await rejectionOf(
        harness.service.login({ email: user.email, password: "nope" }),
      );
      user.isActive = false;
      const deactivated = await rejectionOf(
        harness.service.login({ email: user.email, password: PASSWORD }),
      );

      for (const error of [unknown, wrongPassword, deactivated]) {
        expect(error).toBeInstanceOf(InvalidCredentialsError);
        expect((error as Error).message).toBe("Invalid email or password");
      }
    });
  });

  describe("rotateRefreshToken", () => {
    const login = () => harness.service.login({ email: user.email, password: PASSWORD });

    it("exchanges a live refresh token for a new session of the same family", async () => {
      const first = await login();
      jest.setSystemTime(at(60 * 60 * 1000));

      const second = await harness.service.rotateRefreshToken(first.refreshToken);

      expect(second.user).toBe(user);
      expect(second.refreshToken).not.toBe(first.refreshToken);
      expect(second.accessToken).not.toBe(first.accessToken);
      expect(harness.jwtService.verify(second.accessToken)).toMatchObject({ sub: user.id });
      expect(second.accessTokenExpiresAt).toEqual(at(60 * 60 * 1000 + ACCESS_TTL_SECONDS * 1000));
      expect(second.refreshTokenExpiresAt).toEqual(at(60 * 60 * 1000 + REFRESH_TTL_SECONDS * 1000));
      expect(harness.tokenRow(second.refreshToken)).toMatchObject({
        userId: user.id,
        familyId: harness.tokenRow(first.refreshToken).familyId,
        tokenHash: sha256(second.refreshToken),
        rotatedAt: null,
        revokedAt: null,
      });
    });

    it("marks the token it consumed as rotated at that moment, without revoking it", async () => {
      const first = await login();
      jest.setSystemTime(at(60_000));

      await harness.service.rotateRefreshToken(first.refreshToken);

      expect(harness.tokenRow(first.refreshToken)).toMatchObject({
        rotatedAt: at(60_000),
        revokedAt: null,
      });
    });

    it("lets each new refresh token be rotated in turn", async () => {
      let session = await login();
      for (let step = 1; step <= 3; step += 1) {
        jest.setSystemTime(at(step * 60_000));
        session = await harness.service.rotateRefreshToken(session.refreshToken);
      }

      expect(harness.tokens()).toHaveLength(4);
      expect(new Set(harness.tokens().map((token) => token.familyId)).size).toBe(1);
      expect(harness.tokens().filter((token) => token.rotatedAt === null)).toHaveLength(1);
    });

    it("takes the family's lock before reading the token again and writing, and does all of it in one transaction", async () => {
      const first = await login();
      harness.events.length = 0;

      await harness.service.rotateRefreshToken(first.refreshToken);

      expect(harness.events).toEqual([
        "read without one",
        "lock in transaction",
        "read in transaction",
        "mark rotated in transaction",
        "create in transaction",
      ]);
    });

    it("refuses a token nobody issued, and opens no transaction for it", async () => {
      await login();

      const error = await rejectionOf(harness.service.rotateRefreshToken("made-up-token"));

      expect(error).toBeInstanceOf(RefreshTokenInvalidError);
      expect(harness.dataSource.transaction).not.toHaveBeenCalled();
      expect(harness.tokens()).toHaveLength(1);
    });

    it("refuses a token that has expired, and issues nothing", async () => {
      const first = await login();
      jest.setSystemTime(at(REFRESH_TTL_SECONDS * 1000 + 1));

      const error = await rejectionOf(harness.service.rotateRefreshToken(first.refreshToken));

      expect(error).toBeInstanceOf(RefreshTokenInvalidError);
      expect(harness.tokens()).toHaveLength(1);
    });

    it("treats the very instant of expiry as expired, and the moment before as live", async () => {
      const first = await login();

      jest.setSystemTime(first.refreshTokenExpiresAt);
      expect(
        await rejectionOf(harness.service.rotateRefreshToken(first.refreshToken)),
      ).toBeInstanceOf(RefreshTokenInvalidError);

      jest.setSystemTime(new Date(first.refreshTokenExpiresAt.getTime() - 1));
      await expect(harness.service.rotateRefreshToken(first.refreshToken)).resolves.toMatchObject({
        user: { id: user.id },
      });
    });

    it("refuses a token that was revoked, and issues nothing", async () => {
      const first = await login();
      await harness.service.revokeSession(first.refreshToken);
      const issuedSoFar = harness.tokens().length;

      const error = await rejectionOf(harness.service.rotateRefreshToken(first.refreshToken));

      expect(error).toBeInstanceOf(RefreshTokenInvalidError);
      expect(harness.tokens()).toHaveLength(issuedSoFar);
    });

    it("refuses a token whose user has been deactivated since", async () => {
      const first = await login();
      user.isActive = false;

      const error = await rejectionOf(harness.service.rotateRefreshToken(first.refreshToken));

      expect(error).toBeInstanceOf(RefreshTokenInvalidError);
      expect(harness.tokens()).toHaveLength(1);
    });

    it("honours a logout that took the family's lock first", async () => {
      const first = await login();
      harness.whileWaitingForLock.run = () => {
        for (const token of harness.tokens()) {
          token.revokedAt = new Date();
        }
      };

      const error = await rejectionOf(harness.service.rotateRefreshToken(first.refreshToken));

      expect(error).toBeInstanceOf(RefreshTokenInvalidError);
      expect(harness.tokens()).toHaveLength(1);
      expect(harness.tokenRow(first.refreshToken).rotatedAt).toBeNull();
    });

    describe("a token that was already rotated", () => {
      it("is treated as two tabs refreshing together when it comes back within the grace period, and gets another session of the family", async () => {
        const first = await login();
        jest.setSystemTime(at(60_000));
        const second = await harness.service.rotateRefreshToken(first.refreshToken);

        jest.setSystemTime(at(60_000 + REFRESH_TOKEN_ROTATION_GRACE_MS));
        const third = await harness.service.rotateRefreshToken(first.refreshToken);

        expect(third.refreshToken).not.toBe(second.refreshToken);
        expect(harness.tokenRow(third.refreshToken).familyId).toBe(
          harness.tokenRow(first.refreshToken).familyId,
        );
        expect(harness.tokens().every((token) => token.revokedAt === null)).toBe(true);
        expect(harness.logger.warn).not.toHaveBeenCalled();
      });

      it("keeps counting the grace period from the first rotation, however often it is replayed inside it", async () => {
        const first = await login();
        jest.setSystemTime(at(60_000));
        await harness.service.rotateRefreshToken(first.refreshToken);

        jest.setSystemTime(at(60_000 + REFRESH_TOKEN_ROTATION_GRACE_MS / 2));
        await harness.service.rotateRefreshToken(first.refreshToken);
        expect(harness.tokenRow(first.refreshToken).rotatedAt).toEqual(at(60_000));

        jest.setSystemTime(at(60_000 + REFRESH_TOKEN_ROTATION_GRACE_MS + 1));
        const error = await rejectionOf(harness.service.rotateRefreshToken(first.refreshToken));

        expect(error).toBeInstanceOf(RefreshTokenInvalidError);
      });

      it("is treated as theft once the grace period is over: the caller gets an error and the whole family is revoked, the newest token included", async () => {
        const first = await login();
        jest.setSystemTime(at(60_000));
        const second = await harness.service.rotateRefreshToken(first.refreshToken);
        const replayTime = at(60_000 + REFRESH_TOKEN_ROTATION_GRACE_MS + 1);
        jest.setSystemTime(replayTime);

        const error = await rejectionOf(harness.service.rotateRefreshToken(first.refreshToken));

        expect(error).toBeInstanceOf(RefreshTokenInvalidError);
        expect(harness.tokens()).toHaveLength(2);
        expect(harness.tokenRow(first.refreshToken).revokedAt).toEqual(replayTime);
        expect(harness.tokenRow(second.refreshToken).revokedAt).toEqual(replayTime);
        expect(
          await rejectionOf(harness.service.rotateRefreshToken(second.refreshToken)),
        ).toBeInstanceOf(RefreshTokenInvalidError);
      });

      it("leaves the user's other sessions alone when it revokes the stolen one", async () => {
        const stolen = await login();
        const other = await login();
        jest.setSystemTime(at(60_000));
        await harness.service.rotateRefreshToken(stolen.refreshToken);
        jest.setSystemTime(at(60_000 + REFRESH_TOKEN_ROTATION_GRACE_MS + 1));

        await rejectionOf(harness.service.rotateRefreshToken(stolen.refreshToken));

        expect(harness.tokenRow(other.refreshToken).revokedAt).toBeNull();
        await expect(harness.service.rotateRefreshToken(other.refreshToken)).resolves.toMatchObject(
          {
            user: { id: user.id },
          },
        );
      });

      it("is reported with the session family and the user it concerned", async () => {
        const first = await login();
        jest.setSystemTime(at(60_000));
        await harness.service.rotateRefreshToken(first.refreshToken);
        jest.setSystemTime(at(60_000 + REFRESH_TOKEN_ROTATION_GRACE_MS + 1));

        await rejectionOf(harness.service.rotateRefreshToken(first.refreshToken));

        expect(harness.logger.warn).toHaveBeenCalledTimes(1);
        expect(harness.logger.warn).toHaveBeenCalledWith(
          "Rotated refresh token replayed, session family revoked",
          {
            familyId: harness.tokenRow(first.refreshToken).familyId,
            targetUserId: user.id,
          },
        );
      });

      it("is refused without a word once it has expired, whether or not it was rotated", async () => {
        const first = await login();
        jest.setSystemTime(at(60_000));
        await harness.service.rotateRefreshToken(first.refreshToken);
        jest.setSystemTime(first.refreshTokenExpiresAt);

        const error = await rejectionOf(harness.service.rotateRefreshToken(first.refreshToken));

        expect(error).toBeInstanceOf(RefreshTokenInvalidError);
        expect(harness.logger.warn).not.toHaveBeenCalled();
      });
    });
  });

  describe("revokeSession", () => {
    const login = () => harness.service.login({ email: user.email, password: PASSWORD });

    it("revokes every token of the session, so none of them can be refreshed again", async () => {
      const first = await login();
      jest.setSystemTime(at(60_000));
      const second = await harness.service.rotateRefreshToken(first.refreshToken);
      jest.setSystemTime(at(120_000));

      await harness.service.revokeSession(second.refreshToken);

      expect(harness.tokenRow(first.refreshToken).revokedAt).toEqual(at(120_000));
      expect(harness.tokenRow(second.refreshToken).revokedAt).toEqual(at(120_000));
      for (const refreshToken of [first.refreshToken, second.refreshToken]) {
        expect(await rejectionOf(harness.service.rotateRefreshToken(refreshToken))).toBeInstanceOf(
          RefreshTokenInvalidError,
        );
      }
    });

    it("leaves the user's other sessions signed in", async () => {
      const leaving = await login();
      const staying = await login();

      await harness.service.revokeSession(leaving.refreshToken);

      expect(harness.tokenRow(staying.refreshToken).revokedAt).toBeNull();
      await expect(harness.service.rotateRefreshToken(staying.refreshToken)).resolves.toMatchObject(
        {
          user: { id: user.id },
        },
      );
    });

    it("takes the family's lock before it revokes, inside one transaction", async () => {
      const first = await login();
      harness.events.length = 0;

      await harness.service.revokeSession(first.refreshToken);

      expect(harness.events).toEqual([
        "read without one",
        "lock in transaction",
        "revoke family in transaction",
      ]);
    });

    it("refuses a token nobody issued and changes nothing", async () => {
      const first = await login();

      const error = await rejectionOf(harness.service.revokeSession("made-up-token"));

      expect(error).toBeInstanceOf(RefreshTokenInvalidError);
      expect(harness.dataSource.transaction).not.toHaveBeenCalled();
      expect(harness.tokenRow(first.refreshToken).revokedAt).toBeNull();
    });
  });
});
