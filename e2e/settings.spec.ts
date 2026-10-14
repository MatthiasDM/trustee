import { expect, test } from "@playwright/test";
import { login, logout } from "./helpers";

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

test("tweestapsverificatie inschakelen toont QR en herstelcodes; aanmelden vraagt daarna een code", async ({ page }) => {
  await login(page, "lotte@demo.be");
  await page.goto("/b/b-zeezicht/settings");
  await page.getByRole("button", { name: "Inschakelen" }).click();
  const dlg = page.getByRole("dialog", { name: "Tweestapsverificatie inschakelen" });
  await expect(dlg.getByRole("img", { name: "QR-code voor authenticator" })).toBeVisible();
  const secret = (await dlg.locator("code").textContent())!.trim();
  const { totpCode } = await import("../src/worker/lib/totp");
  await dlg.getByLabel("Code uit de app").fill(await totpCode(secret));
  await dlg.getByRole("button", { name: "Bevestigen" }).click();
  const rc = page.getByRole("dialog", { name: "Herstelcodes" });
  await expect(rc).toBeVisible();
  await rc.getByRole("button", { name: "Ik heb ze bewaard" }).click();
  await expect(page.getByText(/Tweestapsverificatie is/)).toContainText("actief");
  await logout(page);
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("lotte@demo.be");
  await page.getByLabel("Wachtwoord").fill("wachtwoord123");
  await page.getByRole("button", { name: "Aanmelden" }).click();
  await expect(page.getByText("Tweede stap", { exact: true })).toBeVisible();
  await page.getByLabel("Code").fill(await totpCode(secret));
  await page.getByRole("button", { name: "Bevestigen" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  // opruimen zodat andere tests met lotte gewoon kunnen aanmelden
  await page.request.post("/api/auth/totp/disable", { data: { password: "wachtwoord123", code: await totpCode(secret) } });
});
