export interface Env {
  DB: D1Database;
  DOCS: R2Bucket;
  KV: KVNamespace;
  ASSETS: Fetcher;
  APP_NAME: string;
  APP_URL: string;
  VAPID_SUBJECT: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_WEBHOOK_SECRET?: string; // ondertekeningsgeheim (whsec_…) van de Resend-webhook voor bezorgstatus en bounces
  EMAIL_FROM: string;
  SESSION_SECRET?: string;
  TEST_MODE?: string; // "1" in de testomgeving: uitnodigingstokens in API-antwoord, geen e-mail
  DEMO_MODE?: string; // "1": iedereen kan een wegwerp-demogebouw starten en van gebruiker wisselen
  DEMO_ONLY?: string; // "1": publieke demo-instantie: enkel demo's, met limieten (zie lib/publicdemo.ts)
  EDGE_SECRET?: string; // gedeeld met deploy/edge: enkel de doorstuur-Worker bereikt de thuisserver
  ACCESS_TEAM_DOMAIN?: string; // <team>.cloudflareaccess.com; samen met ACCESS_AUD: API enkel bereikbaar met een geldig Cloudflare Access-token
  ACCESS_AUD?: string; // Application Audience (AUD) Tag van de Access-toepassing
  RL_READ?: RateLimit;
  RL_WRITE?: RateLimit;
}

export interface AuthUser { id: string; email: string; name: string; locale: string; is_superadmin: number; phone: string | null; demo_group?: string | null; /** 1 als tweestapsverificatie actief is */ totp?: number }
export interface BuildingCtx { id: string; org_id: string; name: string; total_shares: number; role: string; units: number; demo_group?: string | null; acting?: boolean; /** enkel voor rol volmachtdrager: de vergaderingen waarvoor hij een volmacht draagt */ holder_meetings?: string[]; dissolution_status?: string | null; liquidator_user_id?: string | null }

export type Vars = { user: AuthUser; building: BuildingCtx; sessionId: string };
export type AppEnv = { Bindings: Env; Variables: Vars };
