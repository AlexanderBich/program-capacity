import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import { Nullable } from "@/common/types/common";
import {
  CreateReservationRelease,
  ReservationReleaseEntity,
} from "@/modules/capacity/entities/reservation-release.entity";

@Injectable()
export class ReservationReleaseRepository {
  constructor(
    @InjectRepository(ReservationReleaseEntity)
    private readonly reservationReleaseRepositoryRaw: Repository<ReservationReleaseEntity>,
  ) {}

  findByReservationIdAndRepaymentId(
    reservationId: string,
    repaymentId: string,
    options?: { manager?: EntityManager },
  ): Promise<Nullable<ReservationReleaseEntity>> {
    const manager = options?.manager ?? this.reservationReleaseRepositoryRaw.manager;
    return manager.findOneBy(ReservationReleaseEntity, { reservationId, repaymentId });
  }

  create(
    values: CreateReservationRelease,
    options?: { manager?: EntityManager },
  ): Promise<ReservationReleaseEntity> {
    const manager = options?.manager ?? this.reservationReleaseRepositoryRaw.manager;
    return manager.save(ReservationReleaseEntity, manager.create(ReservationReleaseEntity, values));
  }
}
