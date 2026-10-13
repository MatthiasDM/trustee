import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("mede-eigenaar brengt een gewogen stem uit en ziet het resultaat", async ({ page }) => {
  await login(page, "marie@demo.be");
  await page.goto("/b/b-zeezicht/polls");
  await page.getByText("Goedkeuring offerte dakrenovatie").click();
  await expect(page.getByText("2/3 meerderheid")).toBeVisible();
  await page.getByText("Ja, goedkeuren").click();
  await page.getByRole("button", { name: "Stem uitbrengen" }).click();
  await expect(page.getByText("Je hebt gestemd")).toBeVisible();
  await expect(page.getByText(/stemmers/)).toBeVisible();
  await expect(page.getByText(/Gehaald|Niet gehaald/)).toBeVisible();
});

test("huurder kan niet stemmen", async ({ page }) => {
  await login(page, "lotte@demo.be");
  await page.goto("/b/b-zeezicht/polls");
  await page.getByText("Goedkeuring offerte dakrenovatie").click();
  await expect(page.getByText("niet stemgerechtigd")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stem uitbrengen" })).toHaveCount(0);
});

test("syndicus maakt een nieuwe stemming aan en ze verschijnt in de lijst", async ({ page }) => {
  await login(page, "syndicus@demo.be");
  await page.goto("/b/b-zeezicht/polls");
  await page.getByRole("button", { name: "Nieuwe stemming" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Onderwerp / agendapunt").fill("E2E: kleur van de inkomhal");
  await dlg.getByRole("button", { name: "Aanmaken" }).click();
  await expect(page.getByRole("heading", { name: /kleur van de inkomhal/ })).toBeVisible();
  await page.goto("/b/b-zeezicht/polls");
  await expect(page.getByText("E2E: kleur van de inkomhal")).toBeVisible();
});
