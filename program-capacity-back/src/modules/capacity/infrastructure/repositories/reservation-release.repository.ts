import { Injectable } from "@nestjs/common";
import { EntityManager } from "typeorm";
import { Nullable } from "@/common/types/common";
import {
  CreateReservationRelease,
  ReservationReleaseEntity,
} from "@/modules/capacity/entities/reservation-release.entity";

@Injectable()
export class ReservationReleaseRepository {
  findByReservationIdAndRepaymentId(
    manager: EntityManager,
    reservationId: string,
    repaymentId: string,
  ): Promise<Nullable<ReservationReleaseEntity>> {
    return manager.findOneBy(ReservationReleaseEntity, { reservationId, repaymentId });
  }

  create(
    manager: EntityManager,
    values: CreateReservationRelease,
  ): Promise<ReservationReleaseEntity> {
    return manager.save(ReservationReleaseEntity, manager.create(ReservationReleaseEntity, values));
  }
}
