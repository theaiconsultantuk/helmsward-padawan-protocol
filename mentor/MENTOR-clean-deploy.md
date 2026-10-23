# For the mentor: what we built vs what a judge's clean deploy looks like (23 Oct 2026)

Paste or read aloud. No secrets in here.

---

**What we built (Track 3, Reasoning Architecture, team Jedi Pack)**

A support inbox agent: one customer message in, one decision out (send, hold, escalate or close), every step traced. Every company fact comes through Zetaris, never from the model. A draft is written by NVIDIA Nemotron through Meterless Nightshift, critiqued by a second model call, signed off or refused by rule-based risk code, with one retry. Typed questions about each message (follow-up, category, urgency, tone, asks for money, complaint severity) are answered by NVIDIA DiffusionGemma through OpenJev. Meterless engines in the loop: Scout Intent (guard and signed contract), H-MEM (memory between runs), World Model (customer and product history for complaints). A free-text message is published to Zetaris as a ticket row and read back like any authored one. Two reference pages: a front page with a scenario picker and a "how a person sees it / under the hood" journey view, and a dashboard with counters and the human queue.

How it runs for us today, live:

- Zetaris in Docker on our dev VM, with 19 tables in six file formats plus a live REST source, and a semantic layer of 12 typed views.
- Nightshift (the Meterless desktop app, NVIDIA key inside it) and OpenJev (DiffusionGemma 26B) on a Mac, reached from the VM through an SSH tunnel.
- The inbox service on the VM, a single Node program.
- A shared team copy at jedi.blastworks.ai: the pages served as static files, the API proxied to the VM, writes behind a bearer token so strangers cannot spend our NVIDIA free-tier tokens.

**What a judge's clean deploy looks like today**

From a clean clone, with no keys and no network:

```
docker build -t oah-inbox inbox
docker run --network none -p 8000:8000 -e SAMPLE_MODE=true oah-inbox
curl -s -X POST localhost:8000/run -H 'Content-Type: application/json' -d @inbox/input_examples/example_1.json
```

The same loop, the same trace steps, the same 24 authored threads and six demo scenarios deciding to their recorded outcomes, the same two pages on localhost. Zetaris is answered from a cached export of the live tables; the drafter, critic and typed gates are rule-based twins; the ask answer is a template. The trace says on every line which answered.

**How the two differ, honestly**

1. In sample mode no model runs. A judge sees Nemotron and DiffusionGemma only in the committed live traces and the judging pack, not on their own machine.
2. The sponsor services live only on our machines. Zetaris we could ship as Docker (it is Docker for us already, plus a data drop and a register script). Nightshift is a desktop app for Mac or Windows with the NVIDIA key inside it, so a judge would need their own Nightshift and their own key. OpenJev serves a 26B model on a GPU box.
3. With the sponsor services running, the judge's clone runs live with their addresses in a local `.env`; the code path is the same, only the adapters change what they talk to.
4. The hosted copy is a team convenience, not part of the submission; it is gated by a key the judges will not have.

**The question for you**

Is "a judge runs the clean clone in sample mode, reads the live traces and the judging pack" what the judges expect, or do they expect to stand up the live stack themselves: Zetaris in Docker, their own Nightshift and NVIDIA key, OpenJev with DiffusionGemma, and the front end on the same machine? If the second, which of those pieces are realistic for a judge to bring, and what would you want to see documented or scripted for the rest?
