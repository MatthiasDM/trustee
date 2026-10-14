import { expect, test } from "@playwright/test";
import { login, PW } from "./helpers";

test("fout wachtwoord toont een foutmelding, juist wachtwoord brengt naar de gebouwenlijst", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("syndicus@demo.be");
  await page.getByLabel("Wachtwoord").fill("verkeerd");
  await page.getByRole("button", { name: "Aanmelden" }).click();
  await expect(page.getByRole("alert")).toContainText("Ongeldige");
  await page.getByLabel("Wachtwoord").fill(PW);
  await page.getByRole("button", { name: "Aanmelden" }).click();
  await expect(page.getByRole("heading", { name: /Welkom, Sofie/ })).toBeVisible();
  await page.getByRole("link", { name: /Residentie Zeezicht/ }).first().click();
  await expect(page.getByRole("heading", { name: "Residentie Zeezicht" })).toBeVisible();
  await expect(page.getByText("Organen van de VME")).toBeVisible();
});

test("afmelden via het profielmenu beëindigt de sessie", async ({ page }) => {
  await login(page, "marie@demo.be");
  await page.getByRole("button", { name: /Marie Claes/ }).click();
  await page.getByRole("menuitem", { name: "Afmelden" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/b/b-zeezicht");
  await expect(page).toHaveURL(/\/login/);
});

test("onbekende route valt terug op de app", async ({ page }) => {
  await login(page, "marie@demo.be");
  await page.goto("/dit/bestaat/niet");
  await expect(page.getByRole("heading", { name: /Welkom/ })).toBeVisible();
});

test("juridische pagina's zijn openbaar; registratie vereist aanvaarding; nieuwe versie toont de aanvaardingsdialoog", async ({ page }) => {
  await page.goto("/voorwaarden");
  await expect(page.getByRole("heading", { name: "Algemene voorwaarden Trustee" })).toBeVisible();
  await page.getByRole("link", { name: "Privacyverklaring" }).first().click();
  await expect(page.getByRole("heading", { name: "Privacyverklaring Trustee" })).toBeVisible();
  await page.goto("/register");
  await expect(page.getByRole("button", { name: "Account aanmaken" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: "Account aanmaken" })).toBeEnabled();
  // simuleer een nieuwe versie: wis de aanvaarding van Jan en meld aan
  await login(page, "jan@demo.be");
  await page.request.post("/api/admin/reset-consents");
  await page.reload();
  const dlg = page.getByRole("dialog", { name: "Voorwaarden en privacy" });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Aanvaarden en verdergaan" })).toBeDisabled();
  await dlg.getByRole("checkbox").check();
  await dlg.getByRole("button", { name: "Aanvaarden en verdergaan" }).click();
  await expect(dlg).toHaveCount(0);
});
