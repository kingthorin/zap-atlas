import fs from "node:fs";
import path from "node:path";
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
  for (const [repo, mod, listed] of [["zaproxy", "zap", true], ["zap-extensions", "addOns/accessControl", true], ["zap-core-help", "addOns/help", false], ["zap-hud", "src", true]] as const) {
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

test("stories are one flat list tagged by group, sortable and filterable", async ({ page }) => {
  await page.goto("stories");
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0); // no group headings
  const cards = page.locator("a[href*='/stories/']");
  const meta = page.locator("a[href*='/stories/'] div.text-xs");
  const dates = async () => (await meta.allTextContents()).map(t => t.match(/\d{4}(-\d\d){0,2}/)![0]);
  const titles = async () => (await page.locator("a[href*='/stories/'] h3").allTextContents()).map(t => t.replace(/draft$/i, ""));
  const asc = await dates();
  expect(asc.length).toBeGreaterThan(30);
  expect([...asc].sort()).toEqual(asc);
  const tags = new Set((await meta.allTextContents()).map(t => t.split(/\d{4}/)[0]));
  expect(tags).toEqual(new Set(["Student project", "Feature", "History"]));
  const sel = page.getByLabel("Sort");
  await sel.selectOption("date-desc");
  expect(await dates()).toEqual([...asc].reverse());
  await sel.selectOption("az");
  const az = await titles();
  expect(az).toEqual([...az].sort((a, b) => a.localeCompare(b)));
  await sel.selectOption("za");
  const za = await titles();
  expect(za).toEqual([...za].sort((a, b) => b.localeCompare(a)));
  await page.getByRole("button", { name: /^Features and add-ons/ }).click();
  expect(new Set((await meta.allTextContents()).map(t => t.split(/\d{4}/)[0]))).toEqual(new Set(["Feature"]));
  expect(await cards.count()).toBeLessThan(asc.length);
});

test("stories list and a story open, labelled draft", async ({ page }) => {
  await page.goto("stories");
  // Reviewed stories carry no badge, so open one that is still a draft.
  await page.locator("a[href*='/stories/']", { hasText: "draft" }).first().click();
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

test("timeline draws the repositories with markers, zooms and has a table", async ({ page }) => {
  await page.goto("timeline");
  await noError(page);
  await expect(page.getByRole("group", { name: /Commits per repository/ })).toBeVisible();
  expect(await page.locator("svg a[href*='/release/']").count()).toBeGreaterThan(0);
  expect(await page.locator("svg a[href*='/stories/']").count()).toBeGreaterThan(0);
  const status = page.locator("span.text-slate-500", { hasText: " bars" });
  await expect(status).toContainText("monthly bars");
  await page.getByRole("combobox", { name: /Jump to/ }).selectOption("2024");
  await expect(status).toContainText("weekly bars");
  const plot = page.locator("svg[role=group] rect[style*='touch-action']");
  const box = (await plot.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.45);
  await expect(page.getByRole("tooltip")).toContainText(/ · \d+ commits?/);
  await page.getByLabel("Show").selectOption("added");
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.45);
  await expect(page.getByRole("tooltip")).toContainText(/ · [\d,]+ lines? added/);
  await page.getByLabel("Show").selectOption("commits");
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.535); // release strip under the zap-extensions lane
  await expect(page.getByRole("tooltip")).toContainText(/\d+ add-on releases?: /);
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.535);
  await expect(page).toHaveURL(/releases\?kind=addon-release&repo=zap-extensions&from=\d{4}-\d\d-\d\d&to=/);
  await expect(page.getByText(/\d+ releases, newest first · zap-extensions from/)).toBeVisible();
  await page.goBack();
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.getByText("Table: commits per year").click();
  await expect(page.getByRole("table", { name: "Commits per year by repository" })).toBeVisible();
});

// The oracle scans every relationship shard of the repository, so it does not depend on the incoming/ copies
// that the page uses, and it follows whatever data the build was generated from.
function edgeCounts(repo: string, id: string): { out: number; inc: number } {
  const dir = path.join(process.cwd(), "dist", "data", "relationships", repo);
  let out = 0, inc = 0;
  for (const f of fs.readdirSync(dir)) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line);
      if (r.source === id) out++;
      if (r.target === id) inc++;
    }
  }
  return { out, inc };
}

test("symbol pages count edges the same across shards, including cross-shard incoming", async ({ page }) => {
  for (const id of [
    "symbol:zap-extensions:org.zaproxy.addon.automation.AutomationJob",
    "symbol:zaproxy:org.parosproxy.paros.Constant",
    "symbol:zap-extensions:org.zaproxy.zap.testutils.TestUtils",
  ]) {
    const { out, inc } = edgeCounts(id.split(":")[1], id);
    expect(out).toBeGreaterThan(0);
    expect(inc).toBeGreaterThan(0);
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
  await expect(summary).toContainText(/\d+ modules ·/);
  const plain = (await summary.textContent())!;
  await page.getByLabel("Select a module").selectOption({ label: "automation" });
  await page.getByRole("button", { name: "Expand into types" }).click();
  await expect(summary).toContainText("+ 40 types");
  await expect(page.getByText("showing 40 of")).toBeVisible();
  await page.getByRole("button", { name: "Collapse types" }).click();
  await expect(summary).toHaveText(plain);
});

test("module graph: evidence filter, size and colour modes, and the year slider", async ({ page }) => {
  await page.goto("graph");
  const summary = page.getByText(/\d+ modules.*linked pairs/);
  const all = (await summary.textContent())!;
  await page.getByRole("button", { name: "resolved", exact: true }).click();     // leaves inferred and syntactic edges only
  await expect(summary).not.toHaveText(all);
  await page.getByRole("button", { name: "resolved", exact: true }).click();
  await expect(summary).toHaveText(all);
  await page.getByLabel("Size by").selectOption("lines");
  await page.getByLabel("Colour by").selectOption("recency");
  await expect(page.getByText(/last commit \d{4}/)).toBeVisible();
  const slider = page.getByRole("slider", { name: /Year/ });
  await expect(page.getByText("any year")).toBeVisible();
  await slider.fill("2014");
  await expect(page.getByText("active in 2014")).toBeVisible();
  await page.getByLabel("Select a module").selectOption({ label: "automation" });
  await expect(page.getByText(/\d+ commits · [\d,]+ lines changed · first \d{4}-/)).toBeVisible();
});

test("module graph expands a module into directories and files, and a file opens in Source", async ({ page }) => {
  await page.goto("graph");
  const summary = page.getByText(/\d+ modules.*linked pairs/);
  await page.getByLabel("Select a module").selectOption({ label: "automation" });
  await page.getByRole("button", { name: "Expand into files", exact: true }).click();
  await expect(summary).toContainText(/\+ 40 files, \d+ directories/);
  await expect(page.getByText(/showing 40 of \d+ files/)).toBeVisible();
  await page.getByRole("button", { name: "Expand into types" }).click();            // switching modes replaces the files
  await expect(summary).toContainText("+ 40 types");
  await expect(summary).not.toContainText("files");
  await page.getByRole("button", { name: "Expand into files", exact: true }).click();
  await page.getByRole("button", { name: "Collapse files" }).click();
  await expect(summary).not.toContainText("+ ");
});

test("module graph: tree, find, language and repository filters", async ({ page }) => {
  await page.goto("graph");
  const tree = page.getByRole("navigation", { name: "Modules, files and types" });
  const automation = tree.getByRole("button", { name: "automation", exact: true });
  await tree.locator("summary", { hasText: "zap-extensions" }).click();           // large repositories start folded
  await expect(automation).toBeVisible();
  await automation.click();                                                       // selecting in the tree selects in the graph
  await expect(page.getByRole("heading", { name: "automation", level: 2 })).toBeVisible();
  await tree.getByRole("button", { name: "Expand into files: automation" }).click(); // the arrow expands it, and the files are listed
  await expect(tree.getByRole("button", { name: "Collapse automation" })).toBeVisible();
  expect(await tree.getByRole("button").count()).toBeGreaterThan(40);
  await tree.getByRole("button", { name: "Collapse automation" }).click();

  await page.getByLabel("Select a module").selectOption("");
  await page.getByLabel("Find").fill("spider");                                  // an exact label selects it
  await expect(page.getByRole("heading", { name: "spider", level: 2 })).toBeVisible();

  await page.locator("label", { hasText: /^Language/ }).locator("select").selectOption("JavaScript");                  // Java-only modules fade
  await expect(automation).toHaveClass(/text-slate-400/);
  await page.locator("label", { hasText: /^Language/ }).locator("select").selectOption("");
  await expect(automation).not.toHaveClass(/text-slate-400/);

  await page.getByRole("group", { name: "Repositories" }).getByRole("button", { name: "zap-extensions" }).click();
  await expect(automation).toHaveClass(/text-slate-400/);
  await page.getByLabel("Colour by").selectOption("language");
  await expect(page.getByLabel("Language colours")).toContainText("Java");
});
