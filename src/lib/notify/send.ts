import "server-only";

import { serverEnv } from "@/lib/env";

// Cloudflare Email Sending. Credentials come from the environment only - never
// commit a token, and rotate one that has been pasted anywhere.
const API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const SEND_TIMEOUT_MS = 15000;

export type Email = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type SendResult = { ok: true } | { ok: false; error: string };

/** Whether outbound mail is configured; the dispatcher checks before draining. */
export function emailConfigured(): boolean {
  return !!(serverEnv.emailAccountId && serverEnv.emailApiToken && serverEnv.emailFrom);
}

/**
 * Send one message. Returns the failure rather than throwing so the dispatcher
 * can record it against the queued rows and retry them on the next run.
 */
export async function sendEmail(email: Email): Promise<SendResult> {
  const accountId = serverEnv.emailAccountId;
  const token = serverEnv.emailApiToken;
  const from = serverEnv.emailFrom;
  if (!accountId || !token || !from) {
    return { ok: false, error: "Email sending is not configured." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/${accountId}/email/sending/send`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: email.to,
        from,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });
    if (!res.ok) {
      // Body first: Cloudflare puts the useful reason in errors[], and a bare
      // status tells an operator nothing about what to fix.
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        error: `HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Send failed.",
    };
  } finally {
    clearTimeout(timer);
  }
}
