import { createContext, useContext, useMemo, type ReactNode } from "react";

/**
 * Meertaligheid: de Nederlandse tekst is de sleutel. t("Documenten") geeft de vertaling in de taal van de gebruiker,
 * of de Nederlandse tekst zelf als er (nog) geen vertaling is. Vertalingen staan in src/client/lib/translations.ts.
 */
import { FR, EN } from "./translations";
import { setIntlLocale } from "./api";
export type Locale = "nl" | "fr" | "en";
export const LOCALES: { value: Locale; label: string }[] = [{ value: "nl", label: "Nederlands" }, { value: "fr", label: "Français" }, { value: "en", label: "English" }];
const DICT: Record<Locale, Record<string, string>> = { nl: {}, fr: FR, en: EN };

const Ctx = createContext<{ locale: Locale; t: (s: string) => string }>({ locale: "nl", t: (s) => s });

export function I18nProvider({ locale, children }: { locale: string | undefined; children: ReactNode }) {
  const loc: Locale = locale === "fr" || locale === "en" ? locale : "nl";
  const value = useMemo(() => { setIntlLocale(intlLocale(loc)); return { locale: loc, t: (s: string) => DICT[loc][s] ?? s }; }, [loc]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useT = () => useContext(Ctx).t;
export const useLocale = () => useContext(Ctx).locale;
/** Intl-locale voor datums en bedragen. */
export const intlLocale = (l: Locale) => ({ nl: "nl-BE", fr: "fr-BE", en: "en-GB" }[l]);
