// Choosing what the daily indicator review looks at, and reading back what the
// model says about it. Pure: no database, no network, so the selection rules and
// the parsing are unit-tested directly.

export type ReviewCandidate = {
  iocId: string;
  value: string;
  iocType: string;
  /** How many reports reference it - the reason it is worth reviewing. */
  reports: number;
};

/** What the model decided about one candidate. */
export type ReviewVerdict = {
  value: string;
  /** true when the model thinks this is not attacker infrastructure. */
  suspect: boolean;
  /** Short machine-ish category, e.g. "vendor-advisory", "version-number". */
  category: string;
  /** One line an administrator can act on without rereading the report. */
  reason: string;
};

/**
 * Only indicators that actually join reports together are worth a model call:
 * a value seen once cannot create a false relationship, and there are thousands
 * of them. CVEs and ATT&CK techniques are excluded outright - reports sharing a
 * CVE is the system working, not a fault - which also keeps the prompt small.
 */
export const REVIEWABLE_TYPES = ["ip", "domain", "file_hash"];

/** Reviewed per run. Enough to cover the connected part of a day's graph while
 * keeping one cheap call, and the highest fan-out is where the damage is. */
export const REVIEW_BATCH = 80;

export function selectCandidates(
  rows: ReviewCandidate[],
  { limit = REVIEW_BATCH, minReports = 2 } = {},
): ReviewCandidate[] {
  return rows
    .filter(
      (r) => REVIEWABLE_TYPES.includes(r.iocType) && r.reports >= minReports,
    )
    // Most-connected first: one bad indicator in twenty reports does more damage
    // than twenty in two, and the batch limit should spend itself there.
    .sort((a, b) => b.reports - a.reports || a.value.localeCompare(b.value))
    .slice(0, limit);
}

/**
 * Hosts the review may never flag, whatever the model says.
 *
 * Every one is routinely abused to deliver malware, tunnel C2 or receive stolen
 * data, so an indicator on them is usually real. The prompt says so, and a
 * second run flagged github.com, workers.dev and google.com anyway - which is
 * the whole argument for enforcing it here rather than asking nicely.
 *
 * The stakes are asymmetric: accepting such a flag deletes the indicator AND
 * allowlists the host, and because the allowlist matches suffixes, blessing
 * google.com would also silence drive.google.com. A parent is therefore listed
 * whenever any child of it is a delivery channel.
 */
export const NEVER_FLAG = [
  // Code and paste hosting: routine payload delivery.
  "github.com", "githubusercontent.com", "gitlab.com", "bitbucket.org",
  "pastebin.com", "paste.ee", "ghostbin.com", "hastebin.com", "rentry.co",
  // Free app, page and tunnel hosting: routine phishing and C2.
  "workers.dev", "pages.dev", "trycloudflare.com", "herokuapp.com",
  "vercel.app", "netlify.app", "ngrok.io", "ngrok-free.app", "glitch.me",
  "replit.dev", "onrender.com", "web.app", "firebaseapp.com",
  // Messaging: C2 channels and exfiltration endpoints.
  "discord.com", "discordapp.com", "t.me", "telegram.org", "telesco.pe",
  // File sharing: payload staging.
  "dropbox.com", "google.com", "onedrive.live.com", "1drv.ms", "mega.nz",
  "mediafire.com", "transfer.sh", "file.io", "anonfiles.com", "gofile.io",
  // Link shorteners: phishing redirection.
  "bit.ly", "tinyurl.com", "is.gd", "rebrand.ly", "cutt.ly", "shorturl.at",
  // Mail providers: an actor-controlled mailbox is an indicator.
  "gmail.com", "outlook.com", "office.com", "mail.ru", "yandex.ru",
  "proton.me", "protonmail.com", "tutanota.com", "zoho.com",
];

/**
 * Whether this value is one the review must never raise.
 *
 * The value used to be turned into a host first, because a uri indicator meant
 * comparing the allowlist against the URL's hostname. URLs are not indicators
 * any more, so every remaining type is already the thing being compared.
 */
export function isNeverFlagged(value: string): boolean {
  const host = value.trim().toLowerCase();
  if (!host) return false;
  return NEVER_FLAG.some((n) => host === n || host.endsWith(`.${n}`));
}

export const REVIEW_SYSTEM_PROMPT = `You review indicators of compromise (IOCs) held by a threat-intelligence system.

Each indicator below was extracted from published security reporting and now links two or more reports together in a link-analysis graph. Some are genuine attacker infrastructure. Others are extraction mistakes or publisher noise, and those create false relationships between unrelated reports.

Flag an indicator as a problem when it is plainly NOT attacker infrastructure. Common cases:
- a vendor or CERT advisory page (support.apple.com/..., oracle.com/security-alerts/...)
- a publisher's own site furniture: share links, social profiles, podcasts, newsletters
- a software version number misread as an IP address (7.0.9.1, 20.15.5.2)
- a product, framework or protocol name misread as a domain (asp.net, tcp.ip)
- a filename or code identifier misread as a domain
- a general-purpose CDN, documentation or package-registry host with nothing specific to an intrusion

Do NOT flag:
- hosts, IPs, URLs or hashes that plausibly belong to an intrusion, however ordinary they look
- anything you are unsure about
- NEVER flag a mainstream platform that attackers routinely abuse, even though it is legitimate and even though it looks like noise. This includes code and paste hosting (github.com, gitlab.com, pastebin.com), free app and tunnel hosting (workers.dev, pages.dev, ngrok.io, vercel.app, herokuapp.com), messaging (discord.com, t.me), file sharing (dropbox.com, google.com, mega.nz), link shorteners (bit.ly, tinyurl.com) and mail providers (gmail.com, outlook.com, mail.ru). An indicator on one of these is usually real, and suppressing the host would hide every future indicator on it.

Being wrong in the direction of keeping an indicator is cheap; being wrong in the direction of deleting one loses evidence. When in doubt, do not flag.

Reply with JSON only: {"flagged":[{"value":"<exact value>","category":"<short-kebab-case>","reason":"<one sentence>"}]}
Include only the problems. If none, reply {"flagged":[]}.`;

/** The candidate list as the model sees it. */
export function buildReviewPrompt(candidates: ReviewCandidate[]): string {
  const lines = candidates.map(
    (c) => `- [${c.iocType}] ${c.value}  (in ${c.reports} reports)`,
  );
  return `Review these ${candidates.length} indicators:\n\n${lines.join("\n")}`;
}

/**
 * Read the model's reply.
 *
 * Tolerant of prose or code fences around the JSON, because a cheap model will
 * sometimes add them, and strict about the contents: a flag naming a value that
 * was not in the batch is dropped rather than stored against nothing. Returns
 * an empty list rather than throwing - a malformed reply should cost one run's
 * findings, not the ingest that called it.
 */
export function parseReviewResponse(
  text: string,
  candidates: ReviewCandidate[],
): ReviewVerdict[] {
  const byValue = new Map(candidates.map((c) => [c.value.toLowerCase(), c]));
  const json = extractJsonObject(text);
  if (!json) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const flagged = (parsed as { flagged?: unknown })?.flagged;
  if (!Array.isArray(flagged)) return [];

  const out: ReviewVerdict[] = [];
  const seen = new Set<string>();
  for (const raw of flagged) {
    const r = raw as { value?: unknown; category?: unknown; reason?: unknown };
    const value = typeof r.value === "string" ? r.value.trim() : "";
    if (!value) continue;
    const match = byValue.get(value.toLowerCase());
    // A value the model invented, or one from an earlier batch, has nothing to
    // act on - storing it would put an undeletable row in front of an admin.
    if (!match || seen.has(match.iocId)) continue;
    // The guardrail, not a suggestion: never offer an administrator the chance
    // to delete and allowlist a platform whose abuse is routine.
    if (isNeverFlagged(match.value)) continue;
    seen.add(match.iocId);
    out.push({
      value: match.value,
      suspect: true,
      category:
        typeof r.category === "string" && r.category.trim()
          ? r.category.trim().slice(0, 40)
          : "unclassified",
      reason:
        typeof r.reason === "string" && r.reason.trim()
          ? r.reason.trim().slice(0, 300)
          : "Flagged without a stated reason.",
    });
  }
  return out;
}

/** The first balanced {...} in the text, ignoring fences and commentary. */
function extractJsonObject(text: string): string | null {
  const s = text ?? "";
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
