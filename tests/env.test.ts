import { describe, expect, it } from "vitest";
import { isPilotSyntheticModeEnabled } from "@/lib/security/env";

describe("isPilotSyntheticModeEnabled — disabled by default (safeguard)", () => {
  it("is false when PILOT_SYNTHETIC_MODE_ENABLED is not set (the real deployment default)", () => {
    expect(process.env.PILOT_SYNTHETIC_MODE_ENABLED).toBeUndefined();
    expect(isPilotSyntheticModeEnabled()).toBe(false);
  });
});
