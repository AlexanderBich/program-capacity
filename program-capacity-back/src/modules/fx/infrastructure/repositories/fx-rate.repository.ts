import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, LessThan, Repository } from "typeorm";
import { FxRateEntity } from "@/modules/fx/entities/fx-rate.entity";

@Injectable()
export class FxRateRepository {
  constructor(
    @InjectRepository(FxRateEntity)
    private readonly fxRateRepositoryRaw: Repository<FxRateEntity>,
  ) {}

  findManyOrderedByPair(): Promise<FxRateEntity[]> {
    return this.fxRateRepositoryRaw.find({
      order: { baseCurrency: "ASC", quoteCurrency: "ASC" },
    });
  }

  findManyForPairInEitherDirection(currencyA: string, currencyB: string): Promise<FxRateEntity[]> {
    return this.fxRateRepositoryRaw.find({
      where: [
        { baseCurrency: currencyA, quoteCurrency: currencyB },
        { baseCurrency: currencyB, quoteCurrency: currencyA },
      ],
    });
  }

  /** A rate delivered late or twice never overwrites a newer one. */
  async upsertIfNewerThanStored(
    manager: EntityManager,
    rate: {
      baseCurrency: string;
      quoteCurrency: string;
      rate: string;
      asOf: Date;
    },
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .insert()
      .into(FxRateEntity)
      .values(rate)
      .orIgnore()
      .execute();
    await manager.update(
      FxRateEntity,
      {
        baseCurrency: rate.baseCurrency,
        quoteCurrency: rate.quoteCurrency,
        asOf: LessThan(rate.asOf),
      },
      { rate: rate.rate, asOf: rate.asOf },
    );
  }
}
