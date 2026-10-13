import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("factuur boeken via een handeling verschijnt in de boekingen en het overzicht", async ({ page }) => {
  await login(page, "syndicus@demo.be");
  await page.goto("/b/b-zeezicht/ledger?tab=book");
  await page.getByText("Kost rechtstreeks betaald via bank").click();
  await page.getByLabel("Tegenpartij").fill("E2E Poetsdienst");
  await page.getByLabel("Bedrag (€)").fill("123.45");
  await page.getByLabel("Kostenrekening").click();
  await page.getByRole("option", { name: /6105/ }).click();
  await page.getByRole("button", { name: "Boeken", exact: true }).click();
  await expect(page.getByText(/geboekt/)).toBeVisible();
  await page.goto("/b/b-zeezicht/ledger?tab=journal");
  await page.getByPlaceholder("Zoek omschrijving of tegenpartij").fill("E2E Poetsdienst");
  await expect(page.getByText("E2E Poetsdienst via bank")).toBeVisible();
  await page.getByText("E2E Poetsdienst via bank").click();
  await expect(page.getByRole("dialog")).toContainText("6105");
  await expect(page.getByRole("dialog")).toContainText("123.45");
});

test("bankuittreksel importeren en een verrichting verwerken", async ({ page }) => {
  await login(page, "syndicus@demo.be");
  await page.goto("/b/b-zeezicht/ledger?tab=bank");
  await page.getByRole("button", { name: "Uittreksel importeren" }).first().click();
  const dlg = page.getByRole("dialog");
  const csv = "Datum;Bedrag;Naam tegenpartij;Mededeling\n02/06/2026;-77,00;E2E TUINMAN;onderhoud tuin juni\n";
  await dlg.locator('input[type="file"]').setInputFiles({ name: "bank.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await dlg.getByRole("button", { name: "Importeren", exact: true }).click();
  await expect(page.getByText(/geïmporteerd/)).toBeVisible();
  const row = page.locator("div", { hasText: "E2E TUINMAN" }).filter({ has: page.getByRole("button", { name: "Verwerken" }) }).last();
  await row.getByRole("button", { name: "Verwerken" }).click();
  const m = page.getByRole("dialog");
  await m.getByLabel("Kostenrekening").click();
  await page.getByRole("option", { name: /6106/ }).click();
  await m.getByRole("button", { name: "Boeken" }).click();
  await expect(page.getByText("Geboekt", { exact: true })).toBeVisible();
  await expect(page.getByText("E2E TUINMAN")).toHaveCount(0);
});

test("mede-eigenaar ziet het kasboek-overzicht en enkel zijn eigen afrekening", async ({ page }) => {
  await login(page, "marie@demo.be");
  await page.goto("/b/b-zeezicht/ledger");
  await expect(page.getByText("Werkkapitaal op bank")).toBeVisible();
  await page.goto("/b/b-zeezicht/ledger?tab=mine");
  await expect(page.getByText("Kavel A2")).toBeVisible();
  await expect(page.getByText("Kavel A1")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Boeken" })).toHaveCount(0);
});
