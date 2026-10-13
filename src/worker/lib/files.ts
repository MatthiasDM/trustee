import { HttpError } from "./util";

/** Toegelaten documenttypes; uitvoerbare bestanden en scripts worden geweigerd. */
const ALLOWED_EXT = new Set(["pdf", "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "tif", "tiff", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "csv", "txt", "md", "rtf", "zip", "eml", "msg", "ics", "cod", "coda", "xml", "json", "svg", "mp3", "m4a", "mp4", "mov"]);
const BLOCKED_EXT = new Set(["exe", "msi", "bat", "cmd", "com", "scr", "ps1", "sh", "js", "mjs", "jar", "apk", "dmg", "pkg", "app", "vbs", "wsf", "html", "htm", "php"]);
const MAX_SIZE = 50 * 1024 * 1024;

export function validateUpload(file: File) {
  if (file.size === 0) throw new HttpError(400, "Leeg bestand");
  if (file.size > MAX_SIZE) throw new HttpError(413, "Bestand te groot (max 50 MB)");
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (BLOCKED_EXT.has(ext)) throw new HttpError(415, `Bestandstype .${ext} is niet toegelaten`);
  if (!ALLOWED_EXT.has(ext)) throw new HttpError(415, `Bestandstype .${ext} wordt niet ondersteund`);
  if (/\.(exe|js|html?|php|sh)\./i.test(file.name)) throw new HttpError(415, "Dubbele extensie niet toegelaten");
  if (file.type && /javascript|x-msdownload|x-sh|html/i.test(file.type)) throw new HttpError(415, "Bestandstype niet toegelaten");
}

/** Veilige content-type voor weergave: onbekende types als download. */
export function safeContentType(mime: string, name: string): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const map: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8", md: "text/plain; charset=utf-8" };
  return map[ext] ?? (mime && !/html|javascript|xml/i.test(mime) ? mime : "application/octet-stream");
}
