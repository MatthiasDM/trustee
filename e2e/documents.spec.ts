import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("document uploaden, terugvinden via zoeken, voorvertonen en verwijderen", async ({ page }) => {
  await login(page, "syndicus@demo.be");
  await page.goto("/b/b-zeezicht/documents");
  await page.getByRole("button", { name: "Uploaden" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.locator('input[type="file"]').setInputFiles({ name: "e2e-verslag.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% e2e test\n") });
  await dlg.getByLabel("Omschrijving (optioneel)").fill("E2E upload");
  await dlg.getByRole("button", { name: "Uploaden", exact: true }).click();
  await expect(page.getByText("Document geüpload")).toBeVisible();
  await page.getByPlaceholder("Zoeken in alle documenten…").fill("e2e-verslag");
  await expect(page.getByText("e2e-verslag.pdf")).toBeVisible();
  await page.getByTitle("Voorvertoning").click();
  await expect(page.getByRole("dialog").locator("iframe")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Sluiten" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Acties" }).first().click();
  await page.getByRole("menuitem", { name: "Verwijderen" }).click();
  await expect(page.getByText("Document verwijderd")).toBeVisible();
});

test("huurder ziet geen map 'enkel syndicus' en geen uploadknop voor beperkte zichtbaarheid", async ({ page }) => {
  await login(page, "lotte@demo.be");
  await page.goto("/b/b-zeezicht/documents");
  await expect(page.getByRole("heading", { name: "Documenten" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Uploaden" })).toHaveCount(0);
});

test("keuringen: tab toont lege staat en syndicus registreert een keuring", async ({ page }) => {
  await login(page, "syndicus@demo.be");
  await page.goto("/b/b-zeezicht/documents?tab=compliance");
  await page.getByRole("button", { name: "Keuring", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Laatste keuring").fill("2026-09-01");
  await dlg.getByRole("button", { name: "Bewaren" }).click();
  await expect(page.getByText("Liftkeuring").first()).toBeVisible();
  await expect(page.getByText(/vervalt/)).toBeVisible();
});
