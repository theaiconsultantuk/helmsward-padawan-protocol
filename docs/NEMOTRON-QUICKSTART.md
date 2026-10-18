# Nemotron quickstart (DRAFT, untested until we have a key)

Nemotron is NVIDIA's open-weight model family and the hackathon's required runtime.

## 1. Get a free key (2 minutes, each person does their own)
1. Go to https://build.nvidia.com and sign in (NVIDIA developer account, free).
2. Open a Nemotron model page, e.g. `nvidia/nemotron-3-super-120b-a12b`, click **Get API Key**.
3. Copy the key. It starts `nvapi-`. Treat it like a password: never paste it in chat or commit it.

## 2. Store it
Create `.env.local` in the repo (gitignored) with one line, then `chmod 600 .env.local`:
`NVIDIA_API_KEY=<paste here>`

## 3. Call it (OpenAI-compatible)
- Base URL: `https://integrate.api.nvidia.com/v1` (to confirm on the model page)
- Model: `nvidia/nemotron-3-super-120b-a12b`
- Same shape as the OpenAI chat completions API, so any OpenAI client works with a different base URL.

## 4. Fallback
OpenRouter lists a free, rate-limited `nvidia/nemotron-3-super-120b-a12b:free` if the NVIDIA key is slow to arrive.

## Not yet verified
Rate limits (a third-party site says about 40 requests/minute), exact base URL, and whether hackathon scoring wants a specific model. Check the Required Stack section of the field guide and the 22 Oct brief.
