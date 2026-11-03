import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, In, IsNull, LessThan, MoreThan, Repository } from "typeorm";
import { Nullable } from "@/common/types/common";
import { CAPACITY_OUTBOX_RELAY_ADVISORY_LOCK_KEY } from "@/modules/capacity/capacity.constants";
import { OutboxBacklog } from "@/modules/capacity/capacity.types";
import {
  CapacityOutboxEventEntity,
  CreateCapacityOutboxEvent,
} from "@/modules/capacity/entities/capacity-outbox-event.entity";

@Injectable()
export class CapacityOutboxEventRepository {
  constructor(
    @InjectRepository(CapacityOutboxEventEntity)
    private readonly capacityOutboxEventRepositoryRaw: Repository<CapacityOutboxEventEntity>,
  ) {}

  async create(manager: EntityManager, values: CreateCapacityOutboxEvent): Promise<void> {
    await manager.insert(CapacityOutboxEventEntity, values);
  }

  findManyOldestUnpublished(
    manager: EntityManager,
    limit: number,
  ): Promise<CapacityOutboxEventEntity[]> {
    return manager.find(CapacityOutboxEventEntity, {
      where: { publishedAt: IsNull() },
      order: { id: "ASC" },
      take: limit,
    });
  }

  /** SQL aggregation: the typed API cannot express COUNT and MIN in one read. */
  async findUnpublishedBacklog(): Promise<OutboxBacklog> {
    const row = await this.capacityOutboxEventRepositoryRaw
      .createQueryBuilder("event")
      .select("COUNT(*)", "unpublishedCount")
      .addSelect("MIN(event.createdAt)", "oldestCreatedAt")
      .where("event.publishedAt IS NULL")
      .getRawOne<{ unpublishedCount: string; oldestCreatedAt: Nullable<Date> }>();
    return {
      unpublishedCount: Number(row?.unpublishedCount ?? 0),
      oldestCreatedAt: row?.oldestCreatedAt ?? null,
    };
  }

  async findOldestCreatedAtByProgramCodeUnpublishedOrPublishedAfter(
    manager: EntityManager,
    programCode: string,
    publishedAfter: Date,
  ): Promise<Nullable<Date>> {
    const oldest = await manager.findOne(CapacityOutboxEventEntity, {
      where: [
        { programCode, publishedAt: IsNull() },
        { programCode, publishedAt: MoreThan(publishedAfter) },
      ],
      order: { createdAt: "ASC" },
    });
    return oldest?.createdAt ?? null;
  }

  async markPublishedByIds(
    manager: EntityManager,
    ids: string[],
    publishedAt: Date,
  ): Promise<void> {
    await manager.update(CapacityOutboxEventEntity, { id: In(ids) }, { publishedAt });
  }

  async deletePublishedBefore(cutoff: Date): Promise<void> {
    await this.capacityOutboxEventRepositoryRaw.delete({ publishedAt: LessThan(cutoff) });
  }

  /** Released automatically when the surrounding transaction ends. */
  async tryAcquireRelayLock(manager: EntityManager): Promise<boolean> {
    const [row] = await manager.query(`SELECT pg_try_advisory_xact_lock($1) AS "isAcquired"`, [
      CAPACITY_OUTBOX_RELAY_ADVISORY_LOCK_KEY,
    ]);
    return row.isAcquired;
  }
}
