import { numericTransformer } from "@/common/transformers/numeric.transformer";

describe("numericTransformer", () => {
  it("reads the string the driver returns for an int8 counter back as a number", () => {
    expect(numericTransformer.from("42")).toBe(42);
    expect(numericTransformer.from("0")).toBe(0);
    expect(numericTransformer.from("1234567890123")).toBe(1234567890123);
  });

  it("writes a number to the column as it is", () => {
    expect(numericTransformer.to(42)).toBe(42);
    expect(numericTransformer.to(0)).toBe(0);
  });

  it("passes a missing value through untouched, so a nullable column stays nullable", () => {
    expect(numericTransformer.to(null)).toBeNull();
    expect(numericTransformer.to(undefined)).toBeUndefined();
    expect(numericTransformer.from(null)).toBeNull();
    expect(numericTransformer.from(undefined)).toBeUndefined();
  });
});
