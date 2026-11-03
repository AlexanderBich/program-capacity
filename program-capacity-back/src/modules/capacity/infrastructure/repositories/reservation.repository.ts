import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, FindOptionsWhere, In, Repository } from "typeorm";
import { Nullable } from "@/common/types/common";
import { ReservationStatus } from "@/modules/capacity/capacity.enums";
import {
  CreateReservation,
  ReservationEntity,
  UpdateReservation,
} from "@/modules/capacity/entities/reservation.entity";

@Injectable()
export class ReservationRepository {
  constructor(
    @InjectRepository(ReservationEntity)
    private readonly reservationRepositoryRaw: Repository<ReservationEntity>,
  ) {}

  findByProgramIdAndInvoiceId(
    programId: string,
    invoiceId: string,
    manager: EntityManager = this.reservationRepositoryRaw.manager,
  ): Promise<Nullable<ReservationEntity>> {
    return manager.findOneBy(ReservationEntity, { programId, invoiceId });
  }

  findByIdAndProgramId(
    id: string,
    programId: string,
    manager: EntityManager = this.reservationRepositoryRaw.manager,
  ): Promise<Nullable<ReservationEntity>> {
    return manager.findOneBy(ReservationEntity, { id, programId });
  }

  findByIdAndProgramIdWithReleasesOldestFirst(
    id: string,
    programId: string,
  ): Promise<Nullable<ReservationEntity>> {
    return this.reservationRepositoryRaw.findOne({
      where: { id, programId },
      relations: { releases: true },
      order: { releases: { createdAt: "ASC" } },
    });
  }

  findNewestPageByProgramId(params: {
    programId: string;
    status?: ReservationStatus;
    invoiceId?: string;
    limit: number;
    offset: number;
  }): Promise<[ReservationEntity[], number]> {
    const where: FindOptionsWhere<ReservationEntity> = { programId: params.programId };
    if (params.status) {
      where.status = params.status;
    }
    if (params.invoiceId) {
      where.invoiceId = params.invoiceId;
    }
    return this.reservationRepositoryRaw.findAndCount({
      where,
      order: { createdAt: "DESC", id: "DESC" },
      take: params.limit,
      skip: params.offset,
    });
  }

  findManyActiveByProgramId(
    manager: EntityManager,
    programId: string,
  ): Promise<ReservationEntity[]> {
    return manager.findBy(ReservationEntity, { programId, status: ReservationStatus.ACTIVE });
  }

  findManyByProgramIdAndInvoiceIds(
    manager: EntityManager,
    programId: string,
    invoiceIds: string[],
  ): Promise<ReservationEntity[]> {
    return manager.findBy(ReservationEntity, { programId, invoiceId: In(invoiceIds) });
  }

  create(manager: EntityManager, values: CreateReservation): Promise<ReservationEntity> {
    return manager.save(ReservationEntity, manager.create(ReservationEntity, values));
  }

  async createMany(
    manager: EntityManager,
    values: CreateReservation[],
    options: { chunkSize: number },
  ): Promise<void> {
    for (let start = 0; start < values.length; start += options.chunkSize) {
      await manager.insert(ReservationEntity, values.slice(start, start + options.chunkSize));
    }
  }

  async updateById(manager: EntityManager, id: string, values: UpdateReservation): Promise<void> {
    await manager.update(ReservationEntity, { id }, values);
  }

  /** One statement however many rows, because a program's writers are waiting behind this. */
  async updateManyFromSnapshot(
    manager: EntityManager,
    reservations: ReservationEntity[],
  ): Promise<void> {
    if (reservations.length === 0) {
      return;
    }
    await manager.query(
      `UPDATE reservations AS r
          SET status = v.status,
              invoice_currency = v.invoice_currency,
              invoice_amount_minor = v.invoice_amount_minor,
              outstanding_invoice_minor = v.outstanding_invoice_minor,
              program_amount_minor = v.program_amount_minor,
              outstanding_program_minor = v.outstanding_program_minor,
              updated_at = now()
         FROM unnest($1::uuid[], $2::text[], $3::text[], $4::bigint[], $5::bigint[], $6::bigint[], $7::bigint[])
              AS v(id, status, invoice_currency, invoice_amount_minor, outstanding_invoice_minor, program_amount_minor, outstanding_program_minor)
        WHERE r.id = v.id`,
      [
        reservations.map((reservation) => reservation.id),
        reservations.map((reservation) => reservation.status),
        reservations.map((reservation) => reservation.invoiceCurrency),
        reservations.map((reservation) => reservation.invoiceAmountMinor.toString()),
        reservations.map((reservation) => reservation.outstandingInvoiceMinor.toString()),
        reservations.map((reservation) => reservation.programAmountMinor.toString()),
        reservations.map((reservation) => reservation.outstandingProgramMinor.toString()),
      ],
    );
  }

  /** SQL aggregation: the typed API cannot express SUM. Only active reservations hold anything. */
  async sumOutstandingProgramMinorByProgramId(
    manager: EntityManager,
    programId: string,
  ): Promise<bigint> {
    const row = await manager
      .createQueryBuilder(ReservationEntity, "reservation")
      .select("COALESCE(SUM(reservation.outstandingProgramMinor), 0)", "total")
      .where("reservation.programId = :programId", { programId })
      .andWhere("reservation.status = :status", { status: ReservationStatus.ACTIVE })
      .getRawOne<{ total: string }>();
    return BigInt(row?.total ?? "0");
  }
}
