import { expect, test } from "@playwright/test";
import { login, logout } from "./helpers";

/** Volmacht aan een derde (art. 3.87 §7 BW): tijdelijk account, enkel toegang tot de vergadering waarvoor hij de volmacht draagt. */
test("mede-eigenaar geeft een volmacht aan een derde met e-mailadres; die ziet enkel zijn vergadering en meldt zich vanop afstand aan", async ({ page }) => {
  const stamp = Date.now().toString(36); const title = `E2E AV volmacht ${stamp}`; const email = `e2e.derde.${stamp}@example.com`; const password = "e2e-volmacht-wachtwoord";
  await login(page, "syndicus@demo.be");
  const created = await page.request.post("/api/buildings/b-zeezicht/meetings", { data: { title, type: "av", starts_at: new Date(Date.now() + 50 * 86400_000).toISOString(), remote_allowed: true, remote_url: "https://video.example/e2e" } });
  expect(created.status()).toBe(201);
  await logout(page);

  await login(page, "marie@demo.be");
  await page.goto("/b/b-zeezicht/meetings");
  const card = page.locator("div.rounded-xl").filter({ hasText: title });
  await card.getByRole("button", { name: "Volmacht", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("combobox").click();
  await page.getByRole("option", { name: /Iemand anders/ }).click();
  await dlg.getByLabel("Naam van de volmachtdrager").fill(`Derde ${stamp}`);
  await dlg.getByLabel(/E-mailadres/).fill(email);
  const [res] = await Promise.all([page.waitForResponse((r) => r.url().includes("/rsvp") && r.request().method() === "PUT"), dlg.getByRole("button", { name: "Volmacht geven" }).click()]);
  const body = await res.json(); expect(body.invited).toBe(true);
  await expect(page.getByText(/kreeg een uitnodiging per e-mail/)).toBeVisible();
  await logout(page);

  // de derde kiest een wachtwoord via de link uit de uitnodiging (de testomgeving geeft het token terug) en meldt zich aan
  expect((await page.request.post("/api/auth/reset-password", { data: { token: body.invite_token, password } })).status()).toBe(200);
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email); await page.getByLabel("Wachtwoord").fill(password);
  await page.getByRole("button", { name: "Aanmelden" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const consent = page.getByRole("button", { name: "Aanvaarden en verdergaan" });
  if (await consent.isVisible().catch(() => false)) { await page.getByRole("dialog").getByRole("checkbox").click(); await consent.click(); }
  await page.goto("/b/b-zeezicht");
  await expect(page).toHaveURL(/\/b\/b-zeezicht\/meetings/); // geen overzicht: rechtstreeks naar de vergadering
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.locator("h3")).toHaveCount(1); // geen andere vergaderingen
  await expect(page.getByRole("link", { name: "Algemene vergadering" })).toBeVisible();
  for (const hidden of ["Boekhouding", "Documenten", "Mede-eigenaars & organen", "Stemmingen"]) await expect(page.getByRole("link", { name: hidden })).toHaveCount(0);
  await expect(page.getByText("Je draagt 1 volmacht")).toBeVisible();
  await page.getByRole("button", { name: "Vanop afstand" }).click();
  await expect(page.getByText("Aanwezigheid opgeslagen")).toBeVisible();
  await expect(page.getByRole("link", { name: "Videovergadering openen" })).toHaveAttribute("href", "https://video.example/e2e");
  await expect(page.getByText(/Je stemt voor kavel .*\(volmacht\)/)).toBeVisible();
  // rechtstreeks naar een ander scherm: de API weigert, er lekt niets
  expect((await page.request.get("/api/buildings/b-zeezicht/documents")).status()).toBe(403);
  expect((await page.request.get("/api/buildings/b-zeezicht/members")).status()).toBe(403);
});
