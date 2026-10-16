import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("syndicus rekent de verkoop van een kavel af: voorstel, boeking, nieuwe eigenaar uitgenodigd", async ({ page }) => {
  await login(page, "syndicus@demo.be");
  await page.goto("/b/b-zeezicht/members");
  await page.getByRole("tab", { name: /Kavels/ }).click();
  const row = page.getByRole("row", { name: /^A3/ });
  await row.getByRole("button", { name: "Verkoop" }).click();
  const dlg = page.getByRole("dialog", { name: "Verkoop afrekenen: kavel A3" });
  await dlg.getByLabel("Overdrachtsdatum").fill("2026-10-01");
  await expect(dlg.getByText(/Pro rata na overdracht \(92\/365 dagen\)/)).toBeVisible();
  await expect(dlg.getByText("Verkoper(s):")).toContainText("Ahmed El Idrissi");
  await dlg.getByLabel("E-mail koper").fill(`e2e-koper-${Date.now()}@t.be`);
  await dlg.getByLabel("Naam koper").fill("E2E Koper");
  const popup = page.waitForEvent("popup");
  await dlg.getByRole("button", { name: "Afrekening boeken en overdragen" }).click();
  await (await popup).close();
  await expect(page.getByText(/Kavel A3 overgedragen/)).toBeVisible();
  await expect(page.getByRole("row", { name: /^A3/ })).not.toContainText("Ahmed El Idrissi");
});
