import { ConfigService } from "@nestjs/config";
import { DataSource, EntityManager, QueryFailedError } from "typeorm";
import { ProgramLockTimeoutError } from "@/modules/capacity/application/errors/program-lock-timeout.error";
import { ProgramNotFoundError } from "@/modules/capacity/application/errors/program-not-found.error";
import { ProgramLockService } from "@/modules/capacity/application/services/program-lock.service";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";
import { MetricsService } from "@/modules/metrics/metrics.service";

const LOCK_TIMEOUT_MS = 5000;

const deferred = <T = string>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

type Outcome = { state: "pending" | "resolved" | "rejected"; error?: unknown };

const track = (promise: Promise<unknown>): Outcome => {
  const outcome: Outcome = { state: "pending" };
  promise.then(
    () => {
      outcome.state = "resolved";
    },
    (error) => {
      outcome.state = "rejected";
      outcome.error = error;
    },
  );
  return outcome;
};

const lockTimeoutFailure = () =>
  new QueryFailedError(
    "SELECT",
    [],
    Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" }),
  );

describe("ProgramLockService", () => {
  const manager = { name: "transaction" } as unknown as EntityManager;
  let calls: string[];
  let startOrder: string[];
  let transaction: jest.Mock;
  let findByIdWithWriteLock: jest.Mock;
  let findByCodeWithWriteLock: jest.Mock;
  let setTransactionLockTimeout: jest.Mock;
  let observeProgramLockWait: jest.Mock;
  let recordProgramLockTimeout: jest.Mock;
  let service: ProgramLockService;

  const buildProgram = (key: string) =>
    Object.assign(new ProgramEntity(), { id: key, code: key.toUpperCase() });

  const flush = () => jest.advanceTimersByTimeAsync(0);

  const startWriter = (label: string, programKey = "program-1") => {
    const gate = deferred();
    const outcome = track(
      service.withLockedProgramById(programKey, async () => {
        startOrder.push(label);
        return gate.promise;
      }),
    );
    return { gate, outcome };
  };

  beforeEach(() => {
    jest.useFakeTimers();
    calls = [];
    startOrder = [];
    transaction = jest.fn((work) => work(manager));
    findByIdWithWriteLock = jest.fn(async (_manager: EntityManager, id: string) => {
      calls.push("lock row");
      return buildProgram(id);
    });
    findByCodeWithWriteLock = jest.fn(async (_manager: EntityManager, code: string) => {
      calls.push("lock row");
      return buildProgram(code.toLowerCase());
    });
    setTransactionLockTimeout = jest.fn(async () => {
      calls.push("set lock_timeout");
    });
    observeProgramLockWait = jest.fn();
    recordProgramLockTimeout = jest.fn();
    service = new ProgramLockService(
      { transaction } as unknown as DataSource,
      {
        findByIdWithWriteLock,
        findByCodeWithWriteLock,
        setTransactionLockTimeout,
      } as unknown as ProgramRepository,
      {
        getOrThrow: (key: string) => {
          if (key !== "capacity.lockTimeoutMs") {
            throw new Error(`Unexpected config ${key}`);
          }
          return LOCK_TIMEOUT_MS;
        },
      } as unknown as ConfigService,
      { observeProgramLockWait, recordProgramLockTimeout } as unknown as MetricsService,
    );
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe("running work under the program's lock", () => {
    it("hands the work the transaction and the locked program, and returns what it returns", async () => {
      const work = jest.fn(async () => "result");

      const result = await service.withLockedProgramById("program-1", work);

      expect(result).toBe("result");
      expect(work).toHaveBeenCalledTimes(1);
      const [receivedManager, receivedProgram] = work.mock.calls[0] as unknown as [
        EntityManager,
        ProgramEntity,
      ];
      expect(receivedManager).toBe(manager);
      expect(receivedProgram).toMatchObject({ id: "program-1" });
    });

    it("sets the lock timeout for the transaction before taking the row lock, and only then runs the work", async () => {
      await service.withLockedProgramById("program-1", async () => {
        calls.push("work");
      });

      expect(calls).toEqual(["set lock_timeout", "lock row", "work"]);
      expect(setTransactionLockTimeout).toHaveBeenCalledWith(manager, LOCK_TIMEOUT_MS);
    });

    it("finds the program by id or by code as asked", async () => {
      await service.withLockedProgramById("program-1", async () => undefined);
      await service.withLockedProgramByCode("PROGRAM-2", async () => undefined);

      expect(findByIdWithWriteLock).toHaveBeenCalledTimes(1);
      expect(findByIdWithWriteLock).toHaveBeenCalledWith(manager, "program-1");
      expect(findByCodeWithWriteLock).toHaveBeenCalledTimes(1);
      expect(findByCodeWithWriteLock).toHaveBeenCalledWith(manager, "PROGRAM-2");
    });

    it("reports an unknown program by the id or code it was asked for, without running the work", async () => {
      findByIdWithWriteLock.mockResolvedValue(null);
      findByCodeWithWriteLock.mockResolvedValue(null);
      const work = jest.fn();

      const byId = service.withLockedProgramById("missing-id", work);
      const byCode = service.withLockedProgramByCode("MISSING-CODE", work);

      await expect(byId).rejects.toBeInstanceOf(ProgramNotFoundError);
      await expect(byId).rejects.toMatchObject({ metadata: { programReference: "missing-id" } });
      await expect(byCode).rejects.toBeInstanceOf(ProgramNotFoundError);
      await expect(byCode).rejects.toMatchObject({
        metadata: { programReference: "MISSING-CODE" },
      });
      expect(work).not.toHaveBeenCalled();
    });
  });

  describe("admission", () => {
    it("lets two writers per program run at once and holds the next back", async () => {
      const first = startWriter("first");
      startWriter("second");
      startWriter("third");
      await flush();

      expect(startOrder).toEqual(["first", "second"]);

      first.gate.resolve("done");
      await flush();

      expect(startOrder).toEqual(["first", "second", "third"]);
    });

    it("admits waiting writers in the order they arrived", async () => {
      const writers = ["a", "b", "c", "d", "e"].map((label) => startWriter(label));
      await flush();
      expect(startOrder).toEqual(["a", "b"]);

      writers[0].gate.resolve("done");
      await flush();
      expect(startOrder).toEqual(["a", "b", "c"]);

      writers[1].gate.resolve("done");
      await flush();
      expect(startOrder).toEqual(["a", "b", "c", "d"]);

      writers[2].gate.resolve("done");
      await flush();
      expect(startOrder).toEqual(["a", "b", "c", "d", "e"]);
    });

    it("queues per program, so a busy program does not hold up another", async () => {
      startWriter("a1", "program-a");
      startWriter("a2", "program-a");
      startWriter("a3", "program-a");
      startWriter("b1", "program-b");
      await flush();

      expect(startOrder).toEqual(["a1", "a2", "b1"]);
    });

    it("applies the same admission limit to writers addressing the program by code", async () => {
      const gate = deferred();
      const hold = (label: string) =>
        service.withLockedProgramByCode("PROGRAM-1", async () => {
          startOrder.push(label);
          return gate.promise;
        });
      track(hold("first"));
      track(hold("second"));
      track(hold("third"));
      await flush();

      expect(startOrder).toEqual(["first", "second"]);

      gate.resolve("done");
      await flush();

      expect(startOrder).toEqual(["first", "second", "third"]);
    });

    it("gives the place back when the work fails, so queued writers are admitted", async () => {
      const failure = new Error("boom");
      const outcomes = Array.from({ length: 4 }, () =>
        track(
          service.withLockedProgramById("program-1", async () => {
            throw failure;
          }),
        ),
      );
      await flush();

      expect(outcomes.map((outcome) => outcome.state)).toEqual(Array(4).fill("rejected"));
      expect(outcomes.every((outcome) => outcome.error === failure)).toBe(true);
    });

    it("gives the place back when the program does not exist", async () => {
      findByIdWithWriteLock.mockResolvedValue(null);
      const outcomes = Array.from({ length: 4 }, () =>
        track(service.withLockedProgramById("program-1", async () => undefined)),
      );
      await flush();

      expect(outcomes.map((outcome) => outcome.state)).toEqual(Array(4).fill("rejected"));
      expect(outcomes.every((outcome) => outcome.error instanceof ProgramNotFoundError)).toBe(true);
    });

    it("gives the place back when the database refuses the lock", async () => {
      transaction.mockRejectedValue(lockTimeoutFailure());
      const outcomes = Array.from({ length: 4 }, () =>
        track(service.withLockedProgramById("program-1", async () => undefined)),
      );
      await flush();

      expect(outcomes.map((outcome) => outcome.state)).toEqual(Array(4).fill("rejected"));
    });

    it("does not keep bookkeeping for a program once nobody is writing to it", async () => {
      const slotsByProgram = (service as unknown as { slotsByProgram: Map<string, unknown> })
        .slotsByProgram;
      const first = startWriter("first");
      const second = startWriter("second");
      await flush();
      expect(slotsByProgram.size).toBe(1);

      first.gate.resolve("done");
      await flush();
      expect(slotsByProgram.size).toBe(1);

      second.gate.resolve("done");
      await flush();
      expect(slotsByProgram.size).toBe(0);
    });
  });

  describe("waiting in the queue", () => {
    it("gives up on a writer that has waited a full lock timeout", async () => {
      const holders = [startWriter("first"), startWriter("second")];
      const waiter = startWriter("waiter");
      await flush();

      await jest.advanceTimersByTimeAsync(LOCK_TIMEOUT_MS - 1);
      expect(waiter.outcome.state).toBe("pending");

      await jest.advanceTimersByTimeAsync(1);
      expect(waiter.outcome.state).toBe("rejected");
      expect(waiter.outcome.error).toBeInstanceOf(ProgramLockTimeoutError);
      expect(recordProgramLockTimeout).toHaveBeenCalledTimes(1);
      expect(startOrder).toEqual(["first", "second"]);
      expect(holders.map((holder) => holder.outcome.state)).toEqual(["pending", "pending"]);
    });

    it("does not hand a place to a writer that already gave up", async () => {
      const first = startWriter("first");
      const second = startWriter("second");
      const gaveUp = startWriter("gave-up");
      await flush();
      await jest.advanceTimersByTimeAsync(LOCK_TIMEOUT_MS - 100);
      const patient = startWriter("patient");
      await flush();
      await jest.advanceTimersByTimeAsync(100);
      expect(gaveUp.outcome.state).toBe("rejected");

      first.gate.resolve("done");
      await flush();

      expect(startOrder).toEqual(["first", "second", "patient"]);
      expect(patient.outcome.state).toBe("pending");

      second.gate.resolve("done");
      patient.gate.resolve("done");
      await flush();
      expect(patient.outcome.state).toBe("resolved");
    });

    it("keeps to two writers per program after a queued writer gave up", async () => {
      const first = startWriter("first");
      startWriter("second");
      startWriter("gave-up");
      await flush();
      await jest.advanceTimersByTimeAsync(LOCK_TIMEOUT_MS);

      first.gate.resolve("done");
      await flush();
      startWriter("late-a");
      startWriter("late-b");
      await flush();

      expect(startOrder).toEqual(["first", "second", "late-a"]);
    });

    it("does not time out a writer that was admitted before its wait ran out", async () => {
      const first = startWriter("first");
      startWriter("second");
      const waiter = startWriter("waiter");
      const lastInLine = startWriter("last-in-line");
      await flush();
      await jest.advanceTimersByTimeAsync(1000);
      first.gate.resolve("done");
      await flush();
      expect(startOrder).toEqual(["first", "second", "waiter"]);

      await jest.advanceTimersByTimeAsync(LOCK_TIMEOUT_MS);

      expect(waiter.outcome.state).toBe("pending");
      expect(recordProgramLockTimeout).toHaveBeenCalledTimes(1);
      expect(lastInLine.outcome.state).toBe("rejected");
    });

    it("observes how long a writer waited for the lock, queue time included", async () => {
      const first = startWriter("first");
      startWriter("second");
      startWriter("waiter");
      await flush();
      expect(observeProgramLockWait.mock.calls).toEqual([[0], [0]]);

      await jest.advanceTimersByTimeAsync(300);
      first.gate.resolve("done");
      await flush();

      expect(observeProgramLockWait).toHaveBeenCalledTimes(3);
      expect(observeProgramLockWait.mock.calls[2][0]).toBeCloseTo(0.3, 5);
    });
  });

  describe("failures at the database", () => {
    it("turns a refused row lock into a lock timeout and counts it", async () => {
      transaction.mockRejectedValue(lockTimeoutFailure());

      await expect(service.withLockedProgramById("program-1", jest.fn())).rejects.toBeInstanceOf(
        ProgramLockTimeoutError,
      );

      expect(recordProgramLockTimeout).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        "another database error",
        new QueryFailedError(
          "UPDATE",
          [],
          Object.assign(new Error("duplicate"), { code: "23505" }),
        ),
      ],
      ["an unexpected failure", new Error("connection terminated")],
    ])("lets %s through unchanged and uncounted", async (_name, failure) => {
      transaction.mockRejectedValue(failure);

      await expect(service.withLockedProgramById("program-1", jest.fn())).rejects.toBe(failure);

      expect(recordProgramLockTimeout).not.toHaveBeenCalled();
    });
  });
});
