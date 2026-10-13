import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("eigenaar dient een agendapunt in en geeft een volmacht; syndicus ziet quorum", async ({ page }) => {
  await login(page, "marie@demo.be");
  await page.goto("/b/b-zeezicht/meetings");
  await page.getByRole("button", { name: "Agendapunt indienen" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Agendapunt").fill("E2E: fietsenrek vervangen");
  await dlg.getByRole("button", { name: "Indienen" }).click();
  await expect(page.getByText("Agendapunt ingediend")).toBeVisible();
  await expect(page.getByText("E2E: fietsenrek vervangen")).toBeVisible();
  await page.getByRole("button", { name: "Volmacht" }).first().click();
  const pd = page.getByRole("dialog");
  await pd.getByRole("combobox").click();
  await page.getByRole("option", { name: /Jan Peeters/ }).click();
  await pd.getByRole("button", { name: "Volmacht geven" }).click();
  await expect(page.getByText("Volmacht geregistreerd")).toBeVisible();
  await page.getByRole("button", { name: "Quorum" }).first().click();
  await expect(page.getByText(/^Quorum (bereikt|niet bereikt)$/)).toBeVisible();
});

test("syndicus agendeert het punt, registreert de stemming en genereert notulen", async ({ page }) => {
  await login(page, "syndicus@demo.be");
  await page.goto("/b/b-zeezicht/meetings");
  await page.getByRole("combobox", { name: "" }).filter({ hasText: "Agenderen op" }).first().click();
  await page.getByRole("option").first().click();
  await expect(page.getByText("Fietsenstalling uitbreiden")).toBeVisible();
  await page.getByRole("button", { name: "Stemmen (AV)" }).first().click();
  const vd = page.getByRole("dialog");
  await expect(vd.getByText(/Vóór \d+/)).toBeVisible();
  await vd.getByRole("button", { name: "Beslissing vastleggen" }).click();
  await expect(page.getByText(/Goedgekeurd|Verworpen/).first()).toBeVisible();
  await page.getByRole("button", { name: /Notulen/ }).first().click();
  const nd = page.getByRole("dialog");
  await nd.getByRole("button", { name: /genereren/ }).click();
  await expect(nd.locator("textarea")).toHaveValue(/Aanwezigheid en quorum/);
  await nd.getByRole("button", { name: "Ontwerp bewaren" }).click();
  await expect(page.getByText("Ontwerp bewaard")).toBeVisible();
});

test("syndicus zonder kavel ziet geen aanwezigheids- of volmachtknoppen, wel 'Punt agenderen'", async ({ page }) => {
  await login(page, "syndicus@demo.be");
  await page.goto("/b/b-zeezicht/meetings");
  await expect(page.getByRole("button", { name: "Punt agenderen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Agendapunt indienen" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Volmacht" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Verzoek starten" })).toHaveCount(0);
});
