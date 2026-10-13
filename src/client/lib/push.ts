import { api } from "./api";

export async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("/sw.js"); } catch (e) { console.warn("SW registratie mislukt", e); return null; }
}

export function pushSupported() { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }

export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function subscribePush(vapidPublicKey: string): Promise<boolean> {
  if (!pushSupported()) return false;
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
  await api.post("/api/notifications/push/subscribe", sub.toJSON());
  return true;
}

export async function unsubscribePush() {
  const sub = await getPushSubscription();
  if (!sub) return;
  await api.post("/api/notifications/push/unsubscribe", { endpoint: sub.endpoint });
  await sub.unsubscribe();
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
