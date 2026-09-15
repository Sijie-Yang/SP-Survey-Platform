#!/usr/bin/env node
/**
 * Refresh notes for worker-lib/agent/runtime/catalog.generated.mjs.
 * The catalog is checked in so request-time code never fetches upstream.
 *
 * Source of provider IDs: DeepSeek Harness / @earendil-works/pi-ai (0.1.2-alpha.3).
 * Re-run this script after bumping CATALOG_VERSION to print the expected ID set.
 */
import { CATALOG_PROVIDERS, CATALOG_VERSION } from '../worker-lib/agent/runtime/catalog.generated.mjs';

const EXPECTED = [
  'deepseek', 'openai', 'openrouter', 'anthropic', 'google', 'groq', 'fireworks',
  'together', 'mistral', 'moonshotai', 'moonshotai-cn', 'minimax', 'minimax-cn',
  'xai', 'zai', 'zai-coding-cn', 'cerebras', 'huggingface', 'nvidia', 'baseten',
  'kimi-coding', 'qwen-token-plan', 'qwen-token-plan-cn', 'qwen-token-plan-individual',
  'ant-ling', 'vercel-ai-gateway', 'cloudflare-ai-gateway', 'cloudflare-workers-ai',
  'xiaomi', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp',
  'opencode', 'opencode-go', 'amazon-bedrock', 'google-vertex', 'azure-openai-responses',
  'openai-codex', 'github-copilot',
];

const have = CATALOG_PROVIDERS.map((p) => p.id);
const missing = EXPECTED.filter((id) => !have.includes(id));
const extra = have.filter((id) => !EXPECTED.includes(id));
console.log(JSON.stringify({
  version: CATALOG_VERSION,
  count: have.length,
  models: CATALOG_PROVIDERS.reduce((n, p) => n + (p.models?.length || 0), 0),
  missing,
  extra,
}, null, 2));
if (missing.length) process.exitCode = 1;
