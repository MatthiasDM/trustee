import { expect, test } from "@playwright/test";
import { login, logout } from "./helpers";

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

test("syndicus koppelt een nieuw geüploade offerte aan een stemming; mede-eigenaar opent ze vanuit de stemming", async ({ page }) => {
  await login(page, "syndicus@demo.be");
  await page.goto("/b/b-zeezicht/polls");
  await page.getByRole("button", { name: "Nieuwe stemming" }).click();
  const dlg = page.getByRole("dialog", { name: "Nieuwe stemming" });
  await dlg.getByLabel("Onderwerp / agendapunt").fill("E2E: offerte gevelreiniging");
  await dlg.getByRole("button", { name: "Document koppelen" }).click();
  const picker = page.getByRole("dialog", { name: "Document koppelen" });
  await picker.getByRole("tab", { name: "Nieuw uploaden" }).click();
  await picker.locator('input[type="file"]').setInputFiles({ name: "e2e-offerte-gevel.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% e2e offerte\n") });
  await picker.getByRole("button", { name: "Uploaden en koppelen" }).click();
  await expect(dlg.getByText("e2e-offerte-gevel.pdf")).toBeVisible();
  await dlg.getByRole("button", { name: "Aanmaken" }).click();
  await expect(page.getByRole("heading", { name: /offerte gevelreiniging/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /e2e-offerte-gevel\.pdf/ })).toHaveAttribute("href", /\/documents\/.+\/download/);
  const url = page.url();
  await logout(page);
  await login(page, "marie@demo.be");
  await page.goto(url);
  await expect(page.getByRole("link", { name: /e2e-offerte-gevel\.pdf/ })).toBeVisible();
  // en de offerte staat ook gewoon onder Documenten
  await page.goto("/b/b-zeezicht/documents");
  await page.getByPlaceholder("Zoeken in alle documenten…").fill("e2e-offerte-gevel");
  await expect(page.getByText("e2e-offerte-gevel.pdf")).toBeVisible();
});
