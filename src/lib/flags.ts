// Country name -> ISO 3166-1 alpha-2 code (ASCII only). Flag emoji are derived
// from the code at runtime via regional-indicator code points, so no non-ASCII
// glyphs live in source (keeps the ascii-check happy).
const COUNTRY_CODE: Record<string, string> = {
  china: "CN",
  russia: "RU",
  "north korea": "KP",
  "south korea": "KR",
  iran: "IR",
  india: "IN",
  turkey: "TR",
  turkiye: "TR",
  vietnam: "VN",
  pakistan: "PK",
  taiwan: "TW",
  japan: "JP",
  "hong kong": "HK",
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  "united kingdom": "GB",
  uk: "GB",
  israel: "IL",
  ukraine: "UA",
  belarus: "BY",
  kazakhstan: "KZ",
  syria: "SY",
  lebanon: "LB",
  "saudi arabia": "SA",
  "united arab emirates": "AE",
  uae: "AE",
  germany: "DE",
  france: "FR",
  brazil: "BR",
  "south africa": "ZA",
  nigeria: "NG",
  egypt: "EG",
};

/**
 * The flag emoji for a country name, or null if unknown. Built from the ISO
 * code so the source stays ASCII.
 */
export function countryFlag(country: string | null | undefined): string | null {
  if (!country) return null;
  const code = COUNTRY_CODE[country.trim().toLowerCase()];
  if (!code) return null;
  return code
    .toUpperCase()
    .replace(/[A-Z]/g, (c) =>
      String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65),
    );
}
