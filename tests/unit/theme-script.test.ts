import { createHash } from "node:crypto";
import { THEME_SCRIPT, THEME_SCRIPT_HASH } from "@/lib/theme-script";
import { expect, test } from "vitest";

test("the CSP hash still matches the theme bootstrap script", () => {
  // If this fails, the script in src/lib/theme-script.ts was edited without updating
  // THEME_SCRIPT_HASH — and the Content-Security-Policy would silently block it again.
  expect("sha256-" + createHash("sha256").update(THEME_SCRIPT).digest("base64")).toBe(THEME_SCRIPT_HASH);
  expect(THEME_SCRIPT).toContain("data-theme");
});
