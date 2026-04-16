import { describe, it, expect } from "vitest";
import { validateGoogleAuth, AuthError } from "../../src/core/auth";

describe("validateGoogleAuth", () => {
  it("throws AuthError when no credentials provided", async () => {
    await expect(
      validateGoogleAuth(undefined, undefined, undefined),
    ).rejects.toThrow(AuthError);
  });

  it("falls back to Authorization header for dev mode", async () => {
    const result = await validateGoogleAuth(
      "Bearer dev-token-123",
      undefined,
      undefined,
    );
    expect(result.email).toBe("dev@localhost");
    expect(result.oauthToken).toBe("dev-token-123");
    expect(result.userId).toBeTruthy();
  });

  it("generates consistent userId from same token", async () => {
    const r1 = await validateGoogleAuth("Bearer same-token", undefined, undefined);
    const r2 = await validateGoogleAuth("Bearer same-token", undefined, undefined);
    expect(r1.userId).toBe(r2.userId);
  });

  it("generates different userId from different tokens", async () => {
    const r1 = await validateGoogleAuth("Bearer token-a", undefined, undefined);
    const r2 = await validateGoogleAuth("Bearer token-b", undefined, undefined);
    expect(r1.userId).not.toBe(r2.userId);
  });
});
