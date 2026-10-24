import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page, type TestInfo } from "@playwright/test";

async function expectAccessible(page: Page, testInfo: TestInfo, state: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  if (results.violations.length) {
    await testInfo.attach(`${state}-axe-results`, {
      body: JSON.stringify(results, null, 2),
      contentType: "application/json",
    });
  }
  expect(results.violations, `Accessibility violations in ${state}`).toEqual([]);
}

for (const width of [390, 1280]) {
  test.describe(`accessibility at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("listing templates, article details, and not-found page", async ({ page }, testInfo) => {
      for (const route of ["/", "/feeds/example/", "/feeds/native/"]) {
        await page.goto(route);
        await expect(page.locator("[data-static-filters]")).toBeVisible();
        await expectAccessible(page, testInfo, `listing-${route.replaceAll("/", "-")}`);
        await page.locator(".publication:visible h2 a").first().click();
        await expect(page.locator(".abstract")).toBeVisible();
        await expectAccessible(page, testInfo, `article-${route.replaceAll("/", "-")}`);
      }
      await page.goto("/404.html");
      await expectAccessible(page, testInfo, "not-found");
    });

    test("expanded filters, empty results, and validation errors", async ({ page }, testInfo) => {
      await page.goto("/");
      const authors = page.locator("[data-author-picker]");
      await authors.locator("summary").click();
      await expectAccessible(page, testInfo, "authors-expanded");
      await authors.getByRole("checkbox", { name: "All tracked authors", exact: true }).check();
      await expect(page.locator(".publication:visible")).toHaveCount(3);
      await expectAccessible(page, testInfo, "all-authors");
      await authors.getByRole("checkbox", { name: "All tracked authors", exact: true }).uncheck();
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-filter-empty]")).toBeVisible();
      await expectAccessible(page, testInfo, "empty-results");
      await page.getByRole("button", { name: "Clear filters" }).click();
      const sources = page.locator("[data-source-picker]");
      await sources.locator("summary").click();
      await expectAccessible(page, testInfo, "sources-expanded");
      await sources.getByRole("checkbox", { name: "Tracked authors", exact: true }).uncheck();
      await sources.getByRole("checkbox", { name: "Example collection", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Select at least one paper source");
      await expectAccessible(page, testInfo, "source-error");
      await page.goto("/?source=missing");
      await expect(page.getByRole("alert")).toContainText("Unknown source");
      await expectAccessible(page, testInfo, "invalid-url");
    });

    test("source-only feed expanded filters", async ({ page }, testInfo) => {
      await page.goto("/feeds/native/");
      await page.locator("[data-source-picker] summary").click();
      await expectAccessible(page, testInfo, "native-sources-expanded");
    });

    test.describe("without reader JavaScript", () => {
      test("listing and article remain accessible", async ({ page }, testInfo) => {
        // Block application scripts while allowing axe's injected audit JavaScript.
        await page.route("**/*", (route) => route.request().resourceType() === "script"
          ? route.abort() : route.continue());
        await page.goto("/");
        await expect(page.locator("[data-static-filters]")).toBeHidden();
        await expectAccessible(page, testInfo, "no-js-listing");
        await page.locator(".publication:visible h2 a").first().click();
        await expect(page.locator(".abstract")).toBeVisible();
        await expectAccessible(page, testInfo, "no-js-article");
      });
    });
  });
}
