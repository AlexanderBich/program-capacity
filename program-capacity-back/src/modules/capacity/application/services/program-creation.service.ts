import { Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { POSTGRES_UNIQUE_VIOLATION } from "@/common/constants/postgres-error-codes.constants";
import { MoneyUtils } from "@/common/utils/money.utils";
import { PostgresErrorUtils } from "@/common/utils/postgres-error.utils";
import { ProgramCodeAlreadyExistsError } from "@/modules/capacity/application/errors/program-code-already-exists.error";
import { CapacityChangeService } from "@/modules/capacity/application/services/capacity-change.service";
import {
  CapacityChangeSource,
  CapacityLedgerEntryType,
  CapacityOutboxEventType,
} from "@/modules/capacity/capacity.enums";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";

@Injectable()
export class ProgramCreationService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly programRepository: ProgramRepository,
    private readonly capacityChangeService: CapacityChangeService,
  ) {}

  async createProgram(params: {
    code: string;
    name: string;
    currency: string;
    creditLimit: string;
    actor: string;
  }): Promise<ProgramEntity> {
    const creditLimitMinor = MoneyUtils.parseToMinorUnits(params.creditLimit, params.currency);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const program = await this.programRepository.create(
          {
            code: params.code,
            name: params.name,
            currency: params.currency,
            creditLimitMinor: 0n,
            reservedMinor: 0n,
            version: 0,
            lastTreasurySequence: 0,
            lastSnapshotSequence: 0,
            lastLimitSequence: 0,
            lastReconciledAt: null,
          },
          { manager },
        );
        return this.capacityChangeService.commitChange(manager, {
          program,
          type: CapacityLedgerEntryType.PROGRAM_CREATED,
          source: CapacityChangeSource.API,
          actor: params.actor,
          reservedDeltaMinor: 0n,
          creditLimitDeltaMinor: creditLimitMinor,
          outboxEvent: {
            type: CapacityOutboxEventType.PROGRAM_CREATED,
            details: {
              name: params.name,
              currency: params.currency,
              creditLimit: params.creditLimit,
            },
          },
        });
      });
    } catch (error) {
      if (PostgresErrorUtils.hasCode(error, POSTGRES_UNIQUE_VIOLATION)) {
        throw new ProgramCodeAlreadyExistsError(params.code);
      }
      throw error;
    }
  }
}
