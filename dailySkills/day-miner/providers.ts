// One structured-output call against Meta Llama (OpenAI-compatible), SubQ Preview, or Gemini.
import { z } from 'zod';

export type ProviderId = 'llama' | 'subq' | 'gemini';
export interface ChatJsonRequest { system: string; user: string; schema: z.ZodTypeAny; schemaName: string; maxTokens?: number }
export interface ChatJsonResult<T> { value: T; provider: ProviderId; model: string; latencyMs: number; usage?: unknown; raw: string }

export function pickProvider(env: NodeJS.ProcessEnv, requested?: string): ProviderId {
  if (requested) { if (!['llama', 'subq', 'gemini'].includes(requested)) throw new Error(`unknown provider ${requested}`); return requested as ProviderId; }
  if (env.LLAMA_API_KEY && env.LLAMA_ENDPOINT) return 'llama';
  if (env.SUBQ_API_KEY) return 'subq';
  if (env.GEMINI_API_KEY) return 'gemini';
  throw new Error('No model key found. Set LLAMA_API_KEY + LLAMA_ENDPOINT, SUBQ_API_KEY, or GEMINI_API_KEY in dailySkills/.env');
}

async function post(url: string, headers: Record<string, string>, body: unknown) {
  const started = performance.now();
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(180_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`provider HTTP ${response.status}: ${text.slice(0, 400)}`);
  return { json: JSON.parse(text), latencyMs: Math.round(performance.now() - started) };
}
const unfence = (text: string) => text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

export async function chatJson<T>(provider: ProviderId, request: ChatJsonRequest, env: NodeJS.ProcessEnv = process.env): Promise<ChatJsonResult<T>> {
  const schema = z.toJSONSchema(request.schema);
  const maxTokens = request.maxTokens ?? 8000;
  let content = '', model = '', latencyMs = 0, usage: unknown;
  if (provider === 'llama' || provider === 'subq') {
    const endpoint = provider === 'llama' ? env.LLAMA_ENDPOINT! : 'https://api.subq.ai/v1/chat/completions';
    const key = provider === 'llama' ? env.LLAMA_API_KEY! : env.SUBQ_API_KEY!;
    model = provider === 'llama' ? (env.LLAMA_MODEL ?? 'Llama-4-Maverick-17B-128E-Instruct-FP8') : (env.SUBQ_CHAT_MODEL ?? 'subq-preview');
    if (!key) throw new Error(`missing key for ${provider}`);
    const body: Record<string, unknown> = { model, messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }], temperature: 0, max_tokens: maxTokens,
      response_format: { type: 'json_schema', json_schema: { name: request.schemaName, strict: true, schema } } };
    if (provider === 'subq') Object.assign(body, { stream: false, store: false, reasoning_effort: 'none' });
    const result = await post(endpoint, { Authorization: `Bearer ${key}` }, body);
    const choice = result.json?.choices?.[0];
    content = typeof choice?.message?.content === 'string' ? choice.message.content : Array.isArray(choice?.message?.content) ? choice.message.content.map((part: any) => part.text ?? '').join('') : '';
    if (!content && result.json?.completion_message?.content) content = typeof result.json.completion_message.content === 'string' ? result.json.completion_message.content : result.json.completion_message.content.text ?? '';
    model = result.json?.model ?? model; latencyMs = result.latencyMs; usage = result.json?.usage ?? result.json?.metrics;
  } else {
    const key = env.GEMINI_API_KEY; model = env.GEMINI_MODEL ?? 'gemini-3.8-flash';
    if (!key) throw new Error('missing GEMINI_API_KEY');
    const result = await post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { 'x-goog-api-key': key },
      { systemInstruction: { parts: [{ text: request.system }] }, contents: [{ role: 'user', parts: [{ text: request.user }] }], generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: maxTokens, temperature: 0 } });
    content = (result.json?.candidates?.[0]?.content?.parts ?? []).filter((part: any) => !part.thought).map((part: any) => part.text ?? '').join('');
    model = result.json?.modelVersion ?? model; latencyMs = result.latencyMs; usage = result.json?.usageMetadata;
  }
  if (!content) throw new Error(`${provider} returned no content`);
  let parsed: unknown;
  try { parsed = JSON.parse(unfence(content)); } catch { throw new Error(`${provider} returned non-JSON content: ${content.slice(0, 300)}`); }
  const value = request.schema.safeParse(parsed);
  if (!value.success) throw new Error(`${provider} output failed schema: ${value.error.issues.slice(0, 5).map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  return { value: value.data as T, provider, model, latencyMs, usage, raw: content };
}
