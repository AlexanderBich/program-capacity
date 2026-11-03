import { RefreshTokenUtils } from "@/modules/auth/application/utils/refresh-token.utils";

describe("RefreshTokenUtils", () => {
  describe("generateToken", () => {
    it("returns 256 bits of randomness as URL-safe base64, fit for a cookie value", () => {
      const token = RefreshTokenUtils.generateToken();

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    });

    it("never hands out the same token twice", () => {
      const tokens = new Set(Array.from({ length: 1000 }, () => RefreshTokenUtils.generateToken()));

      expect(tokens.size).toBe(1000);
    });
  });

  describe("hashToken", () => {
    it("is the SHA-256 digest of the token in hex", () => {
      expect(RefreshTokenUtils.hashToken("abc")).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
      expect(RefreshTokenUtils.hashToken("")).toBe(
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      );
    });

    it("always gives the same hash for the same token and a different one for another", () => {
      const token = RefreshTokenUtils.generateToken();

      expect(RefreshTokenUtils.hashToken(token)).toBe(RefreshTokenUtils.hashToken(token));
      expect(RefreshTokenUtils.hashToken(token)).not.toBe(RefreshTokenUtils.hashToken(`${token}x`));
    });

    it("fits the 64-character column the hash is stored in and reveals nothing of the token", () => {
      const token = RefreshTokenUtils.generateToken();
      const hashed = RefreshTokenUtils.hashToken(token);

      expect(hashed).toMatch(/^[0-9a-f]{64}$/);
      expect(hashed).not.toContain(token);
    });
  });
});
