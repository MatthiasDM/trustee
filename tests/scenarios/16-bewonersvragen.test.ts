import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { B, Client, as } from "./client";

/** Bewoners zonder stemrecht: datum meedelen en aanplakken, schriftelijke vragen worden aan de vergadering meegedeeld (art. 3.89 §5, 6°). */
describe("Vragen van bewoners zonder stemrecht", () => {
  let synd: Client, lotte: Client, marie: Client; let mid = "";
  beforeAll(async () => {
    [synd, lotte, marie] = await Promise.all(["syndicus", "lotte", "marie"].map(as));
    mid = (await synd.post(`/api/buildings/${B}/meetings`, { title: "AV bewonersvragen", type: "av", starts_at: new Date(Date.now() + 25 * 86400_000).toISOString() })).data.id;
  });
  afterAll(async () => { await synd.post(`/api/buildings/${B}/meetings/${mid}/cancel`, { reason: "Einde test bewonersvragen" }); });

  it("huurder dient een vraag in; mede-eigenaars niet; de vraag staat in de notulen", async () => {
    expect((await lotte.post(`/api/buildings/${B}/meetings/${mid}/questions`, { body: "Kan de verlichting in de kelder hersteld worden?" })).status).toBe(201);
    expect((await marie.post(`/api/buildings/${B}/meetings/${mid}/questions`, { body: "Mijn vraag als eigenaar" })).status).toBe(403);
    const list = (await marie.get(`/api/buildings/${B}/meetings/${mid}/questions`)).data; expect(list[0].author_name).toBe("Lotte De Smet");
    const prev = (await synd.get(`/api/buildings/${B}/meetings/${mid}/convene`)).data; expect(prev.warnings.join(" ")).toMatch(/3\.89 §5, 6°/);
    const n = await synd.post(`/api/buildings/${B}/meetings/${mid}/resident-notice`); expect(n.status).toBe(201);
    expect((await synd.get(`/api/buildings/${B}/meetings/${mid}/convene`)).data.warnings.join(" ")).not.toMatch(/3\.89 §5, 6°/);
    const min = await synd.post(`/api/buildings/${B}/meetings/${mid}/minutes/generate`);
    expect(min.data.body ?? JSON.stringify(min.data)).toMatch(/Vragen en opmerkingen van bewoners zonder stemrecht[\s\S]*verlichting in de kelder/);
  });
});
