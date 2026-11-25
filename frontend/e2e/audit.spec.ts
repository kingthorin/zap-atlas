import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// WCAG 2.1 A and AA checks (axe) on every kind of page, in both themes. Fails on any violation.

const ROUTES = ["", "repositories", "source", "source?repo=zap-extensions&mod=addOns/automation&tab=symbols",
  "source?repo=zap-extensions&mod=addOns/automation&tab=rels", "source?tab=deps", "graph", "timeline", "history", "releases", "releases?kind=addon-release",
  "stories", "stories/feature-auth-helper", "search?q=spider", "addon/addon%3Aspider", "symbol/symbol%3Azap-extensions%3Aorg.zaproxy.addon.automation.AutomationJob"];

for (const scheme of ["light", "dark"] as const) {
  test(`axe ${scheme}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ colorScheme: scheme });
    const out: string[] = [];
    for (const r of ROUTES) {
      await page.goto(r);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
      const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      for (const v of res.violations) out.push(`${scheme} /${r} ${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0].target.join(" ")} :: ${(v.nodes[0].failureSummary ?? "").split("\n")[1] ?? ""}`);
    }
    expect(out, out.join("\n")).toEqual([]);
  });
}

test("no page scrolls sideways at phone width", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 800 });
  const wide: string[] = [];
  for (const r of ROUTES) {
    await page.goto(r);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    if (sw > cw) wide.push(`/${r}: ${sw}px wide in ${cw}px`);
  }
  expect(wide, wide.join("\n")).toEqual([]);
});
