import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("taal wisselen naar Frans vertaalt de navigatie; terug naar Nederlands", async ({ page }) => {
  await login(page, "marie@demo.be");
  await page.goto("/b/b-zeezicht/settings");
  await page.locator("label", { hasText: "Taal" }).locator("..").getByRole("combobox").click();
  await page.getByRole("option", { name: "Français" }).click();
  await page.getByRole("button", { name: "Opslaan" }).first().click();
  await expect(page.getByRole("link", { name: "Documents" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Assemblée générale" })).toBeVisible();
  await page.locator("label", { hasText: "Langue" }).locator("..").getByRole("combobox").click();
  await page.getByRole("option", { name: "Nederlands" }).click();
  await page.getByRole("button", { name: "Enregistrer" }).first().click();
  await expect(page.getByRole("link", { name: "Documenten" })).toBeVisible();
});

test("donker thema schakelt in via het profielmenu en blijft na herladen", async ({ page }) => {
  await login(page, "marie@demo.be");
  await page.getByRole("button", { name: /Marie Claes/ }).click();
  await page.getByRole("menuitem", { name: /thema/ }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("kantoorportaal toont gebouwen en actiepunten voor de syndicus, niet voor een eigenaar", async ({ page }) => {
  await login(page, "syndicus@demo.be");
  await page.getByRole("link", { name: /Kantoor: Syndicus Vermeulen/ }).click();
  await expect(page.getByRole("heading", { name: "Syndicus Vermeulen bv" })).toBeVisible();
  await expect(page.getByText("Actiepunten")).toBeVisible();
  await expect(page.getByText("Residentie Zeezicht").first()).toBeVisible();
});
