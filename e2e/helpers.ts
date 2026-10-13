import { expect, type Page } from "@playwright/test";
export const PW = "wachtwoord123";
export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Wachtwoord").fill(PW);
  await page.getByRole("button", { name: "Aanmelden" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
export async function logout(page: Page) {
  await page.request.post("/api/auth/logout");
  await page.context().clearCookies();
}
