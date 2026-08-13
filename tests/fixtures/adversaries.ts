import type { AdversaryGroupInput } from "@/lib/ingest/adversaries";

/**
 * A handful of real catalogue actors, as test data.
 *
 * The catalogue itself lives in the `adversaries` table and nowhere else - it
 * is edited through the app and is not seeded from the repository, so a name
 * removed there stays removed. Tests cannot read that table, so they need
 * their own actors; these are the ones the attribution tests actually assert
 * on, kept in the real shape and spanning every nexus and motivation.
 *
 * This is a fixture, not a catalogue. Adding an actor here gives the tests
 * something to match; it has no effect on the application.
 */
export const CATALOGUE_FIXTURE: AdversaryGroupInput[] = [
  {
    name: "FANCY BEAR",
    nexus: "russia",
    motivation: ["nation_state"],
    community_identifiers: ["APT28", "Forest Blizzard", "STRONTIUM", "Sednit", "Sofacy", "Pawn Storm", "Tsar Team", "Blue Athena", "TA422"],
    internal_alternative_names: [],
  },
  {
    name: "VANGUARD PANDA",
    nexus: "china",
    motivation: ["nation_state"],
    community_identifiers: ["Volt Typhoon", "BRONZE SILHOUETTE"],
    internal_alternative_names: [],
  },
  {
    name: "OPERATOR PANDA",
    nexus: "china",
    motivation: ["nation_state"],
    community_identifiers: ["Salt Typhoon", "GhostEmperor", "FamousSparrow", "UNC2286", "Earth Estries"],
    internal_alternative_names: [],
  },
  {
    name: "LABYRINTH CHOLLIMA",
    nexus: "north_korea",
    motivation: ["nation_state"],
    community_identifiers: ["Diamond Sleet", "ZINC", "Lazarus", "Lazarus Group", "Black Artemis", "Citrine Sleet", "Jade Sleet", "Moonstone Sleet"],
    internal_alternative_names: [],
  },
  {
    name: "RAZOR TIGER",
    nexus: "rest_of_world",
    motivation: ["nation_state"],
    community_identifiers: ["Sidewinder", "Rattlesnake", "APT-C-17", "APT-Q-39", "T-APT-04", "Baby Elephant", "Hardcore Nationalist"],
    internal_alternative_names: [],
  },
  {
    name: "BITWISE SPIDER",
    nexus: "other",
    motivation: ["ecrime"],
    community_identifiers: ["LockBit", "StealBIT"],
    internal_alternative_names: [],
  },
  {
    name: "ShinyHunters",
    nexus: "other",
    motivation: ["ecrime"],
    community_identifiers: ["ShinyHunters", "Shiny Hunters"],
    internal_alternative_names: [],
  },
  {
    name: "KillNet",
    nexus: "other",
    motivation: ["hacktivism"],
    community_identifiers: ["KillNet"],
    internal_alternative_names: [],
  },
];
