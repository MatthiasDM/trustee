import { expect, test } from "@playwright/test";
import { login, logout } from "./helpers";

test("eigenaar stelt een vraag, syndicus geeft het officiële antwoord en sluit af", async ({ page }) => {
  await login(page, "marie@demo.be");
  await page.goto("/b/b-zeezicht/posts");
  await page.getByRole("button", { name: "Vraag", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Titel").fill("E2E: wanneer komt de schoorsteenveger?");
  await dlg.getByLabel("Bericht").fill("Vorig jaar was het in oktober.");
  await dlg.getByRole("button", { name: "Plaatsen" }).click();
  await expect(page.getByRole("heading", { name: /schoorsteenveger/ })).toBeVisible();
  await logout(page);

  await login(page, "syndicus@demo.be");
  await page.goto("/b/b-zeezicht/posts");
  await page.getByText("E2E: wanneer komt de schoorsteenveger?").click();
  await page.getByPlaceholder("Schrijf een reactie…").fill("Op 20 oktober, tussen 9 en 12 uur.");
  await page.getByText("Markeren als officieel antwoord").click();
  await page.getByRole("button", { name: "Reageren" }).click();
  await expect(page.getByText("Officieel antwoord")).toBeVisible();
  await expect(page.getByText("Beantwoord").first()).toBeVisible();
  await page.getByRole("button", { name: "Gesloten" }).click();
  await expect(page.getByText("Dit bericht is gesloten.")).toBeVisible();
});

test("melding met plaats en prioriteit; syndicus wijst toe aan leverancier", async ({ page }) => {
  await login(page, "syndicus@demo.be");
  await page.goto("/b/b-zeezicht/posts?new=incident");
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Titel").fill("E2E: lamp kapot in inkomhal");
  await dlg.getByLabel("Bericht").fill("Sinds gisteren.");
  await dlg.getByLabel("Plaats").fill("Inkomhal");
  await dlg.getByRole("button", { name: "Plaatsen" }).click();
  await expect(page.getByRole("heading", { name: /lamp kapot/ })).toBeVisible();
  await expect(page.getByText("Inkomhal", { exact: true })).toBeVisible();
  await expect(page.getByText("Opvolging")).toBeVisible();
  await page.getByRole("button", { name: "In behandeling" }).click();
  await expect(page.getByText("In behandeling").first()).toBeVisible();
});
