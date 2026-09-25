interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    throw err;
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * US Government Contracts MCP — awarded state & local government contracts,
 * normalized across jurisdictions, keyless.
 *
 * Every US state/local bid portal is login-walled or scrape-only (no live-bid
 * API exists anywhere), but the AWARDED-contract side is published as open
 * data — overwhelmingly on Socrata (SODA) and CKAN. This pack fronts those
 * feeds behind ONE normalized shape so an agent can query "contracts awarded to
 * <vendor>" or "<agency> contracts" without learning each portal's schema.
 *
 * Config-driven: each jurisdiction is an entry in JURISDICTIONS with its
 * platform (socrata|ckan), endpoint, and a field map onto the normalized
 * contract shape. Adding a jurisdiction is a config edit, not new code — the
 * roadmap (docs/us-procurement-landscape.md) tracks which to add next as each
 * endpoint is field-verified. Seed = the verified-clean contract-level sources.
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'US Government Contracts');
}

const UA = 'pipeworx.io admin@pipeworx.io';

// Normalized contract fields the tools emit. Each jurisdiction maps its own
// columns onto these; unmapped fields come back null.
interface FieldMap {
  contract_id?: string;
  vendor: string;
  title?: string;
  agency?: string;
  amount?: string; // column holding a dollar amount (contract value / NTE / spend)
  start_date?: string;
  end_date?: string;
  method?: string;
  category?: string; // spend datasets: commodity/expense category
  year?: string; // spend datasets: fiscal year
}

interface Jurisdiction {
  key: string; // stable id used in the API, e.g. "tx", "wa", "king-county-wa"
  name: string;
  level: 'state' | 'county' | 'city';
  platform: 'socrata' | 'ckan';
  base: string; // resource URL (socrata) or CKAN action base
  resource: string; // socrata: unused (in base); ckan: datastore resource_id
  fields: FieldMap;
  // Columns to match a free-text `keyword` against (title/description/item).
  searchCols: string[];
  source_url: string; // human-facing dataset page
}

// ── Jurisdiction registry (grows by config as endpoints are field-verified) ──
const JURISDICTIONS: Jurisdiction[] = [
  {
    key: 'tx',
    name: 'Texas (statewide)',
    level: 'state',
    platform: 'socrata',
    base: 'https://data.texas.gov/resource/svjm-sdfz.json',
    resource: 'svjm-sdfz',
    fields: {
      contract_id: 'po_contract_number',
      vendor: 'vendor_name_description',
      title: 'project_name',
      amount: 'total_amount',
      start_date: 'start_date',
      end_date: 'end_date',
    },
    searchCols: ['project_name', 'vendor_name_description'],
    source_url: 'https://data.texas.gov/dataset/svjm-sdfz',
  },
  {
    key: 'wa',
    name: 'Washington (statewide)',
    level: 'state',
    platform: 'socrata',
    base: 'https://data.wa.gov/resource/n8q6-4twj.json',
    resource: 'n8q6-4twj',
    fields: {
      contract_id: 'contract_number',
      vendor: 'vendor_name',
      title: 'contract_title',
      agency: 'customer_name',
    },
    searchCols: ['contract_title', 'vendor_name'],
    source_url: 'https://data.wa.gov/d/n8q6-4twj',
  },
  {
    key: 'king-county-wa',
    name: 'King County, WA',
    level: 'county',
    platform: 'socrata',
    base: 'https://data.kingcounty.gov/resource/dqit-zt74.json',
    resource: 'dqit-zt74',
    fields: {
      contract_id: 'contract',
      vendor: 'vendor_supplier_name',
      title: 'description',
      agency: 'agency',
      amount: 'not_to_exceed',
      start_date: 'start_date',
      end_date: 'expires',
      method: 'procurement_method',
    },
    searchCols: ['description', 'vendor_supplier_name'],
    source_url: 'https://data.kingcounty.gov/d/dqit-zt74',
  },
  {
    key: 'nyc',
    name: 'New York City',
    level: 'city',
    platform: 'socrata',
    base: 'https://data.cityofnewyork.us/resource/qyyg-4tf5.json',
    resource: 'qyyg-4tf5',
    fields: {
      contract_id: 'pin',
      vendor: 'vendor_name',
      title: 'short_title',
      agency: 'agency_name',
      amount: 'contract_amount',
      start_date: 'start_date',
      end_date: 'end_date',
      method: 'selection_method_description',
    },
    searchCols: ['short_title', 'vendor_name'],
    source_url: 'https://data.cityofnewyork.us/d/qyyg-4tf5',
  },
  {
    key: 'chicago',
    name: 'Chicago',
    level: 'city',
    platform: 'socrata',
    base: 'https://data.cityofchicago.org/resource/rsxa-ify5.json',
    resource: 'rsxa-ify5',
    fields: {
      contract_id: 'purchase_order_contract_number',
      vendor: 'vendor_name',
      title: 'purchase_order_description',
      agency: 'department',
      amount: 'award_amount',
      start_date: 'start_date',
      end_date: 'end_date',
      method: 'procurement_type',
    },
    searchCols: ['purchase_order_description', 'vendor_name'],
    source_url: 'https://data.cityofchicago.org/d/rsxa-ify5',
  },
  {
    key: 'cook-county-il',
    name: 'Cook County, IL',
    level: 'county',
    platform: 'socrata',
    base: 'https://datacatalog.cookcountyil.gov/resource/qh8j-6k63.json',
    resource: 'qh8j-6k63',
    fields: {
      contract_id: 'contract_number',
      vendor: 'vendor_name',
      title: 'description',
      agency: 'lead_department',
      amount: 'amount',
      start_date: 'start_date',
      end_date: 'end_date',
      method: 'category',
    },
    searchCols: ['description', 'vendor_name'],
    source_url: 'https://datacatalog.cookcountyil.gov/d/qh8j-6k63',
  },
  {
    key: 'austin',
    name: 'Austin, TX',
    level: 'city',
    platform: 'socrata',
    base: 'https://data.austintexas.gov/resource/84ih-p28j.json',
    resource: '84ih-p28j',
    fields: {
      contract_id: 'doc_id',
      vendor: 'lgl_nm',
      title: 'doc_dscr',
      agency: 'doc_dept_cd',
      amount: 'ma_prch_lmt_am',
      start_date: 'efbgn_dt',
      method: 'cat_dscr',
    },
    searchCols: ['doc_dscr', 'lgl_nm'],
    source_url: 'https://data.austintexas.gov/d/84ih-p28j',
  },
  {
    key: 'va',
    name: 'Virginia (eVA statewide)',
    level: 'state',
    platform: 'ckan',
    base: 'https://data.virginia.gov/api/3/action',
    resource: '3c7f1bde-35b0-4fbf-b89c-978a19124d53',
    fields: {
      contract_id: 'Order #',
      vendor: 'Vendor Name',
      title: 'Item Description',
      agency: 'Entity Description',
      amount: 'Line Total',
      method: 'NIGP Description',
    },
    searchCols: ['Item Description', 'Vendor Name'],
    source_url: 'https://data.virginia.gov/dataset/eva-procurement-data-2023',
  },
];

const BY_KEY = new Map(JURISDICTIONS.map((j) => [j.key, j]));

// ── Spend / vendor-payment registry (SEPARATE from awarded contracts) ────────
// State "checkbook" data: what an agency actually PAID a vendor, by category and
// fiscal year — distinct from an awarded contract's value. Same Socrata client,
// different shape/tool so the two aren't conflated.
const SPEND_JURISDICTIONS: Jurisdiction[] = [
  {
    key: 'nj', name: 'New Jersey (statewide)', level: 'state', platform: 'socrata',
    base: 'https://data.nj.gov/resource/ubnu-tqu7.json', resource: 'ubnu-tqu7',
    fields: { vendor: 'vendor_name', agency: 'department_agency_desc', amount: 'ytd_amt', category: 'commodity_sector_desc', year: 'fiscal_year' },
    searchCols: ['vendor_name'], source_url: 'https://data.nj.gov/d/ubnu-tqu7',
  },
  {
    key: 'vt', name: 'Vermont (statewide)', level: 'state', platform: 'socrata',
    base: 'https://data.vermont.gov/resource/y2u8-8ruq.json', resource: 'y2u8-8ruq',
    fields: { vendor: 'vendor', agency: 'govtunit', amount: 'amt', category: 'description', year: 'qtrending' },
    searchCols: ['vendor', 'description'], source_url: 'https://data.vermont.gov/d/y2u8-8ruq',
  },
  {
    key: 'or', name: 'Oregon (statewide)', level: 'state', platform: 'socrata',
    base: 'https://data.oregon.gov/resource/y9g9-xsxs.json', resource: 'y9g9-xsxs',
    fields: { vendor: 'vendor', agency: 'agency', amount: 'expense', category: 'expend_class', year: 'fiscal_year' },
    searchCols: ['vendor'], source_url: 'https://data.oregon.gov/d/y9g9-xsxs',
  },
  {
    key: 'md', name: 'Maryland (statewide)', level: 'state', platform: 'socrata',
    base: 'https://opendata.maryland.gov/resource/7syw-q4cy.json', resource: '7syw-q4cy',
    fields: { vendor: 'vendor_name', agency: 'agency_name', amount: 'amount', category: 'category', year: 'fiscal_year' },
    searchCols: ['vendor_name'], source_url: 'https://opendata.maryland.gov/d/7syw-q4cy',
  },
  {
    key: 'mo', name: 'Missouri (statewide)', level: 'state', platform: 'socrata',
    base: 'https://data.mo.gov/resource/gndj-tfr3.json', resource: 'gndj-tfr3',
    fields: { vendor: 'vendor_name', agency: 'agency_name', amount: 'payments_total', category: 'category_description', year: 'fiscal_year' },
    searchCols: ['vendor_name'], source_url: 'https://data.mo.gov/d/gndj-tfr3',
  },
  {
    key: 'dallas', name: 'Dallas, TX', level: 'city', platform: 'socrata',
    base: 'https://www.dallasopendata.com/resource/x5ih-idh7.json', resource: 'x5ih-idh7',
    fields: { vendor: 'vendor', agency: 'department', amount: 'chksubtot', category: 'commoditydscr', year: 'fy' },
    searchCols: ['vendor', 'commoditydscr'], source_url: 'https://www.dallasopendata.com/d/x5ih-idh7',
  },
  {
    key: 'ct', name: 'Connecticut (statewide)', level: 'state', platform: 'socrata',
    base: 'https://data.ct.gov/resource/ajdm-rvz7.json', resource: 'ajdm-rvz7',
    fields: { vendor: 'vendor', agency: 'department', amount: 'amount', category: 'expense_category', year: 'fiscal_year' },
    searchCols: ['vendor'], source_url: 'https://data.ct.gov/d/ajdm-rvz7',
  },
];

const BY_KEY_SPEND = new Map(SPEND_JURISDICTIONS.map((j) => [j.key, j]));

const tools: McpToolExport['tools'] = [
  {
    name: 'gov_contracts_search',
    description:
      "Search AWARDED US state & local government contracts, normalized across jurisdictions (keyless open data). Filter by vendor (winning supplier), keyword (contract title/description), awarding agency, and minimum dollar amount. Covers state and county contract registries — pass a `jurisdiction` key (see gov_contracts_jurisdictions) to target one, or omit it to search all covered jurisdictions at once. Returns each contract with its ID, vendor, title, agency, amount, and dates. This is STATE/LOCAL award data (for federal contracts use USAspending/SAM tools).",
    inputSchema: {
      type: 'object' as const,
      properties: {
        jurisdiction: { type: 'string', description: 'Jurisdiction key to target (e.g. "tx", "wa", "king-county-wa"). Omit to search all covered jurisdictions. Use gov_contracts_jurisdictions to list keys.' },
        vendor: { type: 'string', description: 'Winning vendor/supplier name to match (case-insensitive substring), e.g. "Microsoft".' },
        keyword: { type: 'string', description: 'Match against contract title/description (case-insensitive substring), e.g. "software", "road".' },
        agency: { type: 'string', description: 'Awarding agency/department to match (case-insensitive substring). Not all jurisdictions carry an agency field.' },
        min_amount: { type: ['number', 'string'], description: 'Only contracts whose value is at least this many dollars.' },
        limit: { type: ['number', 'string'], description: 'Max contracts per jurisdiction (default 20, max 100).' },
      },
    },
  },
  {
    name: 'gov_spending_search',
    description:
      "Search US STATE government spending / vendor payments — the 'checkbook' data of what an agency actually PAID a vendor (distinct from an awarded contract's value). Keyless. Filter by vendor, awarding agency, spending category keyword, and minimum amount. Pass a `jurisdiction` key (see gov_contracts_jurisdictions) to target one state, or omit it to search all covered states. Returns vendor, agency, amount, category, and fiscal year. Use gov_contracts_search for awarded contracts; use this for actual payments/expenditures.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        jurisdiction: { type: 'string', description: 'State key to target (e.g. "nj", "vt", "or", "md", "mo"). Omit to search all covered states.' },
        vendor: { type: 'string', description: 'Vendor/payee name to match (case-insensitive substring).' },
        keyword: { type: 'string', description: 'Match against the spending category/description (case-insensitive substring).' },
        agency: { type: 'string', description: 'Paying agency/department to match (case-insensitive substring).' },
        min_amount: { type: ['number', 'string'], description: 'Only payments of at least this many dollars.' },
        limit: { type: ['number', 'string'], description: 'Max records per state (default 20, max 100).' },
      },
    },
  },
  {
    name: 'gov_contracts_jurisdictions',
    description:
      "List the US state & local jurisdictions covered by this pack, split into contract-award jurisdictions (gov_contracts_search) and spending/checkbook jurisdictions (gov_spending_search), with each one's key, level (state/county/city), data platform, source dataset URL, and live record count.",
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

// ── platform clients ─────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/'/g, "''");
}

async function fetchJson(url: string): Promise<any> {
  const res = await pwFetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) throw new Error(`upstream_down: ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

// Build a Socrata SoQL $where from the normalized filters.
function socrataWhere(j: Jurisdiction, f: Filters): string {
  const cl: string[] = [];
  if (f.vendor) cl.push(`upper(${j.fields.vendor}) like upper('%${esc(f.vendor)}%')`);
  if (f.agency && j.fields.agency) cl.push(`upper(${j.fields.agency}) like upper('%${esc(f.agency)}%')`);
  if (f.keyword) cl.push('(' + j.searchCols.map((c) => `upper(${c}) like upper('%${esc(f.keyword!)}%')`).join(' OR ') + ')');
  if (f.minAmount != null && j.fields.amount) cl.push(`${j.fields.amount} >= ${f.minAmount}`);
  return cl.join(' AND ');
}

async function querySocrata(j: Jurisdiction, f: Filters, limit: number): Promise<Record<string, unknown>[]> {
  const params = new URLSearchParams({ $limit: String(limit) });
  const where = socrataWhere(j, f);
  if (where) params.set('$where', where);
  if (j.fields.amount) params.set('$order', `${j.fields.amount} DESC`);
  return fetchJson(`${j.base}?${params}`);
}

async function queryCkan(j: Jurisdiction, f: Filters, limit: number): Promise<Record<string, unknown>[]> {
  // CKAN datastore_search supports a plain full-text `q`; combine the text
  // filters into one query string (best-effort — CKAN q is fuzzy).
  const q = [f.vendor, f.keyword, f.agency].filter(Boolean).join(' ');
  const params = new URLSearchParams({ resource_id: j.resource, limit: String(limit) });
  if (q) params.set('q', q);
  const data = await fetchJson(`${j.base}/datastore_search?${params}`);
  return data?.result?.records ?? [];
}

interface Filters {
  vendor?: string;
  keyword?: string;
  agency?: string;
  minAmount?: number;
}

function pick(r: Record<string, unknown>, col?: string): string | null {
  if (!col) return null;
  const v = r[col];
  return v === undefined || v === null || v === '' ? null : String(v);
}

function parseAmount(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalize(j: Jurisdiction, r: Record<string, unknown>): Record<string, unknown> {
  const amt = pick(r, j.fields.amount);
  return {
    jurisdiction: j.key,
    jurisdiction_name: j.name,
    contract_id: pick(r, j.fields.contract_id),
    vendor: pick(r, j.fields.vendor),
    title: pick(r, j.fields.title),
    agency: pick(r, j.fields.agency),
    amount: parseAmount(amt),
    start_date: pick(r, j.fields.start_date),
    end_date: pick(r, j.fields.end_date),
    method: pick(r, j.fields.method),
  };
}

async function queryOne(j: Jurisdiction, f: Filters, limit: number): Promise<Record<string, unknown>[]> {
  const rows = j.platform === 'socrata' ? await querySocrata(j, f, limit) : await queryCkan(j, f, limit);
  return rows.map((r) => normalize(j, r));
}

async function search(args: Record<string, unknown>): Promise<unknown> {
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  const f: Filters = {
    vendor: strArg(args.vendor),
    keyword: strArg(args.keyword),
    agency: strArg(args.agency),
    minAmount: numArg(args.min_amount),
  };
  const jurKey = strArg(args.jurisdiction);
  let targets: Jurisdiction[];
  if (jurKey) {
    const j = BY_KEY.get(jurKey.toLowerCase());
    if (!j) return { error: 'user_error', message: `Unknown jurisdiction "${jurKey}". Call gov_contracts_jurisdictions for valid keys.` };
    targets = [j];
  } else {
    targets = JURISDICTIONS;
  }

  // Fan out across targets; a single jurisdiction failing must not sink the
  // rest (they're independent open-data portals with independent uptime).
  const settled = await Promise.allSettled(targets.map((j) => queryOne(j, f, limit)));
  const contracts: Record<string, unknown>[] = [];
  const errors: Record<string, string> = {};
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') contracts.push(...s.value);
    else errors[targets[i].key] = s.reason instanceof Error ? s.reason.message : String(s.reason);
  });
  // When merging across jurisdictions, rank by amount desc (nulls last).
  if (!jurKey) contracts.sort((a, b) => (Number(b.amount) || -Infinity) - (Number(a.amount) || -Infinity));

  return {
    jurisdictions_searched: targets.map((j) => j.key),
    count: contracts.length,
    contracts: jurKey ? contracts : contracts.slice(0, limit),
    ...(Object.keys(errors).length ? { errors } : {}),
  };
}

function normalizeSpend(j: Jurisdiction, r: Record<string, unknown>): Record<string, unknown> {
  return {
    jurisdiction: j.key,
    jurisdiction_name: j.name,
    vendor: pick(r, j.fields.vendor),
    agency: pick(r, j.fields.agency),
    amount: parseAmount(pick(r, j.fields.amount)),
    category: pick(r, j.fields.category),
    fiscal_year: pick(r, j.fields.year),
  };
}

async function searchSpend(args: Record<string, unknown>): Promise<unknown> {
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 100);
  const f: Filters = {
    vendor: strArg(args.vendor),
    keyword: strArg(args.keyword),
    agency: strArg(args.agency),
    minAmount: numArg(args.min_amount),
  };
  const jurKey = strArg(args.jurisdiction);
  let targets: Jurisdiction[];
  if (jurKey) {
    const j = BY_KEY_SPEND.get(jurKey.toLowerCase());
    if (!j) return { error: 'user_error', message: `Unknown spending jurisdiction "${jurKey}". Call gov_contracts_jurisdictions for valid keys.` };
    targets = [j];
  } else {
    targets = SPEND_JURISDICTIONS;
  }
  const settled = await Promise.allSettled(targets.map((j) => querySocrata(j, f, limit).then((rows) => rows.map((r) => normalizeSpend(j, r)))));
  const payments: Record<string, unknown>[] = [];
  const errors: Record<string, string> = {};
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') payments.push(...s.value);
    else errors[targets[i].key] = s.reason instanceof Error ? s.reason.message : String(s.reason);
  });
  if (!jurKey) payments.sort((a, b) => (Number(b.amount) || -Infinity) - (Number(a.amount) || -Infinity));
  return {
    jurisdictions_searched: targets.map((j) => j.key),
    count: payments.length,
    payments: jurKey ? payments : payments.slice(0, limit),
    ...(Object.keys(errors).length ? { errors } : {}),
  };
}

async function countFor(j: Jurisdiction): Promise<number | null> {
  try {
    if (j.platform === 'socrata') {
      const d = await fetchJson(`${j.base}?$select=count(1)`);
      return Number(d?.[0]?.count_1 ?? d?.[0]?.count ?? null) || null;
    }
    const d = await fetchJson(`${j.base}/datastore_search?resource_id=${j.resource}&limit=0`);
    return Number(d?.result?.total ?? null) || null;
  } catch {
    return null;
  }
}

async function jurisdictions(): Promise<unknown> {
  const shape = async (j: Jurisdiction) => ({
    key: j.key, name: j.name, level: j.level, platform: j.platform,
    record_count: await countFor(j), source_url: j.source_url,
  });
  const [contracts, spending] = await Promise.all([
    Promise.all(JURISDICTIONS.map(shape)),
    Promise.all(SPEND_JURISDICTIONS.map(shape)),
  ]);
  return {
    contract_jurisdictions: contracts, // use with gov_contracts_search
    spending_jurisdictions: spending, // use with gov_spending_search
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'gov_contracts_search':
        return await search(args);
      case 'gov_spending_search':
        return await searchSpend(args);
      case 'gov_contracts_jurisdictions':
        return await jurisdictions();
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function strArg(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t || undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function numArg(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
