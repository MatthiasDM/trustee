/** Versies van de juridische documenten. Een nieuwe versie vraagt elke gebruiker om opnieuw te aanvaarden; aanvaardingen worden gelogd. */
export const LEGAL_VERSIONS = { terms: "2026-10-14", privacy: "2026-10-14" } as const;
export type LegalDoc = keyof typeof LEGAL_VERSIONS;
/** Datum waarop het wettelijk kader (docs/wetgeving.md) het laatst op Justel geverifieerd werd. */
export const LAW_VERIFIED_ON = "2026-10-13";
/** Voettekst op elk gegenereerd document. */
export const PDF_DISCLAIMER = "Opgesteld met Trustee op basis van de door de syndicus ingevoerde gegevens. De syndicus controleert en ondertekent; dit document vervangt zijn verantwoordelijkheid niet.";
