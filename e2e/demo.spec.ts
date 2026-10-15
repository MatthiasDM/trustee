import { expect, test } from "@playwright/test";

test("demo: gebouw starten, van gebruiker wisselen, rechten verschillen per rol", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Probeer de demo zonder account" }).click();
  await expect(page).toHaveURL(/\/demo/);
  await page.getByLabel("Naam van je demogebouw").fill("E2E Demo Residentie");
  await page.getByRole("button", { name: "Start de demo" }).click();
  await expect(page).toHaveURL(/\/b\/b-zeezicht-d/);
  const bar = page.getByRole("region", { name: "Demo" });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("button", { name: /Sofie Vermeulen/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Algemene vergadering" }).click();
  await expect(page.getByRole("button", { name: "Punt agenderen" })).toBeVisible();
  await bar.getByRole("button", { name: /Marie Claes/ }).click();
  await expect(page.getByText(/Je bent nu Marie Claes/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Agendapunt indienen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Punt agenderen" })).toHaveCount(0);
  await bar.getByRole("button", { name: /Lotte De Smet/ }).click();
  await expect(page.getByText(/Je bent nu Lotte De Smet/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Agendapunt indienen" })).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await bar.getByRole("button", { name: "Beëindigen" }).click();
  await expect(page).toHaveURL(/\/demo/);
});
