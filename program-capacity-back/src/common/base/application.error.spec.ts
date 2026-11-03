import { ApplicationError } from "@/common/base/application.error";

describe("ApplicationError", () => {
  class SampleError extends ApplicationError {}

  it("is an Error that carries its message", () => {
    const error = new ApplicationError("something is wrong");

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("something is wrong");
  });

  it("is named after the concrete subclass, so a log line says which failure it was", () => {
    expect(new ApplicationError("x").name).toBe("ApplicationError");
    expect(new SampleError("x").name).toBe("SampleError");
    expect(new SampleError("x")).toBeInstanceOf(ApplicationError);
  });

  it("carries metadata when given and none otherwise", () => {
    expect(new SampleError("x", { programId: "p-1" }).metadata).toEqual({ programId: "p-1" });
    expect(new SampleError("x").metadata).toBeUndefined();
  });
});
