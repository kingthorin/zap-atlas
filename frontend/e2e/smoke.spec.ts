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
