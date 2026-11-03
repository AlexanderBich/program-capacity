import { ProgramNotFoundError } from "@/modules/capacity/application/errors/program-not-found.error";
import { ProgramLookupService } from "@/modules/capacity/application/services/program-lookup.service";
import { ProgramEntity } from "@/modules/capacity/entities/program.entity";
import { ProgramRepository } from "@/modules/capacity/infrastructure/repositories/program.repository";

describe("ProgramLookupService", () => {
  const program = Object.assign(new ProgramEntity(), { id: "program-1", code: "PROGRAM-1" });
  let service: ProgramLookupService;

  beforeEach(() => {
    const findById = jest.fn(async (id: string) => (id === program.id ? program : null));
    service = new ProgramLookupService({ findById } as unknown as ProgramRepository);
  });

  it("returns the program with the requested id", async () => {
    await expect(service.getByIdOrThrow("program-1")).resolves.toBe(program);
  });

  it("names the requested id when there is no such program", async () => {
    const lookup = service.getByIdOrThrow("program-2");

    await expect(lookup).rejects.toBeInstanceOf(ProgramNotFoundError);
    await expect(lookup).rejects.toMatchObject({
      message: "Program not found: program-2",
      metadata: { programReference: "program-2" },
    });
  });
});
