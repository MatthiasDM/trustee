// Genereert een VAPID sleutelpaar (base64url) voor Web Push.
import { webcrypto as crypto } from "node:crypto";
const b64u = (buf) => Buffer.from(buf).toString("base64url");
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
const priv = await crypto.subtle.exportKey("jwk", kp.privateKey);
console.log("VAPID_PUBLIC_KEY=" + b64u(pub));
console.log("VAPID_PRIVATE_KEY=" + priv.d);
