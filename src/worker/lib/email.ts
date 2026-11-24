import type { Env } from "../env";
import { uid } from "./util";

/** Context van een e-mail die bij een gebouw hoort: wordt bewaard in email_log, zodat de bezorgstatus (meldingen van Cloudflare Email Service via de queue) per lid te volgen is. */
export interface EmailMeta { buildingId: string; userId?: string | null; kind: string }

export async function sendEmail(env: Env, to: string, subject: string, html: string, text?: string, meta?: EmailMeta) {
  const log = async (status: string, providerId: string | null, detail?: string) => {
    if (!meta) return;
    try {
      await env.DB.prepare("INSERT INTO email_log (id, building_id, user_id, to_email, subject, kind, provider_id, status, detail) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(uid(), meta.buildingId, meta.userId ?? null, to, subject.slice(0, 300), meta.kind, providerId, status, detail?.slice(0, 500) ?? null).run();
    } catch (e) { console.error("email_log failed", e); }
  };
  if (/@[^@]+\.invalid$/i.test(to)) { console.log(`[email:dev] to=${to} subject=${subject}`); return; } // demo-accounts hebben geen echt adres
  if (!env.EMAIL || env.TEST_MODE === "1") {
    console.log(`[email:dev] to=${to} subject=${subject}\n${text ?? html}`);
    // testomgeving: doen alsof het bericht verstuurd is, met een eigen id, zodat de bezorgmeldingen getest kunnen worden
    await log(env.TEST_MODE === "1" ? "sent" : "logged", env.TEST_MODE === "1" ? `test-${uid()}` : null);
    return;
  }
  try {
    const res = await env.EMAIL.send({ from: parseAddress(env.EMAIL_FROM), to, subject, html, ...(text ? { text } : {}) });
    await log("sent", res.messageId ?? null);
  } catch (e: any) {
    const detail = `${e?.code ?? "error"} ${e?.message ?? e}`;
    console.error("email failed", detail); await log("failed", null, detail);
  }
}

/** "Naam <adres>" of "adres" naar het formaat van de binding. */
export function parseAddress(from: string): string | { email: string; name: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m && m[1] ? { name: m[1].replace(/^"|"$/g, ""), email: m[2].trim() } : (m ? m[2].trim() : from.trim());
}

export function layout(env: Env, title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f5f7;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
    <div style="font-weight:700;font-size:18px;color:#0f172a;margin-bottom:16px">${env.APP_NAME}</div>
    <h2 style="margin:0 0 12px;font-size:20px;color:#0f172a">${title}</h2>
    <div style="color:#334155;line-height:1.55">${bodyHtml}</div>
    ${cta ? `<p style="margin-top:24px"><a href="${cta.url}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${cta.label}</a></p>` : ""}
    <p style="margin-top:28px;font-size:12px;color:#94a3b8">Je ontvangt deze e-mail omdat je lid bent van een VME op ${env.APP_NAME}.</p>
  </div></body></html>`;
}
