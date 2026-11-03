import { bigintTransformer } from "@/common/transformers/bigint.transformer";

describe("bigintTransformer", () => {
  it("writes a bigint to the column as its decimal string", () => {
    expect(bigintTransformer.to(123450n)).toBe("123450");
    expect(bigintTransformer.to(-5n)).toBe("-5");
    expect(bigintTransformer.to(0n)).toBe("0");
  });

  it("reads the string the driver returns for an int8 back as a bigint", () => {
    expect(bigintTransformer.from("123450")).toBe(123450n);
    expect(bigintTransformer.from("-5")).toBe(-5n);
    expect(bigintTransformer.from("0")).toBe(0n);
  });

  it("stays exact above the double-precision limit in both directions", () => {
    const beyondSafeInteger = 9007199254740993n;

    expect(bigintTransformer.to(beyondSafeInteger)).toBe("9007199254740993");
    expect(bigintTransformer.from("9007199254740993")).toBe(beyondSafeInteger);
    expect(bigintTransformer.from(bigintTransformer.to(99999999999999999999n))).toBe(
      99999999999999999999n,
    );
  });

  it("passes a missing value through untouched, so a nullable column stays nullable", () => {
    expect(bigintTransformer.to(null)).toBeNull();
    expect(bigintTransformer.to(undefined)).toBeUndefined();
    expect(bigintTransformer.from(null)).toBeNull();
    expect(bigintTransformer.from(undefined)).toBeUndefined();
  });
});
