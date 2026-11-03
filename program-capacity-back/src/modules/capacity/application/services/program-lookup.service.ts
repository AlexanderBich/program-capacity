import { Injectable } from "@nestjs/common";
import { ProgramNotFoundError } from "@/modules/capacity/application/errors/program-not-found.error";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";

@Injectable()
export class ProgramLookupService {
  constructor(private readonly programRepository: ProgramRepository) {}

  async getByIdOrThrow(programId: string): Promise<ProgramEntity> {
    const program = await this.programRepository.findById(programId);
    if (!program) {
      throw new ProgramNotFoundError(programId);
    }
    return program;
  }
}
