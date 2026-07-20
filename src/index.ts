interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
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
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
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
