#!/usr/bin/env node
// Asks every text->text model on OpenRouter to draw Andy Warhol eating a
// hamburger as an SVG, and saves the first <svg>...</svg> block in each
// response to assets/<slug>.svg.
//
// Env:
//   OPENROUTER_API_KEY  required
//   LIMIT               max number of models to query this run (default 5)
//   PROMPT              override the base prompt
//   FORCE               if "1", regenerate even when the output already exists
//   ONLY                comma-separated substrings; only models whose id matches
//                       at least one are queried (e.g. ONLY=claude,gpt,llama)

const fs = require("node:fs");
const path = require("node:path");

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error("Missing OPENROUTER_API_KEY");
  process.exit(1);
}

const LIMIT = Number(process.env.LIMIT ?? 5);
const TIMEOUT_MS = Number(process.env.TIMEOUT ?? 180) * 1000;
const SLEEP_MS = Number(process.env.SLEEP ?? 2) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FORCE = process.env.FORCE === "1";
const ONLY = (process.env.ONLY ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const PROMPT =
  process.env.PROMPT ??
  "Can you write an svg file depicting Andy Warhol eating a hamburger?";

const ROOT = __dirname;
const ASSETS = path.join(ROOT, "assets");

// Manual overrides — keys are OpenRouter model ids, values are the existing
// filename to treat as "already done". Add entries when fuzzy matching misses.
const ALIASES = {
  "google/gemini-3.1-flash-lite": "gemini-3.1-flash-light.svg", // lite→light typo
  "baidu/cobuddy:free": "baidu-cobuddy.svg-free.svg",
  "inclusionai/ring-2.6-1t": "inclusionai-ring-2.6-1t-free.svg",
};

// Models that consistently fail to produce a usable SVG. Add ids here to
// permanently skip them. The SKIP env var (comma-separated) appends extras.
const SKIP = new Set([
  "allenai/olmo-3-32b-think",
  "arcee-ai/coder-large",
  "arcee-ai/maestro-reasoning",
  "arcee-ai/spotlight",
  "arcee-ai/virtuoso-large",
  "baidu/ernie-4.5-vl-28b-a3b",
  "bytedance-seed/seed-2.0-mini",
  "deepseek/deepseek-v4-flash:free",
  "essentialai/rnj-1-instruct",
  "google/gemini-3.1-pro-preview",
  "google/gemini-3.1-pro-preview-customtools",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "inception/mercury-2",
  "meta-llama/llama-guard-4-12b",
  "minimax/minimax-m2-her",
  "minimax/minimax-m2.1",
  "moonshotai/kimi-k2.6",
  "moonshotai/kimi-k2.6:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
  "openai/gpt-5-pro",
  "openai/gpt-5.4",
  "openai/gpt-5.4-pro",
  "openai/gpt-5.5-pro",
  "openai/o3-deep-research",
  "openai/o4-mini-deep-research",
  "openrouter/pareto-code",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "qwen/qwen3-vl-235b-a22b-thinking",
  "qwen/qwen3.7-plus",
  "relace/relace-apply-3",
  "z-ai/glm-5.1",
  "z-ai/glm-5v-turbo",
  ...(process.env.SKIP ?? "").split(",").map((s) => s.trim()).filter(Boolean),
]);

const clean = (s) =>
  s.replace(/[:]/g, "-").replace(/[^a-z0-9.-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();

// Canonical output slug: "vendor/model" → "vendor-model" with the model's
// leading vendor-token stripped (qwen/qwen3.7-max → qwen-3.7-max).
function canonicalSlug(id) {
  const [vendor, model] = id.toLowerCase().split("/");
  const lastSeg = vendor.split("-").pop();
  let stripped = model;
  if (model.startsWith(vendor + "-")) stripped = model.slice(vendor.length + 1);
  else if (model.startsWith(vendor)) stripped = model.slice(vendor.length);
  else if (lastSeg && model.startsWith(lastSeg + "-")) stripped = model.slice(lastSeg.length + 1);
  else if (lastSeg && model.startsWith(lastSeg)) stripped = model.slice(lastSeg.length);
  return clean(`${vendor}-${stripped}`);
}

// Variants used only for collision detection against existing files (vendor
// may be present, stripped, or missing in old hand-named files).
function candidates(id) {
  const [vendor, model] = id.toLowerCase().split("/");
  const lastSeg = vendor.split("-").pop();
  let stripped = model;
  if (model.startsWith(vendor)) stripped = model.slice(vendor.length).replace(/^-/, "");
  else if (lastSeg && model.startsWith(lastSeg)) stripped = model.slice(lastSeg.length).replace(/^-/, "");
  return [...new Set([
    `${vendor}-${stripped}`,
    `${vendor}-${model}`,
    stripped,
    model,
  ].map(clean))];
}

const fingerprint = (name) =>
  name.replace(/\.svg$/i, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function buildExistingIndex() {
  const files = fs.readdirSync(ASSETS).filter((f) => f.endsWith(".svg"));
  const index = new Map();
  for (const f of files) index.set(fingerprint(f), f);
  return index;
}

function existingFor(id, index) {
  if (ALIASES[id]) return ALIASES[id];
  for (const c of candidates(id)) {
    const hit = index.get(fingerprint(c));
    if (hit) return hit;
  }
  return null;
}

const outPath = (id) => path.join(ASSETS, `${canonicalSlug(id)}.svg`);

async function listModels() {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`models: ${res.status} ${res.statusText}`);
  const { data } = await res.json();
  return data;
}

function isTextToText(m) {
  const a = m.architecture ?? {};
  const ins = a.input_modalities ?? [];
  const outs = a.output_modalities ?? [];
  return ins.includes("text") && outs.length === 1 && outs[0] === "text";
}

async function ask(modelId) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/vincentbruijn/hamburger",
      "X-Title": "warhol-hamburger-svg",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: PROMPT }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${res.status} ${body?.error?.message ?? res.statusText}`);
  }
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === "string" ? p : p?.text ?? ""))
      .join("");
  }
  return "";
}

function extractSvg(text) {
  const m = text.match(/<svg[\s\S]*?<\/svg>/i);
  return m ? m[0] : null;
}

const DRY = process.env.DRY === "1";

(async () => {
  const existing = buildExistingIndex();
  const models = (await listModels())
    .filter(isTextToText)
    .filter((m) => !ONLY.length || ONLY.some((s) => m.id.toLowerCase().includes(s)));

  console.log(`${models.length} text->text models match`);

  let done = 0;
  let saved = 0;
  for (const m of models) {
    if (done >= LIMIT) break;
    if (SKIP.has(m.id)) {
      console.log(`skip ${m.id} (skip-list)`);
      continue;
    }
    const hit = !FORCE && existingFor(m.id, existing);
    if (hit) {
      console.log(`skip ${m.id} (matches ${hit})`);
      continue;
    }
    const out = outPath(m.id);
    done++;
    if (DRY) {
      console.log(`[${done}/${LIMIT}] ${m.id} -> ${path.relative(ROOT, out)} (dry)`);
      continue;
    }
    process.stdout.write(`[${done}/${LIMIT}] ${m.id} -> ${path.basename(out)} ... `);
    try {
      const text = await ask(m.id);
      const svg = extractSvg(text);
      if (!svg) {
        console.log("no <svg> in response");
      } else {
        fs.writeFileSync(out, svg);
        saved++;
        console.log(`saved ${path.relative(ROOT, out)}`);
      }
    } catch (err) {
      console.log(`error: ${err.message}`);
    }
    if (done < LIMIT) await sleep(SLEEP_MS);
  }
  console.log(`\nDone. ${saved} SVG(s) saved.`);
})();
