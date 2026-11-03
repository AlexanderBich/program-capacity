import { DataSource, EntityManager } from "typeorm";
import { CapacityOutboxService } from "@/modules/capacity/application/services/capacity-outbox.service";
import { CapacityOutboxEventType } from "@/modules/capacity/capacity.enums";
import { CapacityOutboxEventEntity } from "@/modules/capacity/entities/capacity-outbox-event.entity";
import { CapacityOutboxEventRepository } from "@/modules/capacity/infrastructure/repositories/capacity-outbox-event.repository";

const now = new Date("2026-11-03T10:00:00.000Z");

const buildEvent = (id: number, programCode: string): CapacityOutboxEventEntity =>
  Object.assign(new CapacityOutboxEventEntity(), {
    id: String(id),
    programCode,
    type: CapacityOutboxEventType.CAPACITY_RESERVED,
    payload: { eventId: `event-${id}`, programVersion: id },
    publishedAt: null,
    createdAt: new Date("2026-11-03T09:00:00.000Z"),
  });

describe("CapacityOutboxService", () => {
  const manager = { name: "transaction" } as unknown as EntityManager;
  let unpublished: CapacityOutboxEventEntity[];
  let calls: string[];
  let tryAcquireRelayLock: jest.Mock;
  let findManyOldestUnpublished: jest.Mock;
  let markPublishedByIds: jest.Mock;
  let publish: jest.Mock;
  let service: CapacityOutboxService;

  beforeEach(() => {
    jest.useFakeTimers({ now });
    calls = [];
    unpublished = [
      buildEvent(1, "PROGRAM-A"),
      buildEvent(2, "PROGRAM-B"),
      buildEvent(3, "PROGRAM-A"),
    ];
    tryAcquireRelayLock = jest.fn(async () => {
      calls.push("lock");
      return true;
    });
    findManyOldestUnpublished = jest.fn(async (_manager: EntityManager, limit: number) => {
      calls.push("read");
      return unpublished.slice(0, limit);
    });
    markPublishedByIds = jest.fn(async () => {
      calls.push("mark");
    });
    publish = jest.fn(async () => {
      calls.push("publish");
    });
    service = new CapacityOutboxService(
      { transaction: jest.fn((work) => work(manager)) } as unknown as DataSource,
      {
        tryAcquireRelayLock,
        findManyOldestUnpublished,
        markPublishedByIds,
      } as unknown as CapacityOutboxEventRepository,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("hands the oldest events to the publisher in order, keyed by program, then marks them published", async () => {
    const relayed = await service.publishOldestEvents({ batchSize: 10, publish });

    expect(relayed).toBe(3);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toEqual([
      {
        key: "PROGRAM-A",
        type: CapacityOutboxEventType.CAPACITY_RESERVED,
        payload: { eventId: "event-1", programVersion: 1 },
      },
      {
        key: "PROGRAM-B",
        type: CapacityOutboxEventType.CAPACITY_RESERVED,
        payload: { eventId: "event-2", programVersion: 2 },
      },
      {
        key: "PROGRAM-A",
        type: CapacityOutboxEventType.CAPACITY_RESERVED,
        payload: { eventId: "event-3", programVersion: 3 },
      },
    ]);
    expect(markPublishedByIds).toHaveBeenCalledWith(manager, ["1", "2", "3"], now);
  });

  it("relays no more than a batch at a time, oldest first", async () => {
    const relayed = await service.publishOldestEvents({ batchSize: 2, publish });

    expect(relayed).toBe(2);
    expect(publish.mock.calls[0][0].map((event: { key: string }) => event.key)).toEqual([
      "PROGRAM-A",
      "PROGRAM-B",
    ]);
    expect(markPublishedByIds).toHaveBeenCalledWith(manager, ["1", "2"], now);
  });

  it("marks events as published only after the publisher has accepted them", async () => {
    await service.publishOldestEvents({ batchSize: 10, publish });

    expect(calls).toEqual(["lock", "read", "publish", "mark"]);
  });

  it("leaves the events unpublished when publishing fails, so they go out again", async () => {
    publish.mockRejectedValue(new Error("broker down"));

    await expect(service.publishOldestEvents({ batchSize: 10, publish })).rejects.toThrow(
      "broker down",
    );

    expect(markPublishedByIds).not.toHaveBeenCalled();
  });

  it("relays nothing, and reads nothing, while another replica holds the relay lock", async () => {
    tryAcquireRelayLock.mockResolvedValue(false);

    const relayed = await service.publishOldestEvents({ batchSize: 10, publish });

    expect(relayed).toBe(0);
    expect(findManyOldestUnpublished).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(markPublishedByIds).not.toHaveBeenCalled();
  });

  it("does not call the publisher when nothing is waiting", async () => {
    unpublished = [];

    const relayed = await service.publishOldestEvents({ batchSize: 10, publish });

    expect(relayed).toBe(0);
    expect(publish).not.toHaveBeenCalled();
    expect(markPublishedByIds).not.toHaveBeenCalled();
  });

  it("does its reads and writes through the one transaction that holds the relay lock", async () => {
    await service.publishOldestEvents({ batchSize: 10, publish });

    expect(tryAcquireRelayLock.mock.calls[0][0]).toBe(manager);
    expect(findManyOldestUnpublished.mock.calls[0][0]).toBe(manager);
    expect(markPublishedByIds.mock.calls[0][0]).toBe(manager);
  });
});
