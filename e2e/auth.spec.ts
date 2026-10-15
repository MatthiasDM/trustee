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

test("startpagina is openbaar met link naar demo en handleiding; na aanmelden toont / de gebouwenlijst", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /De mede-eigenaars beslissen/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Probeer de demo zonder account" })).toHaveAttribute("href", "/demo");
  await page.getByRole("link", { name: "Lees de handleiding" }).click();
  await expect(page).toHaveURL(/\/help/);
  await expect(page.getByText("Wat jij als mede-eigenaar kan en mag").first()).toBeVisible();
  await login(page, "marie@demo.be");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Welkom/ })).toBeVisible();
});

test("demobalk neemt geen ruimte van de inhoud: de laatste knop van de pagina blijft bereikbaar", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Start de demo" }).click();
  await expect(page.getByRole("region", { name: "Demo" })).toBeVisible();
  await page.getByRole("link", { name: "Instellingen" }).click();
  const last = page.getByRole("button", { name: "Verwijderen", exact: true }).last();
  await last.scrollIntoViewIfNeeded();
  const bar = await page.getByRole("region", { name: "Demo" }).boundingBox(); const box = await last.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y + 1);
  // zijbalk: profielmenu onderaan niet verborgen achter de balk
  const menu = await page.getByRole("button", { name: /Sofie Vermeulen/ }).first().boundingBox();
  expect(menu!.y + menu!.height).toBeLessThanOrEqual(bar!.y + 1);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Beëindigen" }).click();
});
