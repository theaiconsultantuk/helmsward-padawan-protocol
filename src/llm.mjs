// OpenAI-format chat call. NVIDIA Nemotron first (required hackathon runtime), OpenRouter free Nemotron as fallback.
// Keys come from the environment only (see run.sh). Nothing is logged except which provider answered.
const providers = () => [
  process.env.NVIDIA_API_KEY && {
    name: "nvidia", url: "https://integrate.api.nvidia.com/v1/chat/completions",
    key: process.env.NVIDIA_API_KEY, model: "nvidia/nemotron-3-super-120b-a12b",
  },
  process.env.OPENROUTER_API_KEY && {
    name: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions",
    key: process.env.OPENROUTER_API_KEY, model: "nvidia/nemotron-3-super-120b-a12b:free",
  },
].filter(Boolean);

export async function chat(messages, { maxTokens = 500, timeoutMs = 40000 } = {}) {
  const errors = [];
  for (const p of providers()) {
    try {
      const r = await fetch(p.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${p.key}` },
        body: JSON.stringify({ model: p.model, messages, max_tokens: maxTokens, temperature: 0.2 }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) { errors.push(`${p.name} HTTP ${r.status}`); continue; }
      const d = await r.json();
      const text = d.choices?.[0]?.message?.content;
      if (text) return { text: text.trim(), provider: p.name };
      errors.push(`${p.name} empty`);
    } catch (e) { errors.push(`${p.name} ${e.name}`); }
  }
  throw new Error("No LLM available: " + (errors.join("; ") || "no keys set"));
}
