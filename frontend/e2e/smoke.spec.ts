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

test("overview: tiles, activity chart, latest panel and featured stories", async ({ page }) => {
  await page.goto("");
  const explore = page.getByRole("region", { name: "Explore" });
  await expect(explore.getByRole("link")).toHaveCount(6);
  await expect(explore.getByRole("link", { name: /^Releases \d+ ZAP releases/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Commits per month, \d{4}-\d\d to \d{4}-\d\d/ })).toBeVisible();
  const latest = page.getByRole("heading", { name: "Latest" }).locator("xpath=../..");
  await expect(latest.getByRole("link", { name: /^ZAP \d/ })).toBeVisible();
  await expect(latest.getByText("Newest commit")).toBeVisible();                 // loads after the rest
  await expect(latest.locator("a[href*='/commit/']")).toBeVisible();
  const featured = page.getByRole("region", { name: "Featured stories" });
  const n = await featured.locator("li").count();
  expect(n).toBeGreaterThanOrEqual(3);
  expect(n).toBeLessThanOrEqual(4);
  expect(await featured.getByText("draft").count()).toBe(0);                     // reviewed stories only
  await featured.locator("li a").first().click();
  await expect(page).toHaveURL(/\/stories\//);
  await page.goBack();
  await page.getByRole("region", { name: "Explore" }).getByRole("link", { name: /^Timeline/ }).click();
  await expect(page).toHaveURL(/\/timeline$/);
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

test("search prefixes pick one kind, and Ctrl+K goes to the search box", async ({ page }) => {
  await page.goto("search?q=" + encodeURIComponent("a:graphql"));
  await expect(page.getByText("Searching add-ons only.")).toBeVisible();
  const kinds = page.locator("li > span.w-16");
  await expect(kinds.first()).toHaveText("add-on");
  expect(await kinds.allTextContents()).toEqual(expect.arrayContaining(["add-on"]));
  expect((await kinds.allTextContents()).every(k => k === "add-on")).toBe(true);
  await page.goto("search?q=" + encodeURIComponent("t:ExtensionScript"));
  await expect(page.getByText("Searching types only.")).toBeVisible();
  await expect(page.locator("a[href*='/symbol/']").first()).toBeVisible({ timeout: 30_000 });
});

test("Ctrl+K opens a search palette over the page: results, arrow keys, Enter, Escape", async ({ page }) => {
  await page.goto("timeline");
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();      // the app is up, so the shortcut is listening
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search" });
  const box = dialog.getByRole("combobox");
  await expect(box).toBeFocused();
  await box.fill("a:pscan");
  const options = dialog.getByRole("option");
  await expect(options.first()).toContainText("add-on");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");                                  // opens the add-on and closes the palette
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/addon\//);
  await page.keyboard.press("Control+k");                              // Escape closes it and puts focus back
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press("Control+k");                              // Ctrl+Enter goes to the full results
  await dialog.getByRole("combobox").fill("t:ExtensionScript");
  await page.keyboard.press("Control+Enter");
  await expect(page).toHaveURL(/\/search\?q=t%3AExtensionScript/);
});

test("Copy for GitHub puts a Markdown summary on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("addon/addon%3Aascanrules");
  await page.getByRole("button", { name: "Copy for GitHub" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^\*\*Active scanner rules\*\* \(`ascanrules`\)/);
  expect(text).toMatch(/- Source: \[addOns\/ascanrules\]\(https:\/\/github\.com\/zaproxy\/zap-extensions\/tree\/[0-9a-f]{40}\/addOns\/ascanrules\)/);
  await page.goto("history");
  await page.locator("a[href*='/commit/']").first().click();
  await page.getByRole("button", { name: "Copy for GitHub" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/- Commit: \[`[0-9a-f]{40}`\]\(https:\/\/github\.com\//);
});

test("stories are one flat list tagged by group, sortable and filterable", async ({ page }) => {
  await page.goto("stories");
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(0); // no group headings
  const cards = page.locator("a[href*='/stories/']");
  await expect(cards.first()).toBeVisible();                                    // wait for the list before reading it
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

test("stories filter by status, keep it in the URL and step to the next draft", async ({ page }) => {
  await page.goto("stories");
  const cards = page.locator("a[href*='/stories/']");
  await expect(cards.first()).toBeVisible();
  const all = await cards.count();
  const status = page.getByRole("group", { name: "Story status" });
  const n = async (name: string) => Number((await status.getByRole("button", { name: new RegExp(`^${name} \\(`) }).textContent())!.match(/\((\d+)\)/)![1]);
  const [drafts, reviewed] = [await n("Draft"), await n("Reviewed")];
  expect(drafts + reviewed).toBe(all);
  await status.getByRole("button", { name: /^Draft/ }).click();
  await expect(page).toHaveURL(/status=draft/);
  await expect(cards).toHaveCount(drafts);
  expect(await page.locator("a[href*='/stories/'] h3", { hasText: "draft" }).count()).toBe(drafts);
  await page.getByRole("button", { name: /^Features and add-ons/ }).click();   // counts follow the group
  const featureDrafts = await cards.count();
  expect(await n("Draft")).toBe(featureDrafts);
  await page.goto("stories?status=draft");                                      // a bookmarked queue
  await expect(cards).toHaveCount(drafts);
  const first = await page.locator("a[href*='/stories/'] h3").first().textContent();
  await cards.first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(first!.replace(/draft$/, ""));
  await page.getByRole("link", { name: /^Next draft/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText(first!.replace(/draft$/, ""));
  await expect(page.getByText("draft").first()).toBeVisible();
  await page.getByRole("link", { name: "← Stories" }).click();
  await expect(page).toHaveURL(/status=draft/);
  await page.goto("stories");                                                   // unfiltered list: Next story
  await cards.first().click();
  await expect(page.getByRole("link", { name: /^Next story/ })).toBeVisible();
  await page.goto("stories/feature-scan-rules");                                // a direct link: no next link
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Next/ })).toHaveCount(0);
});

test("a story's citations open an evidence panel beside the story", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("stories/feature-scan-rules");
  await page.getByRole("button", { name: /^commit [0-9a-f]{10}$/ }).first().click();
  const panel = page.getByRole("dialog", { name: "Evidence" });
  await expect(panel.getByRole("heading")).toContainText(/\w/);
  await expect(panel.getByText("permalink to the commit")).toBeVisible();
  await expect(panel.getByText("Parents")).toBeVisible();
  await expect(panel.getByRole("link", { name: "Open the full page" })).toHaveAttribute("href", /\/commit\//);
  await expect(page).toHaveURL(/\/stories\/feature-scan-rules$/);                              // the reader has not left the story
  await panel.getByRole("button", { name: "Copy for GitHub" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/- Commit: \[`[0-9a-f]{40}`\]\(https:\/\/github\.com\//);
  await page.getByRole("button", { name: /^addon:|^ascanrules$/ }).first().click().catch(() => {});   // another kind replaces the panel
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test("stories list and a story open, labelled draft", async ({ page }) => {
  await page.goto("stories");
  // Reviewed stories carry no badge, so open one that is still a draft.
  await page.locator("a[href*='/stories/']", { hasText: "draft" }).first().click();
  await expect(page.getByText("draft").first()).toBeVisible();
  await noError(page);
});

test("a story with a narrative shows it instead of the chapters", async ({ page }) => {
  await page.goto("stories/feature-dark-mode-themes");
  await expect(page.getByRole("heading", { name: "The short version" })).toBeVisible();
  const paras = page.locator("section[aria-labelledby=short-version] p");
  await expect(paras).toHaveCount(4);
  await expect(paras.first()).toContainText("whatever look and feel the Java runtime supplied");
  await expect(page.getByRole("heading", { level: 2, name: /^\d+\./ })).toHaveCount(0);        // the numbered chapters are not shown
  await page.goto("stories/feature-spider");                                                    // no narrative yet: chapters as before
  await expect(page.getByRole("heading", { level: 2, name: /^1\./ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The short version" })).toHaveCount(0);
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

test("ZAP releases: a strip of ticks, year groups and richer cards", async ({ page }) => {
  await page.goto("releases");
  const ticks = page.getByRole("group", { name: /ZAP releases over time/ }).getByRole("button");
  await expect(ticks).toHaveCount(35);
  await ticks.nth(20).hover();
  await expect(page.getByRole("tooltip")).toContainText(/^ZAP \d+\.\d+(\.\d+)? · \d{4}-\d\d-\d\d$/);
  const years = page.locator("section[aria-label] > h2");
  const counts = (await years.allTextContents()).map(t => +t.match(/(\d+) releases?/)![1]);
  expect(counts.reduce((a, b) => a + b, 0)).toBe(35);
  expect((await years.first().textContent())!).toMatch(/^2\d{3}/);
  const cards = page.locator("section[aria-label] li");
  await expect(cards).toHaveCount(35);
  await expect(page.getByText(/^\d+ of 35 ZAP releases have release notes/)).toBeVisible();
  expect(await page.getByText("No release notes in the core help").count()).toBe(35 - Number((await page.getByText(/ZAP releases have release notes/).textContent())!.match(/^(\d+)/)![1]));
  const first = cards.last();                                                   // the oldest release, far below the fold
  await expect(first).toContainText(/days after|first release/);
  await expect(cards.nth(1)).toContainText(/\d+ days? after .* · [\d,]+ commits? in this window/);
  await expect(cards.nth(1)).toContainText("Top contributors:");
  await expect(cards.nth(1)).not.toContainText("@");                            // names only
  const oldest = ticks.first();
  await oldest.focus();
  await page.keyboard.press("Enter");                                           // reachable and operable from the keyboard
  await expect(first).toBeFocused();
  await expect(first).toBeInViewport();
});

test("add-on releases are grouped by year without listing every row", async ({ page }) => {
  await page.goto("releases?kind=addon-release");
  await expect(page.locator("section[aria-label] > h2").first()).toContainText(/\d+ releases?/);
  await expect(page.locator("section[aria-label] tbody tr").first()).toBeVisible();
  expect(await page.locator("section[aria-label] tbody tr").count()).toBe(100);
  await page.getByRole("button", { name: /^Show more/ }).click();
  expect(await page.locator("section[aria-label] tbody tr").count()).toBe(200);
});

test("releases: latest line, most released add-ons and a monthly heatmap", async ({ page }) => {
  await page.goto("releases");
  await expect(page.getByText(/^Latest ZAP release: ZAP \d.*latest add-on release: /)).toBeVisible();
  await page.getByRole("tab", { name: /^Add-ons/ }).click();
  const total = Number((await page.getByText(/^[\d,]+ releases, newest first/).textContent())!.match(/^([\d,]+)/)![1].replace(/,/g, ""));
  const chips = page.getByRole("group", { name: "Most released add-ons" }).getByRole("button");
  await expect(chips).toHaveCount(12);
  const counts = await chips.allTextContents();
  const n = (t: string) => +t.match(/\((\d+)\)$/)![1];
  expect([...counts].map(n)).toEqual([...counts].map(n).sort((a, b) => b - a));
  await chips.first().click();
  await expect(page).toHaveURL(/add=/);
  await expect(page.getByText(new RegExp(`^${n(counts[0])} releases, newest first`))).toBeVisible();
  await chips.first().click();                                                  // a second click clears it
  await expect(page.getByText(/^[\d,]+ releases, newest first/)).toContainText(total.toLocaleString());
  const cells = page.getByRole("group", { name: /Add-on releases per month/ }).getByRole("button");
  await expect(cells.first()).toBeVisible();
  const label = await cells.first().getAttribute("aria-label");
  const [, month, c] = label!.match(/^(\d{4}-\d\d): (\d+) /)!;
  await cells.first().click();
  await expect(page).toHaveURL(new RegExp(`from=${month}-01`));
  await expect(page.getByText(new RegExp(`^${c} releases?, newest first`))).toBeVisible();
});

test("zest and browser-extension are listed after the core repositories and have their own release tabs", async ({ page }) => {
  await page.goto("repositories");
  const names = page.locator("div.mb-3 > span.font-semibold");
  await expect(names).toHaveCount(6);
  expect(await names.allTextContents()).toEqual(["zaproxy", "zap-extensions", "zest", "browser-extension", "zap-core-help", "zap-hud"]);
  await page.goto("releases");
  const tabs = page.getByRole("tablist").getByRole("tab");
  await expect(tabs).toHaveCount(6);
  expect((await tabs.allTextContents()).some(t => /releases/i.test(t))).toBe(false);          // the page is already Releases
  await page.getByRole("tab", { name: /^Zest \(\d+\)/ }).click();
  await expect(page).toHaveURL(/kind=zest-release/);
  await expect(page.getByRole("link", { name: /^Zest \d+\.\d+/ }).first()).toBeVisible();
  await page.getByRole("tab", { name: /^Browser extension \(\d+\)/ }).click();
  await expect(page.getByRole("link", { name: /^Browser Extension \d+\.\d+\.\d+$/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /^Browser Recorder \d+/ }).first()).toBeVisible();
});

test("timeline draws the repositories with markers, zooms and has a table", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1500 });      // tall enough to hover the core team lane at the bottom of the chart
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
  const scale = box.width / 864;                      // svg units to pixels; lane geometry is fixed in svg units (extensions lane: bars near y=268, release strip near y=314)
  await page.mouse.move(box.x + box.width * 0.7, box.y + 268 * scale);
  await expect(page.getByRole("tooltip")).toContainText(/ · \d+ commits?/);
  await page.getByLabel("Show").selectOption("added");
  await page.mouse.move(box.x + box.width * 0.7, box.y + 268 * scale);
  await expect(page.getByRole("tooltip")).toContainText(/ · [\d,]+ lines? added/);
  await page.getByLabel("Show").selectOption("commits");
  await page.getByLabel("Focus").selectOption({ label: "zap-extensions · addOns/automation" });   // one add-on's own activity
  await page.mouse.move(box.x + box.width * 0.7, box.y + 268 * scale);
  await expect(page.getByRole("tooltip")).toContainText(/^zap-extensions · addOns\/automation · 20\d\d-\d\d · \d+ commits?/);
  await page.getByLabel("Focus").selectOption({ label: "zap-extensions · Java" });                  // a language
  await page.mouse.move(box.x + box.width * 0.7, box.y + 268 * scale);
  await expect(page.getByRole("tooltip")).toContainText(/^zap-extensions · Java · 20\d\d-\d\d · \d+ commits?/);
  await page.getByLabel("Focus").selectOption({ label: "zap-extensions · addOns/automation/" });  // a directory
  await page.mouse.move(box.x + box.width * 0.7, box.y + 268 * scale);
  await expect(page.getByRole("tooltip")).toContainText(/^zap-extensions · addOns\/automation · 20\d\d-\d\d · \d+ commits?/);
  await page.getByLabel("Focus").selectOption("");
  await page.mouse.move(box.x + box.width * 0.9, box.y + 314 * scale); // release strip under the zap-extensions lane
  await expect(page.getByRole("tooltip")).toContainText(/\d+ add-on releases?: /);
  await page.mouse.click(box.x + box.width * 0.9, box.y + 314 * scale);
  await expect(page).toHaveURL(/releases\?kind=addon-release&repo=zap-extensions&from=\d{4}-\d\d-\d\d&to=/);
  await expect(page.getByText(/\d+ releases, newest first · zap-extensions from/)).toBeVisible();
  await page.goBack();
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.mouse.move(box.x + box.width * 0.55, box.y + 848 * scale);          // the second row of the core team lane under the six repository lanes, where Simon Bennetts (listed throughout) sits
  await expect(page.getByRole("tooltip")).toContainText(/^Simon Bennetts · in the credits' core team from 2010-12-04 to now/);
  await page.getByText("Table: commits per year").click();
  await expect(page.getByRole("table", { name: "Commits per year by repository" })).toBeVisible();
});

test("timeline: story markers are packed so that none sits on another", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto("timeline");
  const overlapping = async () => page.evaluate(() => {
    const pts = [...document.querySelectorAll("svg a[href*='/stories/'] path")].map(p => { const r = p.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    let n = 0;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.abs(pts[i][0] - pts[j][0]) < 6 && Math.abs(pts[i][1] - pts[j][1]) < 6) n++;
    return { total: pts.length, n };
  });
  await expect(page.locator("svg a[href*='/stories/'] path").first()).toBeVisible();
  const whole = await overlapping();
  expect(whole.total).toBeGreaterThan(20);
  expect(whole.n).toBe(0);                                                                    // fully zoomed out
  await page.getByRole("combobox", { name: /Jump to/ }).selectOption("2013");
  expect((await overlapping()).n).toBe(0);                                                    // and in a year with many stories
});

test("timeline: repositories can be hidden, a dragged range zooms, and the choices survive", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto("timeline");
  const lanes = () => page.locator("svg[role=group] text[font-weight='bold']", { hasText: /^(zap|zest|browser)/ });   // the repository lanes only: "Stories" and "Core team" are also bold, and the team lane loads late
  await expect(lanes()).toHaveCount(6);                              // wait for the chart before counting
  await page.getByRole("checkbox", { name: /zap-hud/ }).uncheck();
  await expect(lanes()).toHaveCount(5);
  await expect(page).toHaveURL(/hide=zap-hud/);
  for (const r of ["zap-core-help", "zap-extensions", "zest", "browser-extension"]) await page.getByRole("checkbox", { name: new RegExp(r) }).uncheck();
  await expect(page.getByRole("checkbox", { name: /zaproxy$/ })).toBeDisabled();          // the last one stays
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /zap-hud/ })).not.toBeChecked();         // the URL keeps the choice
  for (const r of ["zap-hud", "zap-core-help", "zap-extensions", "zest", "browser-extension"]) await page.getByRole("checkbox", { name: new RegExp(r) }).check();
  const status = page.locator("span.text-slate-500", { hasText: " bars" });
  const span = async () => (await status.textContent())!.match(/(\d{4}-\d\d-\d\d) to (\d{4}-\d\d-\d\d)/)!.slice(1).map(d => Date.parse(d));
  const [a0, a1] = await span();
  const box = (await page.locator("svg[role=group] rect[style*='touch-action']").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + 100);                              // Shift+drag selects a range
  await page.keyboard.down("Shift");
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + 100, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  const [b0, b1] = await span();
  expect(b1 - b0).toBeLessThan((a1 - a0) * 0.3);
  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByRole("button", { name: "Select range" }).click();                         // the toggle: plain drag selects
  await expect(page.getByRole("button", { name: "Select range" })).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(box.x + box.width * 0.3, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + 100, { steps: 5 });
  await page.mouse.up();
  const [c0, c1] = await span();
  expect(c1 - c0).toBeLessThan((a1 - a0) * 0.3);
});

test("full width is offered on wide screens for data pages only", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto("timeline");
  const main = page.locator("main");
  const normal = (await main.boundingBox())!.width;
  await page.getByRole("button", { name: "Full width" }).click();
  expect((await main.boundingBox())!.width).toBeGreaterThan(normal + 200);
  await page.reload();
  await expect(page.getByRole("button", { name: "Standard width" })).toBeVisible();          // remembered
  await page.goto("stories");
  await expect(page.getByRole("button", { name: /width/ })).toHaveCount(0);
  expect((await main.boundingBox())!.width).toBeLessThanOrEqual(normal);
  await page.setViewportSize({ width: 1512, height: 900 });
  await page.goto("graph");
  await expect(page.getByRole("button", { name: /width/ })).toBeVisible();                   // a 1512 px laptop screen
  await page.setViewportSize({ width: 1300, height: 900 });
  await expect(page.getByRole("button", { name: /width/ })).toBeHidden();                    // narrower than 1352 px
  await page.evaluate(() => localStorage.removeItem("atlas-wide"));
});

test("graph: the sweep shows who committed in a month, and plays and pauses", async ({ page }) => {
  await page.goto("graph");
  await page.waitForSelector("canvas");
  const minYear = +(await page.getByRole("slider").first().getAttribute("min"))!;          // the Year slider starts at the first active year
  const month = page.getByRole("slider", { name: "Month" });
  await expect(month).toHaveAttribute("aria-valuetext", /^2010-(0[89]|1)/);                  // starts at the first contribution, not at January
  await expect(page.getByLabel("Speed").locator("option", { hasText: "1.5x" })).toHaveCount(1);
  await month.evaluate((el: HTMLInputElement, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, (2024 - minYear) * 12 + 5);                                                              // 2024-06
  await expect(page.getByText(/^2024-06: .+ \(\d+\)/)).toBeVisible();                         // an author with module commit counts
  const summary = page.locator("p[aria-live]", { hasText: /^2024-06: / });
  await expect(summary).not.toContainText("zapbot:");                                         // bots are left out by default
  await page.getByRole("checkbox", { name: "Include bots" }).check();
  await expect(summary).toContainText("zapbot:");
  await page.getByRole("checkbox", { name: "Include bots" }).uncheck();
  await expect(summary).toContainText(/\d+ others? \(\d+ commits?\)/);                       // everyone beyond the top 8
  await page.getByRole("textbox", { name: "Name or username" }).fill("thc202");
  await expect(summary).toContainText("plus anyone matching the text above");
  await page.getByLabel("How to use the name text").selectOption("only");
  await expect(summary).toContainText("thc202:");
  await expect(summary).not.toContainText("kingthorin:");                                      // only the matching person
  await expect(summary).not.toContainText(/\d+ others? \(/);                                  // and nobody pooled as Other
  await expect(summary).toContainText("but only people matching the text above are shown");
  await page.getByRole("textbox", { name: "Name or username" }).fill("thc202, kingthorin, nobody-by-this-name");   // several names, separated by commas
  await expect(summary).toContainText("thc202:");
  await expect(summary).toContainText("kingthorin:");
  await expect(summary).not.toContainText("Simon Bennetts:");
  await page.getByLabel("How to use the name text").selectOption("always");
  await page.getByRole("textbox", { name: "Name or username" }).fill("");
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(month).toHaveAttribute("aria-valuetext", /^2024-(0[7-9]|1)/, { timeout: 8000 });   // it advanced on its own
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  await page.setViewportSize({ width: 1800, height: 1000 });                                  // with full width there is room: the names move beside the graph
  await page.getByRole("button", { name: "Full width" }).click();
  await expect(page.getByRole("complementary", { name: /Contributors in 20/ })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("atlas-wide"));
});

test("graph: pressing Record first on a wide screen is not cut short by the names column appearing", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1800, height: 1000 });
  await page.goto("graph");
  await page.waitForSelector("canvas");
  await page.getByRole("button", { name: "Full width" }).click();
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "Export WebM" }).click();                            // nothing else used yet
  const overlay = page.getByRole("alertdialog", { name: "Recording in progress" });
  await expect(overlay).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(overlay).toBeVisible();                                                       // still going
  await overlay.getByRole("button", { name: "Stop and save" }).click();
  const file = await download;
  const path = await file.path();
  expect((await import("fs")).statSync(path!).size).toBeGreaterThan(10_000);
  await page.evaluate(() => localStorage.removeItem("atlas-wide"));
});

test("graph: the sweep shows the time left and records a WebM clip", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1800, height: 1000 });                                  // wide: using the sweep adds the names column
  await page.goto("graph");
  await page.waitForSelector("canvas");
  await page.getByRole("button", { name: "Full width" }).click();
  const month = page.getByRole("slider", { name: "Month" });
  const max = +(await month.getAttribute("max"))!;
  const left = page.getByTitle("Time left to play to the end at the chosen speed");
  await expect(left).toContainText(/^\d+:\d\d left$/);
  await page.getByLabel("Speed").selectOption("4");
  const quick = await left.textContent();
  await page.getByLabel("Speed").selectOption("0.5");
  expect(await left.textContent()).not.toBe(quick);                                          // slower, so longer to go
  await month.evaluate((el: HTMLInputElement, v: number) => {                                  // two months from the end
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, max - 1);
  await page.getByLabel("Speed").selectOption("4");
  const download = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "Export WebM" }).click();
  const overlay = page.getByRole("alertdialog", { name: "Recording in progress" });
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("Changing controls or the window size");
  await expect(page.getByRole("button", { name: "Export WebM" })).toHaveCount(0);            // not while one is running
  const file = await download;                                                               // it ends by itself at the last month
  expect(file.suggestedFilename()).toMatch(/^zap-atlas-sweep-\d{4}-\d\d-to-\d{4}-\d\d\.webm$/);
  const path = await file.path();
  const bytes = (await import("fs")).readFileSync(path!);
  expect(bytes.length).toBeGreaterThan(10_000);
  expect(bytes.subarray(0, 4).toString("hex")).toBe("1a45dfa3");                              // a WebM (EBML) header
  await expect(page.getByText(/Saved zap-atlas-sweep-/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Download again" })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByRole("link", { name: "Download again" })).toHaveCount(0);
  await expect(page.getByText(/Recording stopped/)).toHaveCount(0);                          // not cut short by the layout changing
  await page.evaluate(() => localStorage.removeItem("atlas-wide"));
});

test("graph: Cancel during an export discards the clip", async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 1000 });
  await page.goto("graph");
  await page.waitForSelector("canvas");
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await page.getByRole("button", { name: "Export WebM" }).click();
  const overlay = page.getByRole("alertdialog", { name: "Recording in progress" });
  await expect(overlay).toBeVisible();
  await page.waitForTimeout(800);
  await overlay.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Recording cancelled; nothing was saved.")).toBeVisible();
  await page.waitForTimeout(500);
  expect(downloaded).toBe(false);
  await expect(page.getByRole("button", { name: "Export WebM" })).toBeVisible();
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
  await expect(summary).toContainText(/\+ (4\d|5\d|60) files, \d+ directories/);   // 40 source files and up to 20 help pages
  await expect(page.getByText(/showing \d+ of \d+ files/)).toBeVisible();
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

test("module graph: the add-on dependency view keeps only dependency edges and drops unlinked modules", async ({ page }) => {
  await page.goto("source?tab=deps");
  await page.getByRole("link", { name: "Show them as a network" }).click();       // the table links to the network
  await expect(page).toHaveURL(/graph\?view=deps/);
  const summary = page.getByText(/\d+ modules.*linked pairs/);
  await expect(page.getByRole("button", { name: "Add-on dependencies", exact: true })).toHaveAttribute("aria-pressed", "true");
  const deps = (await summary.textContent())!;
  const count = (t: string) => Number(t.match(/(\d+) modules/)![1]);
  expect(count(deps)).toBeGreaterThan(20); expect(count(deps)).toBeLessThan(90);   // modules without a dependency edge are dropped
  await expect(page.getByRole("button", { name: "DEPENDS_ON", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "CALLS", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("Size by")).toHaveValue("dependents");
  await page.getByRole("button", { name: "All links", exact: true }).click();
  await expect(summary).not.toHaveText(deps);
  expect(count((await summary.textContent())!)).toBeGreaterThan(80);
});
