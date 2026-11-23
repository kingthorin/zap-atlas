import { expect, test } from "@playwright/test";

// Every page must load real data: no error box, no script errors, no failed data requests.
test.beforeEach(async ({ page }) => {
  page.on("pageerror", e => { throw new Error(`page error: ${e.message}`); });
  page.on("response", r => { if (r.url().includes("/data/") && r.status() >= 400) throw new Error(`${r.status()} ${r.url()}`); });
});

const noError = async (page: any) => {
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(page.locator(".bg-red-50")).toHaveCount(0);
};

test("overview shows non-zero totals", async ({ page }) => {
  await page.goto("");
  const stats = page.locator(".text-3xl.text-indigo-600");
  await expect(stats).toHaveCount(3);
  for (const s of await stats.allTextContents()) expect(Number(s)).toBeGreaterThan(0);
});

test("repositories list modules and languages, and a module page opens", async ({ page }) => {
  await page.goto("repositories");
  await expect(page.getByRole("table", { name: "Lines of code by language" }).first()).toBeVisible();
  await page.locator("summary", { hasText: "Modules (" }).first().click();
  await page.locator("a[href*='/module/zap-extensions/']").first().click();
  await noError(page);
});

test("every repository's symbol data loads", async ({ page }) => {
  for (const [repo, mod, listed] of [["zaproxy", "zap", true], ["zap-extensions", "addOns/accessControl", true], ["zap-core-help", "addOns/help", false]] as const) {
    await page.goto(`module/${repo}/${mod}`);
    await noError(page);
    if (listed) await expect(page.locator("details").first()).toBeVisible(); // symbols loaded from the module's shards
  }
});

test("history shows commits and a commit page opens", async ({ page }) => {
  await page.goto("history");
  await page.locator("a[href*='/commit/']").first().click();
  await expect(page.getByText("Changed files")).toBeVisible();
  await noError(page);
});

test("source explorer: module links, module tree, symbols and relationships", async ({ page }) => {
  await page.goto("source");
  await expect(page.getByText(/\d+ modules/).first()).toBeVisible();
  await page.getByRole("button", { name: "addOns/accessControl", exact: true }).click();
  await expect(page.getByRole("button", { name: /^addOns\/accessControl/ }).first()).toHaveAttribute("aria-current", "true");
  await page.getByRole("tab", { name: "Symbols" }).click();
  await expect(page.locator("a[href*='/symbol/']").first()).toBeVisible();
  await page.getByRole("tab", { name: "Relationships" }).click();
  await expect(page.getByText(/of [\d,]+ relationships/)).toBeVisible();
  await page.getByRole("button", { name: /^CALLS/ }).click();
  await expect(page.getByRole("button", { name: /^CALLS/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: "Module links" }).click();
  await expect(page.getByText(/Modules linked to/)).toBeVisible();
  await page.getByRole("tab", { name: "Add-on dependencies" }).click();
  await expect(page.getByText(/\d+ add-ons/)).toBeVisible();
});

test("search finds an add-on and, once enabled, a commit", async ({ page }) => {
  await page.goto("search?q=graphql");
  await expect(page.getByRole("link", { name: /graphql/i }).first()).toBeVisible();
  await page.getByLabel(/Commits/).check();
  await page.getByLabel("Search", { exact: true }).fill("gradle");
  await expect(page.locator("a[href*='/commit/']").first()).toBeVisible({ timeout: 30_000 });
});

test("stories are grouped, oldest first, and can be filtered", async ({ page }) => {
  await page.goto("stories");
  for (const h of ["Student projects", "Features and add-ons", "Project history and organisation"]) {
    await expect(page.getByRole("heading", { name: h, level: 2 })).toBeVisible();
  }
  const dates = await page.locator("section[aria-labelledby='grp-projects'] a >> text=/^\\d{4}/").allTextContents();
  const keys = dates.map(d => d.split(" · ")[0]);
  expect(keys.length).toBeGreaterThan(10);
  expect([...keys].sort()).toEqual(keys);
  const sel = page.getByLabel("Sort");
  const titles = () => page.locator("section[aria-labelledby='grp-projects'] h3").allTextContents();
  await sel.selectOption("date-desc");
  expect((await page.locator("section[aria-labelledby='grp-projects'] a >> text=/^\\d{4}/").allTextContents()).map(d => d.split(" · ")[0])).toEqual([...keys].reverse());
  await sel.selectOption("az");
  const az = (await titles()).map(t => t.replace(/draft$/i, ""));
  expect(az).toEqual([...az].sort((a, b) => a.localeCompare(b)));
  await sel.selectOption("za");
  const za = (await titles()).map(t => t.replace(/draft$/i, ""));
  expect(za).toEqual([...za].sort((a, b) => b.localeCompare(a)));
  await page.getByRole("button", { name: /^Features and add-ons/ }).click();
  await expect(page.getByRole("heading", { name: "Student projects", level: 2 })).toHaveCount(0);
});

test("stories list and a story open, labelled draft", async ({ page }) => {
  await page.goto("stories");
  await page.locator("a[href*='/stories/']").first().click();
  await expect(page.getByText("draft").first()).toBeVisible();
  await noError(page);
});

test("a help page and an add-on page open", async ({ page }) => {
  await page.goto("search?q=active scan");
  await page.locator("a[href*='/doc/']").first().click();
  await expect(page.getByText("Linked from")).toBeVisible();
  await page.goto("addon/addon%3Aascanrules");
  await expect(page.getByRole("heading", { name: /Active scanner rules/ })).toBeVisible();
});

test("theme choice persists across reloads", async ({ page }) => {
  await page.goto("");
  const btn = page.getByRole("button", { name: /^Theme:/ }).first();
  await btn.click(); await btn.click(); // system -> light -> dark
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("header stays pinned to the top while scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 600 });
  await page.goto("history");
  await page.waitForSelector("a[href*='/commit/']");
  await page.evaluate(() => window.scrollTo(0, 2000));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
  expect(await page.evaluate(() => Math.round(document.querySelector("header")!.getBoundingClientRect().top))).toBe(0);
});

test("releases list, a release page, and release markers in history", async ({ page }) => {
  await page.goto("releases");
  await expect(page.getByText(/\d+ releases, newest first/)).toBeVisible();
  await page.getByRole("link", { name: /^ZAP 2\.1\d/ }).first().click();
  await expect(page.getByText("Tag", { exact: true })).toBeVisible();
  await page.goto("history");
  await expect(page.getByLabel("Releases this year")).toBeVisible();
  await noError(page);
});

test("timeline draws three repositories with markers, zooms and has a table", async ({ page }) => {
  await page.goto("timeline");
  await noError(page);
  await expect(page.getByRole("img", { name: /Commits per repository/ })).toBeVisible();
  expect(await page.locator("svg a[href*='/release/']").count()).toBeGreaterThan(0);
  expect(await page.locator("svg a[href*='/stories/']").count()).toBeGreaterThan(0);
  const status = page.locator("span.text-slate-500", { hasText: " bars" });
  await expect(status).toContainText("monthly bars");
  await page.getByRole("combobox", { name: /Jump to/ }).selectOption("2024");
  await expect(status).toContainText("weekly bars");
  await page.getByText("Table: commits per year").click();
  await expect(page.getByRole("table", { name: "Commits per year by repository" })).toBeVisible();
});

// Expected counts were taken from the old whole-repository relationship files, before sharding.
test("symbol pages count edges the same across shards, including cross-shard incoming", async ({ page }) => {
  for (const [id, out, inc] of [
    ["symbol:zap-extensions:org.zaproxy.addon.automation.AutomationJob", 112, 108],
    ["symbol:zaproxy:org.parosproxy.paros.Constant", 229, 474],
    ["symbol:zap-extensions:org.zaproxy.zap.testutils.TestUtils", 82, 439],
  ] as const) {
    await page.goto(`symbol/${encodeURIComponent(id)}`);
    await expect(page.getByRole("heading", { name: `Outgoing (${out})` })).toBeVisible();
    await expect(page.getByRole("heading", { name: `Incoming (${inc})` })).toBeVisible();
  }
});

test("repositories fold long module lists", async ({ page }) => {
  await page.goto("repositories");
  const ext = page.locator("div.rounded-xl", { hasText: "zap-extensions" }).first();
  const fold = ext.locator("details", { hasText: "Modules (" });
  await expect(fold).toHaveCount(1);
  await expect(fold.locator("li").first()).toBeHidden();
  await fold.locator("summary").click();
  await expect(fold.locator("li").first()).toBeVisible();
  await expect(ext.getByRole("table", { name: "Lines of code by language" })).toBeVisible(); // stats stay visible
});

test("module graph draws, selects a module and filters edge types", async ({ page }) => {
  await page.goto("graph");
  await expect(page.locator("canvas").first()).toBeVisible();
  const summary = page.getByText(/\d+ modules · \d+ linked pairs/);
  const before = await summary.textContent();
  await page.getByLabel("Select a module").selectOption({ label: "automation" });
  await expect(page.getByRole("heading", { name: "automation", level: 2 })).toBeVisible();
  await expect(page.getByText(/zap-extensions · \d+ linked/)).toBeVisible();
  await expect(page.locator("aside tbody tr").first()).toBeVisible();
  for (const t of ["CALLS", "IMPORTS", "EXTENDS", "IMPLEMENTS", "USES_API"]) await page.getByRole("button", { name: t, exact: true }).click();
  await expect(page.getByRole("button", { name: "DEPENDS_ON", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(summary).not.toHaveText(before!); // only add-on dependency pairs remain
});

test("module graph expands a module into its types and collapses it again", async ({ page }) => {
  await page.goto("graph");
  const summary = page.getByText(/\d+ modules.*linked pairs/);
  await expect(summary).toContainText("89 modules ·");
  await page.getByLabel("Select a module").selectOption({ label: "automation" });
  await page.getByRole("button", { name: "Expand into types" }).click();
  await expect(summary).toContainText("+ 40 types");
  await expect(page.getByText("showing 40 of")).toBeVisible();
  await page.getByRole("button", { name: "Collapse types" }).click();
  await expect(summary).toContainText("89 modules ·");
});
