"use client";

import { Suspense, useActionState, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  completeFragmentSignIn,
  signInWithMagicLink,
  signInWithPassword,
} from "./actions";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage, parseAuthFragment } from "@/lib/auth-fragment";

type ActionResult = { error?: string; message?: string };
const initial: ActionResult = {};



export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const urlError = params.get("error");
  const [mode, setMode] = useState<"magic" | "password">("magic");
  const fragment = useFragmentSignIn();

  const [magicState, magicAction, magicPending] = useActionState(
    signInWithMagicLink,
    initial,
  );
  const [pwState, pwAction, pwPending] = useActionState(
    signInWithPassword,
    initial,
  );

  const state = mode === "magic" ? magicState : pwState;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f3f6fb] px-4">
      <div className="w-full max-w-sm rounded-[10px] border border-[#e5e7eb] bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#2855D9] shadow-sm">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M8 20.5 V3.5 H13 a5 5 0 0 1 0 10 H8"
                stroke="#ffffff"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="12.5" cy="8.5" r="1.8" fill="#ffffff" />
            </svg>
          </span>
          <div>
            <h1 className="text-[18px] font-bold lowercase leading-none tracking-tight text-[#2855D9]">
              palantish
            </h1>
            <p className="mt-0.5 text-[11px] uppercase tracking-wide text-slate-400">
              Open Source Intelligence Portal
            </p>
          </div>
        </div>
        <p className="mt-3 text-[12px] text-slate-500">
          Restricted access. Sign in with your authorised account.
        </p>

        <div className="mt-4 flex gap-1 rounded-md bg-slate-100 p-1 text-[12px]">
          <button
            type="button"
            onClick={() => setMode("magic")}
            className={`flex-1 rounded px-2 py-1 font-medium transition ${
              mode === "magic"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            Magic link
          </button>
          <button
            type="button"
            onClick={() => setMode("password")}
            className={`flex-1 rounded px-2 py-1 font-medium transition ${
              mode === "password"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500"
            }`}
          >
            Password
          </button>
        </div>

        {mode === "magic" ? (
          <form action={magicAction} className="mt-4 space-y-3">
            <Field
              label="Email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
            />
            <SubmitButton pending={magicPending}>
              Send magic link
            </SubmitButton>
          </form>
        ) : (
          <form action={pwAction} className="mt-4 space-y-3">
            <Field
              label="Email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
            />
            <Field
              label="Password"
              name="password"
              type="password"
              placeholder="Your password"
              autoComplete="current-password"
            />
            <SubmitButton pending={pwPending}>Sign in</SubmitButton>
          </form>
        )}

        {fragment.status === "working" ? (
          <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
            Signing you in...
          </p>
        ) : null}
        {fragment.status === "error" ? (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {fragment.error}
          </p>
        ) : null}
        {state.message ? (
          <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
            {state.message}
          </p>
        ) : null}
        {(state.error || urlError) &&
        !state.message &&
        fragment.status === "none" ? (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {state.error ?? authErrorMessage(urlError)}
          </p>
        ) : null}
      </div>
    </main>
  );
}

type FragmentState =
  | { status: "none" }
  | { status: "working" }
  | { status: "error"; error: string };

/**
 * Complete a sign-in whose session came back in the URL fragment.
 *
 * Nothing on the server can see a fragment, so a link that returns one - an
 * invitation sent from the Supabase dashboard, a recovery link, any link using
 * the default email template - lands here as an anonymous visitor with the
 * session sitting unread in the address bar. Reading it is the browser's job
 * and only the browser's.
 *
 * The tokens are removed from the address bar before anything else happens:
 * they are credentials, they would otherwise sit in history and in whatever
 * gets pasted into a bug report, and a reload would retry a token that has
 * already been spent.
 */
function useFragmentSignIn(): FragmentState {
  const [state, setState] = useState<FragmentState>({ status: "none" });

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const parsed = parseAuthFragment(window.location.hash);
    if (!parsed) return;
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    if (parsed.kind === "error") {
      setState({ status: "error", error: parsed.message });
      return;
    }

    setState({ status: "working" });
    let active = true;
    const client = createClient();
    client.auth
      .setSession({
        access_token: parsed.accessToken,
        refresh_token: parsed.refreshToken,
      })
      .then(async ({ error }) => {
        if (error) throw new Error(error.message);
        const res = await completeFragmentSignIn(parsed.type);
        if (!res.ok) {
          await client.auth.signOut();
          if (active) setState({ status: "error", error: res.error });
          return;
        }
        // A full load rather than a client navigation: the session lives in
        // cookies now, and every page here is rendered on the server.
        window.location.assign(res.next);
      })
      .catch(async (err: unknown) => {
        // Whatever went wrong, do not leave a half-established session behind:
        // the account has not been checked against the allow-list, and a
        // reload would carry it into an application it may not be allowed to
        // read - which looks like an empty dashboard and no explanation.
        await client.auth.signOut().catch(() => {});
        if (active)
          setState({
            status: "error",
            error:
              err instanceof Error
                ? err.message
                : "That sign-in link did not work.",
          });
      });
    return () => {
      active = false;
    };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  return state;
}

function Field(props: {
  label: string;
  name: string;
  type: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-slate-600">
        {props.label}
      </span>
      <input
        name={props.name}
        type={props.type}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        required
        className="w-full rounded-md border border-[#e5e7eb] bg-white px-3 py-2 text-[13px] text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
      />
    </label>
  );
}

function SubmitButton({
  pending,
  children,
}: {
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-slate-900 px-3 py-2 text-[13px] font-medium text-white transition hover:bg-slate-700 disabled:opacity-60"
    >
      {pending ? "Working..." : children}
    </button>
  );
}
