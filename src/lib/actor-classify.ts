// Shared, dependency-light helpers for mapping between a nexus and a country.
// Used by the ingest (attribution), the dashboard (per-country cards), and the
// summary. Pure - safe on both server and client.
import type { Nexus } from "@/lib/badges";

/** Country name for each tracked nexus (null for rest_of_world / other). */
export const NEXUS_COUNTRY: Partial<Record<Nexus, string>> = {
  china: "China",
  russia: "Russia",
  north_korea: "North Korea",
  iran: "Iran",
};

/** Coarse nexus for a country - used for accent colours and grouping. */
export function nexusForCountry(country: string | null | undefined): Nexus {
  switch ((country ?? "").trim().toLowerCase()) {
    case "china":
      return "china";
    case "russia":
      return "russia";
    case "north korea":
      return "north_korea";
    case "iran":
      return "iran";
    default:
      return "rest_of_world";
  }
}
