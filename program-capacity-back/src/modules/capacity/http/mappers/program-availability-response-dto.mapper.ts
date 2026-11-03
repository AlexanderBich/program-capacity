import { MoneyUtils } from "@/common/utils/money.utils";
import { CapacityMathUtils } from "@/modules/capacity/application/utils/capacity-math.utils";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ProgramAvailabilityResponseDto } from "@/modules/capacity/http/dto/program-availability-response.dto";

export class ProgramAvailabilityResponseDtoMapper {
  static mapFromProgramEntity(program: ProgramEntity): ProgramAvailabilityResponseDto {
    const availableMinor = CapacityMathUtils.computeAvailableMinor(program);
    return {
      programId: program.id,
      currency: program.currency,
      creditLimit: MoneyUtils.formatMinorUnits(program.creditLimitMinor, program.currency),
      reserved: MoneyUtils.formatMinorUnits(program.reservedMinor, program.currency),
      available: MoneyUtils.formatMinorUnits(availableMinor, program.currency),
      isOverLimit: availableMinor < 0n,
      version: program.version,
      lastReconciledAt: program.lastReconciledAt?.toISOString() ?? null,
      updatedAt: program.updatedAt.toISOString(),
    };
  }
}
