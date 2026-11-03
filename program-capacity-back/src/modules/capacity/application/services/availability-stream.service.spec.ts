import { ConfigService } from "@nestjs/config";
import { Subject, Subscription } from "rxjs";
import { TooManyStreamsError } from "@/modules/capacity/application/errors/too-many-streams.error";
import { AvailabilityStreamService } from "@/modules/capacity/application/services/availability-stream.service";
import { AVAILABILITY_STREAM_COALESCE_MS } from "@/modules/capacity/capacity.constants";
import { AvailabilityChangeNotification } from "@/modules/capacity/capacity.types";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { AvailabilityChangeChannelClient } from "@/modules/capacity/infrastructure/clients/availability-change-channel.client";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";
import { LoggerService } from "@/modules/logger/logger.service";
import { MetricsService } from "@/modules/metrics/metrics.service";

const WINDOW = AVAILABILITY_STREAM_COALESCE_MS;
const A = "program-a";
const B = "program-b";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const buildProgram = (id: string, version: number): ProgramEntity =>
  Object.assign(new ProgramEntity(), { id, code: id.toUpperCase(), version });

const labels = (programs: ProgramEntity[]) =>
  programs.map((program) => `${program.id}@${program.version}`);

describe("AvailabilityStreamService", () => {
  let changes: Subject<AvailabilityChangeNotification>;
  let reconnected: Subject<void>;
  let database: Map<string, ProgramEntity>;
  let findById: jest.Mock;
  let findManyOrderedByCode: jest.Mock;
  let maxStreamsPerUser: number;
  let incrementOpenAvailabilityStreams: jest.Mock;
  let decrementOpenAvailabilityStreams: jest.Mock;
  let logger: { error: jest.Mock; forContext: jest.Mock };
  let subscriptions: Subscription[];
  let service: AvailabilityStreamService;

  const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);
  const flush = () => advance(0);

  const store = (id: string, version: number) => database.set(id, buildProgram(id, version));

  const notify = (programId: string) => changes.next({ programId, version: 0 });

  const watch = (programId: string | null) => {
    const seen: ProgramEntity[] = [];
    const errors: unknown[] = [];
    const subscription = service.watchAvailability({ programId }).subscribe({
      next: (program) => seen.push(program),
      error: (error) => errors.push(error),
    });
    subscriptions.push(subscription);
    return { seen, errors, subscription };
  };

  beforeEach(() => {
    jest.useFakeTimers();
    changes = new Subject();
    reconnected = new Subject();
    database = new Map();
    store(A, 1);
    store(B, 1);
    findById = jest.fn(async (id: string) => database.get(id) ?? null);
    findManyOrderedByCode = jest.fn(async () =>
      [...database.values()].sort((first, second) => first.code.localeCompare(second.code)),
    );
    maxStreamsPerUser = 2;
    incrementOpenAvailabilityStreams = jest.fn();
    decrementOpenAvailabilityStreams = jest.fn();
    logger = { error: jest.fn(), forContext: jest.fn() };
    logger.forContext.mockReturnValue(logger);
    subscriptions = [];
    service = new AvailabilityStreamService(
      {
        changes$: changes.asObservable(),
        reconnected$: reconnected.asObservable(),
      } as unknown as AvailabilityChangeChannelClient,
      { findById, findManyOrderedByCode } as unknown as ProgramRepository,
      {
        getOrThrow: (key: string) => {
          if (key !== "capacity.maxStreamsPerUser") {
            throw new Error(`Unexpected config ${key}`);
          }
          return maxStreamsPerUser;
        },
      } as unknown as ConfigService,
      {
        incrementOpenAvailabilityStreams,
        decrementOpenAvailabilityStreams,
      } as unknown as MetricsService,
      logger as unknown as LoggerService,
    );
  });

  afterEach(() => {
    subscriptions.forEach((subscription) => subscription.unsubscribe());
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe("admitStreamOrThrow", () => {
    it("admits a user's streams up to the configured limit and refuses the next", () => {
      service.admitStreamOrThrow("user-1");
      service.admitStreamOrThrow("user-1");

      let refusal: unknown;
      try {
        service.admitStreamOrThrow("user-1");
      } catch (error) {
        refusal = error;
      }

      expect(refusal).toBeInstanceOf(TooManyStreamsError);
      expect(refusal).toMatchObject({ metadata: { targetUserId: "user-1", maxStreams: 2 } });
    });

    it("gives a place back when a stream ends", () => {
      service.admitStreamOrThrow("user-1");
      const release = service.admitStreamOrThrow("user-1");
      expect(() => service.admitStreamOrThrow("user-1")).toThrow(TooManyStreamsError);

      release();

      expect(() => service.admitStreamOrThrow("user-1")).not.toThrow();
      expect(() => service.admitStreamOrThrow("user-1")).toThrow(TooManyStreamsError);
    });

    it("starts from a clean count once every stream of a user has ended", () => {
      const releases = [service.admitStreamOrThrow("user-1"), service.admitStreamOrThrow("user-1")];
      releases.forEach((release) => release());

      service.admitStreamOrThrow("user-1");
      service.admitStreamOrThrow("user-1");

      expect(() => service.admitStreamOrThrow("user-1")).toThrow(TooManyStreamsError);
    });

    it("does not let a repeated release for a user with no open streams grant extra places", () => {
      const release = service.admitStreamOrThrow("user-1");
      release();
      release();

      service.admitStreamOrThrow("user-1");
      service.admitStreamOrThrow("user-1");

      expect(() => service.admitStreamOrThrow("user-1")).toThrow(TooManyStreamsError);
    });

    it("counts each user's streams on their own", () => {
      service.admitStreamOrThrow("user-1");
      service.admitStreamOrThrow("user-1");

      expect(() => service.admitStreamOrThrow("user-2")).not.toThrow();
    });

    it("follows the limit as configured at the time of the request", () => {
      maxStreamsPerUser = 1;
      service.admitStreamOrThrow("user-1");
      expect(() => service.admitStreamOrThrow("user-1")).toThrow(TooManyStreamsError);

      maxStreamsPerUser = 2;

      expect(() => service.admitStreamOrThrow("user-1")).not.toThrow();
    });

    it("keeps the open-streams gauge in step with admissions and endings, ignoring refusals", () => {
      const release = service.admitStreamOrThrow("user-1");
      service.admitStreamOrThrow("user-1");
      expect(() => service.admitStreamOrThrow("user-1")).toThrow(TooManyStreamsError);
      expect(incrementOpenAvailabilityStreams).toHaveBeenCalledTimes(2);
      expect(decrementOpenAvailabilityStreams).not.toHaveBeenCalled();

      release();

      expect(incrementOpenAvailabilityStreams).toHaveBeenCalledTimes(2);
      expect(decrementOpenAvailabilityStreams).toHaveBeenCalledTimes(1);
    });
  });

  describe("watchAvailability", () => {
    it("sends the current state first, then the state after each change", async () => {
      const watcher = watch(A);
      await flush();
      expect(labels(watcher.seen)).toEqual(["program-a@1"]);

      store(A, 2);
      notify(A);
      await advance(WINDOW);

      expect(labels(watcher.seen)).toEqual(["program-a@1", "program-a@2"]);
    });

    it("sends every program when none is asked for", async () => {
      const watcher = watch(null);
      await flush();

      expect(labels(watcher.seen)).toEqual(["program-a@1", "program-b@1"]);

      store(B, 2);
      notify(B);
      await advance(WINDOW);

      expect(labels(watcher.seen)).toEqual(["program-a@1", "program-b@1", "program-b@2"]);
    });

    it("sends no current state for a program that does not exist, and does not fail", async () => {
      const watcher = watch("program-unknown");
      await flush();

      expect(watcher.seen).toEqual([]);
      expect(watcher.errors).toEqual([]);
    });

    it("reads nothing until it is subscribed to", async () => {
      service.watchAvailability({ programId: A });
      service.watchAvailability({ programId: null });
      await flush();

      expect(findById).not.toHaveBeenCalled();
      expect(findManyOrderedByCode).not.toHaveBeenCalled();
    });

    it("delivers only the program that was asked for", async () => {
      const watcher = watch(A);
      await flush();

      store(B, 2);
      notify(B);
      store(A, 2);
      notify(A);
      await advance(WINDOW);
      reconnected.next();
      await flush();

      expect(watcher.seen.every((program) => program.id === A)).toBe(true);
      expect(labels(watcher.seen)).toEqual(["program-a@1", "program-a@2", "program-a@2"]);
    });

    it("is already listening for changes when it reads the current state", async () => {
      const wasListening: boolean[] = [];
      findById.mockImplementation(async (id: string) => {
        wasListening.push(changes.observed);
        return database.get(id) ?? null;
      });
      findManyOrderedByCode.mockImplementation(async () => {
        wasListening.push(changes.observed);
        return [...database.values()];
      });

      watch(A);
      watch(null);
      await flush();

      expect(wasListening).toEqual([true, true]);
    });

    it("delivers a change that happens while the current state is still being read", async () => {
      const baseline = deferred<ProgramEntity | null>();
      findById.mockImplementationOnce(() => baseline.promise);
      const watcher = watch(A);
      await flush();

      store(A, 2);
      notify(A);
      await advance(WINDOW);
      expect(labels(watcher.seen)).toEqual(["program-a@2"]);

      baseline.resolve(buildProgram(A, 1));
      await flush();

      expect(labels(watcher.seen)).toEqual(expect.arrayContaining(["program-a@1", "program-a@2"]));
    });

    it("reports a failure to read the current state to the subscriber", async () => {
      const failure = new Error("database down");
      findById.mockRejectedValueOnce(failure);

      const watcher = watch(A);
      await flush();

      expect(watcher.errors).toEqual([failure]);
    });
  });

  describe("changes", () => {
    it("reads a program once however many changes arrive within the coalescing window", async () => {
      const watcher = watch(A);
      await flush();
      expect(findById).toHaveBeenCalledTimes(1);

      for (const version of [2, 3, 4, 5, 6]) {
        store(A, version);
        notify(A);
        await advance(10);
      }
      await advance(WINDOW - 50 - 1);
      expect(findById).toHaveBeenCalledTimes(1);

      await advance(1);

      expect(findById).toHaveBeenCalledTimes(2);
      expect(labels(watcher.seen)).toEqual(["program-a@1", "program-a@6"]);
    });

    it("coalesces each program on its own, so a busy program does not hold up another", async () => {
      const watcher = watch(null);
      await flush();

      store(A, 2);
      notify(A);
      await advance(WINDOW / 2);
      store(B, 2);
      notify(B);
      await advance(WINDOW / 2);
      expect(labels(watcher.seen).slice(2)).toEqual(["program-a@2"]);

      await advance(WINDOW / 2);

      expect(labels(watcher.seen).slice(2)).toEqual(["program-a@2", "program-b@2"]);
    });

    it("starts a new window for changes after the previous one closed", async () => {
      const watcher = watch(A);
      await flush();

      store(A, 2);
      notify(A);
      await advance(WINDOW);
      store(A, 3);
      notify(A);
      await advance(WINDOW);

      expect(labels(watcher.seen)).toEqual(["program-a@1", "program-a@2", "program-a@3"]);
    });

    it("costs one read per change however many streams are watching", async () => {
      const first = watch(A);
      const second = watch(A);
      const everything = watch(null);
      await flush();
      findById.mockClear();
      findManyOrderedByCode.mockClear();

      store(A, 2);
      notify(A);
      await advance(WINDOW);

      expect(findById).toHaveBeenCalledTimes(1);
      expect(findManyOrderedByCode).not.toHaveBeenCalled();
      for (const watcher of [first, second, everything]) {
        expect(labels(watcher.seen).at(-1)).toBe("program-a@2");
      }
    });

    it("reads one program at a time, so states are delivered in order", async () => {
      const watcher = watch(A);
      await flush();
      const slowRead = deferred<ProgramEntity | null>();
      findById.mockImplementationOnce(() => slowRead.promise);

      notify(A);
      await advance(WINDOW);
      store(A, 3);
      notify(A);
      await advance(WINDOW);
      expect(findById).toHaveBeenCalledTimes(2);

      slowRead.resolve(buildProgram(A, 2));
      await flush();

      expect(findById).toHaveBeenCalledTimes(3);
      expect(labels(watcher.seen)).toEqual(["program-a@1", "program-a@2", "program-a@3"]);
    });

    it("carries on after a failed read, and says so", async () => {
      const watcher = watch(A);
      await flush();
      const failure = new Error("connection reset");
      findById.mockRejectedValueOnce(failure);

      notify(A);
      await advance(WINDOW);

      expect(watcher.errors).toEqual([]);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith("Could not load programs for availability stream", {
        error: failure,
        programId: A,
      });

      store(A, 2);
      notify(A);
      await advance(WINDOW);

      expect(labels(watcher.seen)).toEqual(["program-a@1", "program-a@2"]);
    });

    it("stops listening once the last stream has ended", async () => {
      const first = watch(A);
      const second = watch(null);
      await flush();
      expect(changes.observed).toBe(true);
      expect(reconnected.observed).toBe(true);

      first.subscription.unsubscribe();
      expect(changes.observed).toBe(true);

      second.subscription.unsubscribe();
      expect(changes.observed).toBe(false);
      expect(reconnected.observed).toBe(false);
    });
  });

  describe("after the change channel reconnects", () => {
    it("sends the current state of every program again, since notifications in between are lost", async () => {
      const everything = watch(null);
      const onlyA = watch(A);
      await flush();

      store(A, 2);
      store(B, 3);
      reconnected.next();
      await flush();

      expect(labels(everything.seen)).toEqual([
        "program-a@1",
        "program-b@1",
        "program-a@2",
        "program-b@3",
      ]);
      expect(labels(onlyA.seen)).toEqual(["program-a@1", "program-a@2"]);
    });

    it("drops the result of a reload that a later reconnect made obsolete", async () => {
      const watcher = watch(null);
      await flush();
      const firstReload = deferred<ProgramEntity[]>();
      const secondReload = deferred<ProgramEntity[]>();
      findManyOrderedByCode
        .mockImplementationOnce(() => firstReload.promise)
        .mockImplementationOnce(() => secondReload.promise);

      reconnected.next();
      reconnected.next();
      firstReload.resolve([buildProgram(A, 2)]);
      await flush();
      expect(labels(watcher.seen)).toEqual(["program-a@1", "program-b@1"]);

      secondReload.resolve([buildProgram(A, 3)]);
      await flush();

      expect(labels(watcher.seen)).toEqual(["program-a@1", "program-b@1", "program-a@3"]);
    });

    it("carries on after a failed reload, and says so", async () => {
      const watcher = watch(A);
      await flush();
      const failure = new Error("connection reset");
      findManyOrderedByCode.mockRejectedValueOnce(failure);

      reconnected.next();
      await flush();

      expect(watcher.errors).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith("Could not load programs for availability stream", {
        error: failure,
        programId: null,
      });

      store(A, 2);
      notify(A);
      await advance(WINDOW);

      expect(labels(watcher.seen)).toEqual(["program-a@1", "program-a@2"]);
    });
  });

  describe("shutdown", () => {
    it("tells open streams to end, once, when the module is destroyed", () => {
      const next = jest.fn();
      const complete = jest.fn();
      service.shutdown$.subscribe({ next, complete });
      expect(next).not.toHaveBeenCalled();

      service.onModuleDestroy();

      expect(next).toHaveBeenCalledTimes(1);
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it("tells a stream opened during the shutdown to end as well, or it would hold the shutdown up", () => {
      service.onModuleDestroy();

      const next = jest.fn();
      service.shutdown$.subscribe({ next });

      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
