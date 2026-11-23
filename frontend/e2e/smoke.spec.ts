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
  await page.locator("a[href*='/module/zap-extensions/']").first().click();
  await noError(page);
});

test("every repository's symbol data loads", async ({ page }) => {
  for (const repo of ["zaproxy", "zap-extensions", "zap-core-help"]) {
    await page.goto(`module/${repo}/x`); // loads symbols/<repo>.jsonl even for an unknown path
    await noError(page);
  }
});

test("history shows commits and a commit page opens", async ({ page }) => {
  await page.goto("history");
  await page.locator("a[href*='/commit/']").first().click();
  await expect(page.getByText("Changed files")).toBeVisible();
  await noError(page);
});

test("architecture filters and dependencies tab", async ({ page }) => {
  await page.goto("architecture");
  await expect(page.getByText(/of [\d,]+ relationships/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^CALLS/ }).click();
  await expect(page.getByRole("button", { name: /^CALLS/ })).toHaveAttribute("aria-pressed", "true");
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
