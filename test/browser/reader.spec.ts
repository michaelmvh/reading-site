import { test, expect } from "@playwright/test";

test("filters, article return, and history work without the NAS or provider calls", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("/");
  const total = await page.locator(".publication").count();
  const defaults = await page.locator('.publication[data-default-author="true"]').count();
  await expect(page.locator(".publication:visible")).toHaveCount(defaults);
  const subscription = await page.getByRole("link", { name: "View raw RSS" }).getAttribute("href");
  await page.locator("[data-author-picker] summary").click();
  await page.getByRole("checkbox", { name: "All tracked authors", exact: true }).check();
  await expect(page.locator(".publication:visible")).toHaveCount(total);
  await page.getByText("Paper sources", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Tracked authors", exact: true }).uncheck();
  await expect(page.locator(".publication:visible")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "View raw RSS" })).toHaveAttribute("href", subscription!);
  await page.locator(".publication:visible h2 a").click();
  await page.reload();
  await expect(page.locator(".abstract")).toBeVisible();
  await page.getByRole("link", { name: "Back to all publications" }).click();
  await expect(page.locator('[name="authors"]')).toHaveValue("all");
  await expect(page.locator(".publication:visible")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator(".publication:visible")).toHaveCount(defaults);
  await page.goBack();
  await expect(page.locator('[name="authors"]')).toHaveValue("all");
  expect(requests.every((url) => new URL(url).origin === "http://127.0.0.1:8080")).toBe(true);
});

test("empty custom selection and invalid URLs have explicit recovery", async ({ page }) => {
  await page.goto("/?authors=custom");
  await expect(page.locator(".publication:visible")).toHaveCount(0);
  await expect(page.locator("[data-filter-empty]")).toBeVisible();
  await page.goto("/?source=missing");
  await expect(page.getByRole("alert")).toContainText("Unknown source");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("alert")).toBeHidden();
});

test("original header and automatic controls do not expose implementation modes or collections", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "Author selection", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Apply filters" })).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.locator(".filter-fields > *")).toHaveCount(3);
  await expect(page.locator(".feed-meta [data-filter-count]")).toBeVisible();
  await expect(page.locator(".author-key")).toContainText("Highlighted authors");
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeHidden();
  await page.getByRole("combobox", { name: "Publication date", exact: true }).selectOption("1y");
  await expect(page).toHaveURL(/\?period=1y$/);
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("button", { name: "Clear filters" })).toBeHidden();
  await expect(page.locator("footer")).toContainText("Data collected");
});

test("author select-all, partial and empty selections survive reload and history", async ({ page }) => {
  await page.goto("/");
  const picker = page.locator("[data-author-picker]");
  const all = picker.getByRole("checkbox", { name: "All tracked authors", exact: true });
  await picker.locator("summary").click();
  expect(await all.evaluate((input: HTMLInputElement) => input.indeterminate)).toBe(true);
  await expect(picker.locator("[data-author-summary]")).toHaveText("Required Author");
  await all.check();
  await expect(page.locator(".publication:visible")).toHaveCount(3);
  await expect(picker.locator("[data-author-summary]")).toHaveText("All tracked authors");
  await all.uncheck();
  await expect(page).toHaveURL(/\?authors=custom$/);
  await expect(page.locator(".publication:visible")).toHaveCount(0);
  await expect(picker.locator("[data-author-summary]")).toHaveText("No tracked authors");
  await picker.getByRole("checkbox", { name: "Optional Author", exact: true }).check();
  await expect(page.locator(".publication:visible")).toHaveCount(1);
  await page.reload();
  await expect(picker.locator("[data-author-summary]")).toHaveText("Optional Author");
  await expect(page.locator(".publication:visible")).toHaveCount(1);
  await page.goBack();
  await expect(page.locator(".publication:visible")).toHaveCount(0);
  await page.goForward();
  await expect(page.locator(".publication:visible")).toHaveCount(1);
});

test("dropdowns close outside, on Escape and when focus moves to another control", async ({ page }) => {
  await page.goto("/");
  const authors = page.locator("[data-author-picker]");
  const sources = page.locator("[data-source-picker]");
  await authors.locator("summary").click();
  await expect(authors).toHaveAttribute("open", "");
  await page.locator("h1").click();
  await expect(authors).not.toHaveAttribute("open");
  await authors.locator("summary").click();
  await sources.locator("summary").click();
  await expect(authors).not.toHaveAttribute("open");
  await expect(sources).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(sources).not.toHaveAttribute("open");
  await expect(sources.locator("summary")).toBeFocused();
  await authors.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(authors).toHaveAttribute("open", "");
  await page.keyboard.press("Tab");
  await expect(authors.getByRole("checkbox", { name: "All tracked authors", exact: true })).toBeFocused();
  await page.getByRole("combobox", { name: "Publication date", exact: true }).focus();
  await expect(authors).not.toHaveAttribute("open");
});

test("source groups and last-source protection keep controls, URL and results consistent", async ({ page }) => {
  await page.goto("/?authors=all");
  const picker = page.locator("[data-source-picker]");
  await picker.locator("summary").click();
  await expect(picker.locator(".filter-option-group > strong")).toHaveText(["Core feed"]);
  await picker.getByRole("checkbox", { name: "Tracked authors", exact: true }).uncheck();
  await expect(picker.locator("[data-source-summary]")).toHaveText("Example collection");
  const selectedUrl = page.url();
  await picker.getByRole("checkbox", { name: "Example collection", exact: true }).click();
  await expect(picker.getByRole("checkbox", { name: "Example collection", exact: true })).toBeChecked();
  await expect(page.getByRole("alert")).toContainText("Select at least one paper source");
  expect(page.url()).toBe(selectedUrl);
  await expect(page.locator(".publication:visible")).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(picker.locator("[data-source-summary]")).toHaveText("Example collection");
  await expect(page.locator(".publication:visible")).toHaveCount(1);
});

test("source changes update available authors without broadening a custom selection", async ({ page }) => {
  await page.goto("/?authors=custom&author=required");
  const authors = page.locator("[data-author-picker]");
  const sources = page.locator("[data-source-picker]");
  await sources.locator("summary").click();
  await sources.getByRole("checkbox", { name: "Tracked authors", exact: true }).uncheck();
  await expect(page.locator(".publication:visible")).toHaveCount(0);
  await authors.locator("summary").click();
  await expect(authors.getByRole("checkbox", { name: "Optional Author", exact: true })).toBeVisible();
  await expect(authors.getByLabel("Required Author", { exact: true })).toBeHidden();
  await expect(authors.locator("[data-author-summary]")).toHaveText("No tracked authors");
  await page.reload();
  await expect(page.locator('[name="authors"]')).toHaveValue("custom");
  await expect(page.locator(".publication:visible")).toHaveCount(0);
  await sources.locator("summary").click();
  await sources.getByRole("checkbox", { name: "Tracked authors", exact: true }).check();
  await expect(page.locator(".publication:visible")).toHaveCount(1);
  await expect(authors.locator("[data-author-summary]")).toHaveText("Required Author");
});

test("feeds without tracked authors retain their context on shared article pages", async ({ page }) => {
  await page.goto("/feeds/native/");
  await expect(page.locator("[data-author-picker]")).toHaveCount(0);
  await expect(page.locator(".author-key")).toHaveCount(0);
  await expect(page.locator(".publication .notable-author")).toHaveCount(0);
  await page.locator("[data-source-picker] summary").click();
  await expect(page.locator(".filter-option-group > strong")).toHaveText(["bioRxiv", "arXiv"]);
  await page.getByRole("checkbox", { name: "Bioinformatics", exact: true }).uncheck();
  const listing = page.url();
  const rss = await page.getByRole("link", { name: "View raw RSS" }).getAttribute("href");
  await page.locator(".publication h2 a").click();
  await page.reload();
  await expect(page).toHaveTitle(/ · Native Preprints$/);
  await expect(page.locator(".authors .notable-author")).toHaveCount(0);
  await expect(page.locator(".author-note")).toBeHidden();
  await expect(page.getByRole("link", { name: "View raw RSS" })).toHaveAttribute("href", rss!);
  await expect(page.locator('link[rel="alternate"]')).toHaveAttribute("href", rss!);
  await expect(page.locator('link[rel="alternate"]')).toHaveAttribute("title", "Native Preprints");
  await expect(page.locator(".provenance")).toHaveText([
    "Preprint source: bioRxiv bioinformatics, arXiv biomolecules",
    "Curated by Example collection · Protein design",
  ]);
  await page.getByRole("link", { name: "Back to all publications" }).click();
  expect(page.url()).toBe(listing);
  await expect(page.locator(".publication:visible")).toHaveCount(1);
});

test("no-JavaScript content, icons, RSS, and article pages are complete", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: "http://127.0.0.1:8080" });
  const page = await context.newPage();
  await page.goto("/");
  const defaults = await page.locator('.publication[data-default-author="true"]').count();
  await expect(page.locator(".publication:visible")).toHaveCount(defaults);
  await expect(page.locator("[data-static-filters]")).toBeHidden();
  for (const selector of ['link[rel="icon"]', 'link[rel="apple-touch-icon"]', 'link[rel="alternate"]']) {
    const response = await page.request.get((await page.locator(selector).getAttribute("href"))!);
    expect(response.ok()).toBe(true);
  }
  await page.locator(".publication:visible h2 a").first().click();
  await expect(page.locator(".abstract")).toBeVisible();
  await expect(page.getByRole("link", { name: "View raw RSS" })).toBeVisible();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /^Abstract for /);
  await context.close();
});

test("mobile reader is keyboard-accessible without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("[data-static-filters]")).toBeVisible();
  const date = page.getByRole("combobox", { name: "Publication date", exact: true });
  await date.focus();
  await expect(date).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const width of [320, 390, 768, 1280]) {
  test(`open dropdowns fit the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    for (const selector of ["[data-author-picker]", "[data-source-picker]"]) {
      const picker = page.locator(selector);
      await picker.locator("summary").click();
      const bounds = await picker.locator(".filter-options").boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.keyboard.press("Escape");
    }
  });
}
