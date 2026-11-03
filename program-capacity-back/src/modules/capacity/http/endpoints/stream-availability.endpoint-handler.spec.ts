import { HttpException, MessageEvent } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Subject } from "rxjs";
import { UserRole } from "@/modules/auth/auth.enums";
import { AuthedUser } from "@/modules/auth/auth.types";
import { TooManyStreamsError } from "@/modules/capacity/application/errors/too-many-streams.error";
import { AvailabilityStreamService } from "@/modules/capacity/application/services/availability-stream.service";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { StreamAvailabilityQueryDto } from "@/modules/capacity/http/dto/stream-availability-query.dto";
import { StreamAvailabilityEndpointHandler } from "@/modules/capacity/http/endpoints/stream-availability.endpoint-handler";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const HEARTBEAT_SECONDS = 15;
// Expires between two heartbeats, so a heartbeat never races the token expiry.
const TOKEN_LIFETIME_MS = 50_000;

const buildUser = (lifetimeMs = TOKEN_LIFETIME_MS): AuthedUser => ({
  id: "user-1",
  email: "viewer@capacity.local",
  role: UserRole.VIEWER,
  accessTokenExpiresAt: new Date(NOW.getTime() + lifetimeMs),
});

const buildProgram = (overrides: Partial<ProgramEntity> = {}): ProgramEntity => ({
  id: "11111111-1111-4111-8111-111111111111",
  code: "ACME-USD",
  name: "Acme Supply Chain Finance",
  currency: "USD",
  creditLimitMinor: 1_000_000_000n,
  reservedMinor: 250_000_000n,
  version: 42,
  lastTreasurySequence: 7,
  lastSnapshotSequence: 7,
  lastLimitSequence: 7,
  lastReconciledAt: null,
  createdAt: new Date("2026-10-01T08:00:00.000Z"),
  updatedAt: new Date("2026-11-03T09:59:00.000Z"),
  ...overrides,
});

describe("StreamAvailabilityEndpointHandler", () => {
  let changes$: Subject<ProgramEntity>;
  let shutdown$: Subject<void>;
  let release: jest.Mock;
  let admitStreamOrThrow: jest.Mock;
  let watchAvailability: jest.Mock;
  let getOrThrow: jest.Mock;
  let handler: StreamAvailabilityEndpointHandler;

  const open = (user = buildUser(), query: StreamAvailabilityQueryDto = {}) => {
    const received: MessageEvent[] = [];
    const outcome = { isComplete: false, error: undefined as unknown };
    const subscription = handler.handle(query, user).subscribe({
      next: (event) => received.push(event),
      error: (error) => {
        outcome.error = error;
      },
      complete: () => {
        outcome.isComplete = true;
      },
    });
    return { received, outcome, subscription };
  };

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    changes$ = new Subject<ProgramEntity>();
    shutdown$ = new Subject<void>();
    release = jest.fn();
    admitStreamOrThrow = jest.fn().mockReturnValue(release);
    watchAvailability = jest.fn().mockReturnValue(changes$.asObservable());
    getOrThrow = jest.fn().mockImplementation((key: string) => {
      if (key === "capacity.streamHeartbeatSeconds") {
        return HEARTBEAT_SECONDS;
      }
      throw new Error(`unexpected config key ${key}`);
    });
    handler = new StreamAvailabilityEndpointHandler(
      {
        admitStreamOrThrow,
        watchAvailability,
        shutdown$: shutdown$.asObservable(),
      } as unknown as AvailabilityStreamService,
      { getOrThrow } as unknown as ConfigService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("admission", () => {
    it("takes a stream place for the user who is asking", () => {
      open();

      expect(admitStreamOrThrow).toHaveBeenCalledTimes(1);
      expect(admitStreamOrThrow).toHaveBeenCalledWith("user-1");
    });

    it("keeps the place for as long as the stream is open", () => {
      open();

      jest.advanceTimersByTime(40_000);

      expect(release).not.toHaveBeenCalled();
    });

    it("answers 429 TOO_MANY_STREAMS and opens nothing when the user has no place left", () => {
      admitStreamOrThrow.mockImplementation(() => {
        throw new TooManyStreamsError("user-1", 3);
      });

      let thrown: unknown;
      try {
        handler.handle({}, buildUser());
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(HttpException);
      expect((thrown as HttpException).getStatus()).toBe(429);
      expect((thrown as HttpException).getResponse()).toMatchObject({ code: "TOO_MANY_STREAMS" });
      expect(watchAvailability).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
    });

    it("lets an unexpected admission failure through untouched", () => {
      const failure = new Error("boom");
      admitStreamOrThrow.mockImplementation(() => {
        throw failure;
      });

      expect(() => handler.handle({}, buildUser())).toThrow(failure);
    });
  });

  describe("what it sends", () => {
    it("watches every program when none is asked for", () => {
      open(buildUser(), {});

      expect(watchAvailability).toHaveBeenCalledWith({ programId: null });
    });

    it("watches only the program that was asked for", () => {
      open(buildUser(), { programId: "11111111-1111-4111-8111-111111111111" });

      expect(watchAvailability).toHaveBeenCalledWith({
        programId: "11111111-1111-4111-8111-111111111111",
      });
    });

    it("sends each change as an availability event whose id is the program version", () => {
      const { received } = open();

      changes$.next(buildProgram({ version: 42 }));
      changes$.next(
        buildProgram({
          id: "22222222-2222-4222-8222-222222222222",
          currency: "JPY",
          creditLimitMinor: 5_000_000n,
          reservedMinor: 5_000_400n,
          version: 7,
        }),
      );

      expect(received).toEqual([
        {
          id: "42",
          type: "availability",
          data: {
            programId: "11111111-1111-4111-8111-111111111111",
            currency: "USD",
            creditLimit: "10000000.00",
            reserved: "2500000.00",
            available: "7500000.00",
            isOverLimit: false,
            version: 42,
            lastReconciledAt: null,
            updatedAt: "2026-11-03T09:59:00.000Z",
          },
        },
        {
          id: "7",
          type: "availability",
          data: expect.objectContaining({
            programId: "22222222-2222-4222-8222-222222222222",
            available: "-400",
            isOverLimit: true,
            version: 7,
          }),
        },
      ]);
    });

    it("sends nothing while there is nothing to say and no heartbeat is due", () => {
      const { received } = open();

      jest.advanceTimersByTime(HEARTBEAT_SECONDS * 1000 - 1);

      expect(received).toEqual([]);
    });

    it("sends a heartbeat event every configured number of seconds", () => {
      const { received } = open();

      jest.advanceTimersByTime(HEARTBEAT_SECONDS * 1000);
      expect(received).toStrictEqual([{ type: "heartbeat", data: {} }]);

      jest.advanceTimersByTime(HEARTBEAT_SECONDS * 1000 - 1);
      expect(received).toHaveLength(1);

      jest.advanceTimersByTime(1);
      expect(received).toStrictEqual([
        { type: "heartbeat", data: {} },
        { type: "heartbeat", data: {} },
      ]);
    });

    it("keeps sending heartbeats between changes", () => {
      const { received } = open();

      changes$.next(buildProgram({ version: 42 }));
      jest.advanceTimersByTime(HEARTBEAT_SECONDS * 1000);
      changes$.next(buildProgram({ version: 43 }));

      expect(received.map(({ type, id }) => ({ type, id }))).toEqual([
        { type: "availability", id: "42" },
        { type: "heartbeat", id: undefined },
        { type: "availability", id: "43" },
      ]);
    });
  });

  describe("how it ends", () => {
    it("ends exactly when the access token expires and gives the place back", () => {
      const { outcome } = open();

      jest.advanceTimersByTime(TOKEN_LIFETIME_MS - 1);
      expect(outcome.isComplete).toBe(false);
      expect(release).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(outcome.isComplete).toBe(true);
      expect(release).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it("sends nothing more once the token has expired", () => {
      const { received } = open();
      jest.advanceTimersByTime(TOKEN_LIFETIME_MS);
      const sentBeforeExpiry = received.length;

      changes$.next(buildProgram({ version: 99 }));
      jest.advanceTimersByTime(10 * HEARTBEAT_SECONDS * 1000);

      expect(sentBeforeExpiry).toBe(3);
      expect(received).toHaveLength(sentBeforeExpiry);
    });

    it("ends at once for a token that has already expired", () => {
      const { outcome } = open(buildUser(-1_000));

      jest.advanceTimersByTime(0);

      expect(outcome.isComplete).toBe(true);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it("ends when the replica shuts down, however much of the token is left", () => {
      const { outcome, received } = open(buildUser(15 * 60 * 1000));

      shutdown$.next();

      expect(outcome.isComplete).toBe(true);
      expect(release).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);

      changes$.next(buildProgram());
      jest.advanceTimersByTime(HEARTBEAT_SECONDS * 1000);
      expect(received).toEqual([]);
    });

    it("gives the place back when the client goes away", () => {
      const { subscription, received } = open(buildUser(15 * 60 * 1000));

      subscription.unsubscribe();

      expect(release).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);

      changes$.next(buildProgram());
      jest.advanceTimersByTime(HEARTBEAT_SECONDS * 1000);
      expect(received).toEqual([]);
    });

    it("gives the place back when the stream fails", () => {
      const { outcome } = open();
      const failure = new Error("database unreachable");

      changes$.error(failure);

      expect(outcome.error).toBe(failure);
      expect(release).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it("gives the place back only once even when the client unsubscribes after the stream ended", () => {
      const { subscription } = open();

      jest.advanceTimersByTime(TOKEN_LIFETIME_MS);
      subscription.unsubscribe();
      shutdown$.next();

      expect(release).toHaveBeenCalledTimes(1);
    });
  });
});
