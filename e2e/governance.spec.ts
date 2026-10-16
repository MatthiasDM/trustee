import { expect, test } from "@playwright/test";
import { login, logout } from "./helpers";

test("ondertekenaar roept na verstreken termijn zelf de AV bijeen en ziet beheerknoppen op die vergadering", async ({ page }) => {
  await login(page, "marie@demo.be");
  await page.goto("/b/b-zeezicht/meetings");
  await page.getByRole("button", { name: "Verzoek starten" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Onderwerp").fill("E2E: zelf bijeenroepen");
  await dlg.getByRole("button", { name: "Verzoek starten en ondertekenen" }).click();
  await expect(page.getByText("E2E: zelf bijeenroepen")).toBeVisible();
  await logout(page);
  await login(page, "jan@demo.be");
  await page.goto("/b/b-zeezicht/meetings");
  const card = page.locator("div.rounded-lg", { hasText: "E2E: zelf bijeenroepen" }).first();
  await card.getByRole("button", { name: "Mee ondertekenen" }).click();
  await expect(page.getByText(/Drempel bereikt/)).toBeVisible();
  const reqs = await page.request.get("/api/buildings/b-zeezicht/meeting-requests");
  const id = (await reqs.json()).find((r: any) => r.subject === "E2E: zelf bijeenroepen").id;
  await page.request.post(`/api/admin/age-request/${id}`);
  await logout(page);
  await login(page, "marie@demo.be");
  await page.goto("/b/b-zeezicht/meetings");
  const mine = page.locator("div.rounded-lg", { hasText: "E2E: zelf bijeenroepen" }).first();
  await expect(mine.getByText(/30 dagen/)).toBeVisible();
  await mine.getByRole("button", { name: "Zelf bijeenroepen" }).click();
  const form = page.getByRole("dialog", { name: "Vergadering plannen" });
  await expect(form.getByText(/Je roept deze vergadering zelf bijeen/)).toBeVisible();
  const d = new Date(Date.now() + 25 * 86400_000); d.setMinutes(0);
  await form.getByLabel("Datum & uur").fill(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  await form.getByRole("button", { name: "Opslaan" }).click();
  const meeting = page.locator("div.rounded-xl", { hasText: "E2E: zelf bijeenroepen" }).last(); // de laatste: de vergaderkaart, niet het verzoekenblok
  await expect(meeting.getByText("Bijeengeroepen door mede-eigenaars")).toBeVisible();
  await expect(meeting.getByRole("button", { name: "Oproepen", exact: true })).toBeVisible();
  await expect(meeting.getByRole("button", { name: /Notulen/ })).toBeVisible();
});

test("raad registreert een voorlopig syndicus met rechtsgrond; de houder ziet de syndicusrol", async ({ page }) => {
  await login(page, "jan@demo.be");
  await page.goto("/b/b-zeezicht/members?tab=mandates");
  await page.getByRole("button", { name: "Mandaat registreren" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("combobox").nth(0).click();
  await page.getByRole("option", { name: "Voorlopig syndicus" }).click();
  await expect(dlg.getByText(/rechten van de syndicus zolang het mandaat loopt/)).toBeVisible();
  await dlg.getByRole("combobox").nth(1).click();
  await page.getByRole("option", { name: /Ahmed El Idrissi/ }).click();
  await dlg.getByRole("combobox").nth(2).click();
  await page.getByRole("option", { name: /rechter/ }).click();
  await dlg.getByLabel("Einde").fill(new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10));
  await dlg.getByRole("button", { name: "Opslaan" }).click();
  await expect(page.getByText(/Voorlopig syndicus/).first()).toBeVisible();
  await logout(page);
  await login(page, "ahmed@demo.be");
  await page.goto("/b/b-zeezicht");
  await expect(page.getByText("voorlopig", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Instellingen" })).toBeVisible();
  // opruimen: mandaat verwijderen via API als syndicus-rechten
  const list = await (await page.request.get("/api/buildings/b-zeezicht/mandates")).json();
  for (const m of list.mandates.filter((x: any) => x.organ === "voorlopig_syndicus")) await page.request.delete(`/api/buildings/b-zeezicht/mandates/${m.id}`);
});
