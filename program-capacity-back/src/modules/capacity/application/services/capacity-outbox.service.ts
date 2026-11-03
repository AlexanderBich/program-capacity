import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { OutboxEventForPublishing } from "@/modules/capacity/capacity.types";
import { CapacityOutboxEventRepository } from "@/modules/capacity/infrastructure/repositories/capacity-outbox-event.repository";

@Injectable()
export class CapacityOutboxService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly capacityOutboxEventRepository: CapacityOutboxEventRepository,
  ) {}

  /**
   * At-least-once: events are marked only after `publish` succeeds, and a crash in between publishes them
   * again. One replica drains at a time, which keeps each program's events in commit order.
   */
  publishOldestEvents(params: {
    batchSize: number;
    publish: (events: OutboxEventForPublishing[]) => Promise<void>;
  }): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      if (!(await this.capacityOutboxEventRepository.tryAcquireRelayLock(manager))) {
        return 0;
      }

      const events = await this.capacityOutboxEventRepository.findManyOldestUnpublished(
        manager,
        params.batchSize,
      );
      if (events.length === 0) {
        return 0;
      }

      await params.publish(
        events.map((event) => ({
          key: event.programCode,
          type: event.type,
          payload: event.payload,
        })),
      );
      await this.capacityOutboxEventRepository.markPublishedByIds(
        manager,
        events.map((event) => event.id),
        new Date(),
      );
      return events.length;
    });
  }
}
