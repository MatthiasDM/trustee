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
