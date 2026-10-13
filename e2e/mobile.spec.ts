import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("mobiel: menu via de hamburger, dashboard zonder horizontale scroll, melding maken", async ({ page }) => {
  await login(page, "marie@demo.be");
  await page.goto("/b/b-zeezicht");
  await expect(page.getByRole("heading", { name: "Residentie Zeezicht" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("link", { name: "Vragen & meldingen" }).click();
  await expect(page.getByRole("heading", { name: "Vragen & meldingen" })).toBeVisible();
  await page.getByRole("button", { name: "Melding", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Titel").fill("E2E mobiel: deurbel defect");
  await dlg.getByLabel("Bericht").fill("Bel van kavel A2 werkt niet.");
  await dlg.getByRole("button", { name: "Plaatsen" }).click();
  await expect(page.getByRole("heading", { name: /deurbel defect/ })).toBeVisible();
});
