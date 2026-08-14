-- ============================================================================
-- Keep the body of a report that was pasted in by hand.
-- ----------------------------------------------------------------------------
-- Every report's reading view is fetched from its URL on demand, which is right
-- for the reports that arrive from feeds - the article is on the web and the
-- fetch is how it stays current. But the paste import exists precisely for the
-- pages that cannot be fetched: the analyst pastes the article because nothing
-- else could read it. That text then had nowhere to live. It was flattened to a
-- single line, cut at 2000 characters and stored as the summary, and the report
-- itself opened on the same fetch error that sent the analyst to the paste box.
--
-- So the pasted article is kept here, as Markdown, and the reading view prefers
-- it over fetching. Markdown rather than HTML because that is what the report
-- renderer already reads, and because it is text: no markup is ever handed to
-- the browser, images resolve through the same http(s)-only path as any other
-- report image, and the find-in-report search works on it unchanged.
--
-- Null for every report that came from a feed, which is nearly all of them.
-- ============================================================================

alter table public.intel_items
  add column if not exists body_markdown text;

comment on column public.intel_items.body_markdown is
  'The article body as Markdown, for reports whose page cannot be fetched (the paste import). Null when the reading view should fetch the URL instead.';
