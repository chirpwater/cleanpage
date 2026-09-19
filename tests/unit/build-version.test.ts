import { describe, expect, it } from "vitest";
import { buildVersion } from "../../vite.config.js";

describe("build version", () => {
  it("labels local and main builds as development editions", () => {
    expect(buildVersion()).toBe("development edition");
    expect(buildVersion("main")).toBe("development edition");
  });

  it.each(["v0.2.0", "v1.2.3-rc.1", "v1.2.3+build.42"])("preserves release tag %s", (tag) => {
    expect(buildVersion(tag)).toBe(tag);
  });

  it.each(["", "feature", "0.2.0", "v01.2.3", "v1.2", "v1.2.3-01"])("rejects invalid release ref %s", (ref) => {
    expect(() => buildVersion(ref)).toThrow("Expected main or a v-prefixed semver release tag");
  });
});
