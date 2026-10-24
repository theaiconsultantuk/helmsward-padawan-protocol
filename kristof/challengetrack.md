---
title: "Jedi Pack inbox"
description: "Track 3 brief for a fictional Jedi Pack Inc mailbox that decides send, hold, escalate or close from Zetaris rows."
date: "2026-10-22"
tags: [jedi-pack, inbox, kristof]
---

# Jedi Pack inbox

Captured: 2026-10-22 05:10 Europe/Brussels · Status: STEP 3, sketch. Track locked by Kristof: 3, Reasoning Architecture. BACKUP-1 dropped by Kristof. Group has not yet kept the build.
Writer: IDEATOR, using Scout Intent (sense, interpret, guard, route, recommend). No product code.

## Original wording

Verbatim. Not edited.

```
sup, can you use the Scout to check out how good my proposal would be to match judge expectations, and if it would be a good tech showcase for the sponsoring tech?

The 4 missions are attachment 1. My preference is 2 or 3 (my description below, which challenge track matches that most closely?)

Out of the 4 tracks, I believe I would be best suited for track 2 or 3. 1 needs a real data scientist in my opinion because you have to fill gaps. If we go for 3 I think we should add JEV into the workflow. But if you decide to go for 1 Ill help in any way I can. Ill try and work out an idea for option 2 by tomorrow. Im thinking along the lines of: Question to big corporation comes in -> Automated reply goes out Based on: 1) Can this data leave the company? (Internal/External check) 2) Agent checks relevant policy (policy wiki) 3) Agent checks responsible human, and if theyre on vacation (holiday planner), their backup (knowledge matrix) 4) Agent checks if theyre allowed to answer autonomously (automation matrix) 5) Dont know how to incorporate retries yet, maybe if the client replies that they believe the answer is incorrect? 6) Dont know how to incorporate loops in this scenario, maybe a training loop with a randomizer on the input? 7) H-MEM would be auto-incorporated, so thats a win, everything would run on Zetaris 8) Eval step 9) Scikit Learn if client response indicates agent was wrong + trigger escalation
Oh and adding a dashboard to monitor agent output and agent scoring for Human in the Loop to monitor, of course


Fictional Company: Jedi Pack Inc

I would need you to generate fictional datasets that go in zetaris.
1) Holiday Calendar of a company of about 20 people, filled jan-dec 2026 - completely fictional, random vacation days, 26 days off per person per year, outside of regular US holidays. (=excel file)
2) A matrix of roles and responsibities, which employee is the main responsible, who their backup is (=db)
3) An HR db for the company - Each employee (first name, last name - add 3 or 4 complex names, like asian people with dual first names), employee number, company email address (firstname.lastname@jedipack.com)
4) a Wiki of company policies (refund policy, refund limits - ie up to amount X it can be approved by employee 15 backup is 16 - but above amount X it has to be escalated to manager, employee 3, backup employee 4
5) use JEV to categorize incoming mail (ie. is this a complaint/request for refund/general question/appreciation mail/other)
6) db for mail categories
7) meterless world model for general company layout [Can we use Gaia on mac?]
8) H-MEM for recognizing patterns and re-using prior query paths for similar incoming mail
9) Nightshift, so company is reachable 24/7, but agent holds response when unsure or escalation to human is needed.
10) mail treshhold - standard, one agent type runs at a time, but if incoming mail traffic is 75% higher than the avg, go meterles swarm and spawn multiple - avoid overlap by having them claim emails/problems in state
11) if an e-mail thread contains >1 human external input, classify if the 2nd input is follow-up or a PURE thank you.
12) Relay is the orchestrator. Opens a ticket for every question, dedupes where needed, recognizes threads
13) email is just one contact method, website contact form is another, trustpilot API (fictional) is a third entrypoint.
14) Markovian looks for patterns (ie. sender=x, subject=y. This is probably a follow-up.
15) Every reply proposal is vetted by evaluator before it gets sent. 2 negative evaluation rounds on 1 input = escalate to responsible human
16) escalate happens in 2 ways: fwd/ESCALATION: mail from agentic mailbox to responsible mailbox (if not on holiday - use deterministic -is this person currently out of office- .py script
17) Risk needs to sign off on any autonomous email (possible image impact, possible too high refund amount, etc)
18) If escalation because of 2 fails: Both Risk and Evaluatior save their feedback in the unique ticket id file, and this gets shown to the human.
19) Files/Folders/Naming:
./date/{YYYY-MM-DD-HH:MM}{category}-{human}-nbrOfRetries{x}.md
20) Have IDEATE structure this braindump
21) replace skicit learn with HARDEN+POWER to learn (but add scoring to a database, and that score becomes a weight and a floor of when the agent can confidently act autonomously --> Trust Ledger
22) Use IMPLEMENT to actually build the flow if the group decides to go for this idea
23) Invent a corpus of approx 300 email threads (mostly 1 email, 1 reply) for JEV and harden/power to learn from and populate the scoring db.
24) Read every answer it sends --> Shown in 1 tab of the dashboard, human in the loop can influence (bad reply) and affirm (good reply) to grow confidence.
25) Token usage is FYI shown on a second page of the dashboard, same page where model scores/weights/confidence are shown.
26) nightly batch job to review memory for privacy/GDPR
27) Dashboard page that shows:
- incoming mail per day
- how many of those were handled autonomously
- how many of those autonomous mails were first-time-right
- how many escalations/


My entire proposal goes into the /kristof/ subfolder of the repo.


Use markovian to build the flow as deterministically as possible. Code where possible, human in the loop via dashboard/escalation, and LLM only where it adds value. JEV for classification.
```

Attachment 1 is the challenge-track table: 1 Solving Fragmented Intelligence, 2 The Agent That Can Explain Why, 3 Reasoning Architecture, Bonus Wildcard [Tinkerer]. He called them missions. This brief treats them as those four tracks.

## Scout

Pipeline: sense, interpret, guard, route, recommend. Downstream build is refused until the team accepts this contract. Signature is not issued. This file is the assessment, not a runtime HMAC.

### Sense

| Candidate | Score | Why |
|---|---:|---|
| `proposal.assess` | 0.86 | He asked how the idea matches judges and sponsors. |
| `track.match` | 0.74 | He asked which of tracks 2 or 3 the description matches. |
| `idea.shape` | 0.71 | He asked IDEATE to structure the braindump into `/kristof/`. |
| `product.build` | 0.22 | Item 22 says IMPLEMENT only if the group decides. The group has not decided. |

### Interpret

- Intent: assess and shape. Do not build.
- Company: fictional Jedi Pack Inc. The HackOS team is also named Jedi Pack. The README must say the company is fictional.
- Preference he stated: track 2 or 3. Track 1 only if someone else decides it, and he will help.
- Track lock, his, 22 Oct 2026: Track 3, Reasoning Architecture.
- BACKUP-1, his, 22 Oct 2026: dropped. This challenge does not run the safety-net builder. The employee who covers an owner on holiday stays in the product. That person is a data row, not the BACKUP-1 role.
- Output home he stated: `/kristof/` in this repo. This file is that home.
- Dataset generation, the 300 threads, and the running flow: later, and only after the group keeps the idea.
- Unknown: team agreement from Paul, Jocke, and Dean. Internal hand-in clock. Whether he accepts the scope cut below.

### Guard

Level: **medium**. Flags, not a block.

- POWER is NVIDIA and Meterless Nightshift. HARDEN and IMPLEMENT are Meterless prompt-library concepts. The groups are Ideate, Implement, Combine, Harden, and Power, at meterless.ai/engines.html. Source: `docs/agent-ready/prompt-library.md` in `/Users/McEinh/code/meterless`. They are not extra engines beside H-MEM, World Model, Markovian, and Scout. Each one has a job below. The sponsor explanation names that job.
- PII: the company is fictional. Generated names and `@jedipack.com` addresses stay inside the sample. The privacy scan exists so memory summaries do not keep a customer's refund detail.
- Risk of the idea itself: an autonomous customer email can commit the company. The product's point is that send is the last step, after code gates and the evaluator. Sample mode never sends to a real address.
- A randomizer "training loop" is a fake loop. Judges discount it. It is out of the contract.
- Product code, git commits, sign-ups, keys, and installing Gaia, Relay, Swarms, or Nightshift are outside this contract. Kristof installs those himself.

### Route

Allowed for this turn:

1. Read the published track text, rubric, weak and strong examples, and the Meterless packet.
2. Write this brief.
3. Write the scorecard canvas.

Refused for this turn:

- Excel, databases, the 300 threads, dashboard code, `git init`, commits.

### Recommend

Model profile for a future build: POWER is NVIDIA and Meterless Nightshift. Nemotron through Nightshift for two calls only. Nemotron drafts the reply. The Evaluator is Nightshift's judge lane, and Nemotron writes that critique. Everything else is code. If the hotspot is down, sample mode uses a recorded draft and says so in the trace.

### Contract

```text
contractId: scout-jedi-pack-inbox-2026-10-22
traceId: kristof-jedi-pack-inbox
intent: proposal.assess
parameters:
  primaryTrack: 3
  company: Jedi Pack Inc (fictional)
  decision: send | hold | escalate | close
  backup1: dropped
risk: medium
capabilities:
  - brief.write
  - scorecard.write
notCapabilities:
  - dataset.generate
  - product.code
  - mail.send
  - backup1.spawn
issuedAt: 2026-10-22T03:10:00Z
expiresAt: when the team accepts or rejects the brief
signature: not issued
signedBy: scout-assessment
```

A build pane treats an unsigned contract as a refusal.

## Verdict

Track **3, Reasoning Architecture**, is the closest match. Fit 9/10 against the published sentence.

Track 2, The Agent That Can Explain Why, fits 7/10. The same system produces an evidence-backed reply. It becomes the primary track if the team would rather be judged on the memo than on the send / hold / escalate action.

Track 1, Solving Fragmented Intelligence, fits 4/10. The sources are fragmented, and Zetaris should be the one query surface. The hero is not discovering unknown sources or filling gaps. His read on track 1 is right.

Bonus Tinkerer fits 1/10. There is no existing project being extended.

The idea is a **good sponsor showcase after the cut**, and a weak one if all 27 items ship as names. Zetaris, Scout, H-MEM, World Model, and Nemotron each have a job that changes the decision. POWER is NVIDIA and Meterless Nightshift. HARDEN and IMPLEMENT are named for the jobs in the prompt library, below. Gaia stays the workspace. The Relay app stays off the judge machine. Swarm stays out of the first build.

Worksheet, his 0–2 scale from `docs/worksheet.md`:

| Question | As written | Scoped cut |
|---|---:|---:|
| Explain the problem in 30 seconds | 1 | 2 |
| Know the user | 2 | 2 |
| Accessible data | 2 | 2 |
| Working version in 144 hours | 0 | 1 |
| Runs quickly and predictably | 1 | 2 |
| Zetaris and Meterless have a real role | 2 | 2 |
| Agents interact more than once | 2 | 2 |
| Critique, validation, or retry | 2 | 2 |
| Useful output in a 1–4 minute demo | 1 | 2 |
| Limitations can be stated | 1 | 2 |
| **Total** | **14** | **19** |

14 is still the guide's "reduce scope" band. 19 is the strong band. The 144-hour cell stays 1 on the cut because the team has not accepted it and Zetaris plus Nightshift still have to come up on the day. The Meterless cell moved to 2 on both columns once POWER was read as NVIDIA and Meterless Nightshift, and HARDEN and IMPLEMENT as prompt-library concepts.

Judge-point estimates, same date, labelled as estimates:

| Criterion | Max | As written | Scoped |
|---|---:|---:|---:|
| Impact | 30 | 16 | 23 |
| Technical | 20 | 11 | 16 |
| Innovation | 15 | 8 | 11 |
| Demo | 15 | 7 | 13 |
| Product and UX | 10 | 6 | 8 |
| Sponsor tech | 10 | 8 | 9 |
| **Total** | **100** | **56** | **80** |

The full list is 56. The Evaluator is Nightshift's judge lane, and NVIDIA Nemotron writes that critique. Risk is Scout's risk check. Sponsor tech on that list is 8: Zetaris supplies the rows the draft cites, and the dashboard is a second Zetaris query on the same tables. Swarm, Gaia, and the Relay app are still named, so the full list stays under the cut. The cut stays 9. The last point waits on a trace a judge can run, including a skipped NVIDIA call when the hotspot is down.

## Why track 3

Published track 3 sentence: turn data, knowledge, memory, and reasoning into reliable decisions and actions.

The official example in `inputdocs/017` is a clinic front desk: availability rules, priority policy, memory of past decisions, a booking decision with the reasoning. This brief is the company-inbox version of that example.

The decision is:

- **Send**, when the fact may leave, the amount is within the employee's limit, that employee or their backup is in, the trust floor is met, and the reply loop has exited as correct: Evaluator passed and Risk signed off on the same round.
- **Hold**, when the floor is missed. Nightshift's "24/7" story is this hold, not an always-on model. A held reply has still left the loop as correct, or it has not been drafted yet.
- **Escalate**, when the reply loop hits the escalate gate. The gate is 2 negative rounds on that ticket, or a hard fact Risk cannot rewrite (amount over the limit, a fact that may not leave, owner and backup both out).
- **Close**, when nothing further is owed on the ticket and it ends there.

Track 2's published sentence is an investigation that ends in an evidence-backed answer. The demo can show that answer for free. The action the architecture exists to take is still send, hold, escalate or close, which is track 3.

## One sentence

We are building an agent that helps a Jedi Pack Inc mailbox owner decide whether a customer message can be answered, held, escalated or closed, by joining holiday, policy, responsibility, and backup data in Zetaris with a trust floor, producing a reply that cites those rows or a ticket a human can take.

User: the employee who owns that topic, and their backup when the owner is away.
Decision: send, hold, escalate or close.
Output: the reply or the escalation file, plus the four counters.

## The challenge to the framing

"H-MEM would be auto-incorporated, so that's a win" is the bolted-on pattern in the weak-submission guide. Memory counts when a later decision changes. The demo shows a second, similar refund taking fewer steps because the first path was remembered, and a human "bad reply" raising the floor so the next one holds.

Response to this challenge: unknown. He has not answered it yet.

A second challenge, also unanswered: auto-reply products already exist (see Discovery). The score comes from the held send a judge can audit, not from answering mail.

## What is code, and what is the model

Code, every time:

- Open a ticket, dedupe a thread, claim a row so two workers cannot take it.
- Thank-you versus follow-up, by a short lexicon (gratitude, no question mark, no new amount). The model runs only when that lexicon says ambiguous.
- Sender domain against `@jedipack.com` and a policy flag `may_leave`.
- Refund amount against the policy limit. SQL.
- "Is this person out today": date in a holiday row. A Python date check. The model is not allowed to answer this.
- Backup lookup. SQL.
- Trust floor: weight compared with a number.
- File name: `traces/2026-10-22T1430-refund-padme.amidala-retries2.md`. No colon. The colon in the original pattern breaks on Windows.

Model, Nemotron through Nightshift, inside the loop only:

- Draft the reply from the cited rows only.
- Evaluator (item 15) is Nightshift's judge lane. Nemotron writes the critique: do those rows support every claim in the draft? Pass or fail, with a sentence the planner can apply.

Risk (item 17) is Scout's risk check, the guard in `engines/scout-intent/docs/risk-and-policy.md`. The policy gate signs the same draft the Evaluator just saw. A deny blocks. A require-approval holds. It does not call the model.

## HARDEN, POWER, IMPLEMENT

POWER is NVIDIA and Meterless Nightshift. HARDEN and IMPLEMENT are groups in the Meterless prompt library (`docs/agent-ready/prompt-library.md`, full set at meterless.ai/engines.html). The other two groups are Ideate and Combine.

| Concept | Published job | Job in this inbox |
|---|---|---|
| IMPLEMENT | Build an engine from its spec and run the checks. The starter is the cold-run versus warm-run memory proof. | After the group keeps this brief, Cursor implements the engines this way. Done when the conformance checks pass. IMPLEMENT does not run at reply time. |
| POWER | NVIDIA and Meterless Nightshift. | POWER is both. Nightshift is the Meterless route. NVIDIA Nemotron is the model. Drafts and Evaluator critiques go through that pair. Sample mode logs the call as skipped. |
| HARDEN | Scout's injection guard, scored against its own precision and recall targets. | Every inbound mail passes the guard before the model sees it. A blocked input does not enter the reply loop. The trust ledger is the weight table: affirm and reject move the weight, and the floor is when a send is allowed. HARDEN ships that audit. It does not fit a model. |

## Reply loop (items 15, 17, 18)

Items 15, 17, and 18 are one loop. They are not three steps in a line. The loop runs until the reply is correct, or until it hits the escalate gate.

**Correct** means both of these are true on the same round:

- Item 15. The Evaluator passes the draft.
- Item 17. Risk signs off. The checks are image impact, a refund amount above the policy row, a commitment the cited rows do not contain, and a fact that may not leave the company.

**Escalate gate**, item 18. The loop stops. No further draft.

- Two negative rounds on this ticket. A negative round is any round where the Evaluator fails, or Risk refuses, or both refuse.
- Or Risk refuses a hard fact on round 1. Another draft cannot change the amount, the `may_leave` flag, or who is out of office. That refusal is the gate, not a rewrite.

When the gate fires, both Risk and the Evaluator write their feedback into the ticket file. The human sees that file. The trace names the path. The handoff is H-MEM's escalate, `queueForHuman` (`engines/hmem/docs/conflict-resolution.md`). Auto-resolve only at confidence 0.70 or above. Below that, the conflict is queued and the engine does not guess.

One round, in order:

1. Planner hands the draft, or the previous critiques, to the executor.
2. Executor drafts or revises from the cited rows.
3. Evaluator vets. Pass or fail, plus one sentence.
4. Risk signs off or refuses, plus one sentence. Risk reads the same draft.
5. Both pass: exit. The decision is send or hold. The loop does not run again.
6. Either fails, and the gate is not met: this is a retry. `retry_count` goes up by one. Both sentences go back to the planner. Return to step 1.
7. The gate is met: stop. Write both feedbacks to the ticket file. The decision is escalate.

The ceiling is 2 negative rounds. The loop does not continue past the gate. A customer who says the reply was wrong opens a follow-up on the same ticket. That follow-up is the Padmé sample below. It is not a randomizer. A training loop that randomizes inputs is out.

Markovian shape of one ticket:

1. Chunk 0 reads H-MEM for sender, subject, category. Carryover is a few lines, not the thread.
2. Chunk 1 runs the SQL gates and writes the cited row ids.
3. Chunk 2 is the reply loop above. Each negative round is another chunk 2, carrying the two critiques and the `retry_count`. The chunk stops when the reply is correct or the escalate gate fires.
4. The chunk writes the path back to H-MEM. A second similar ticket starts from that path.

## Scope

Both versions stay in this brief until the group rules on the decisions below. The full list is the 27-item braindump, estimated at 56. The scoped list is the keep block, estimated at 80. Kristof wants the H-MEM ingest and learn proof in whichever version ships. That proof is two runs: the first writes a memory id, the second reads it and the planner says which chunk it skipped, and a dashboard reject moves the floor so the next similar ticket changes.

### Keep

- Fictional company, stated as fictional. About 20 staff is fine. The demo uses 4 of them: owner, backup, manager, manager's backup.
- Four Zetaris sources: employees (csv or sqlite), holiday calendar (xlsx, Jan–Dec 2026, 26 fictional days each, plus US federal holidays as non-vacation rows), responsibility and backup, refund policy with one amount threshold.
- Three intakes as files in the repo: an email, a contact-form JSON, a fictional Trustpilot JSON. Same ticket normalizer. No live API.
- 24 authored threads that cover send, hold, escalate, thank-you, follow-up, and external-data block. They seed the trust table. Weights are seeded, then moved by affirm / reject. They are not a trained model.
- Dashboard, one app, two views. Both are Zetaris queries on the same surface the decision uses. View 1: incoming, autonomous, first-time-right, escalations, the draft, affirm, reject. View 2: weights, the floor, token counts as FYI. Affirm and reject write back to the trust table there. Nightshift writes the token totals into that table.
- Privacy scan over a 10-row memory sample. It redacts a customer address or a refund amount that leaked into a summary and writes a log line. It is a sample job, `python run.py --job privacy`.
- `SAMPLE_MODE=true`, timeouts, `run.py`, JSONL in `logs/`.

### Full list, kept beside the cut

- 300 threads.
- scikit-learn, and any training step.
- Swarm spawning at 75% traffic. The claim column stays, so the branch can be added later without overlap.
- Gaia as a library inside the product.
- The Relay Windows app as a dependency.
- A third dashboard page.
- A GDPR program beyond the 10-row scan.

### Gaia on this Mac

Yes, as the web app at meterless.ai/gaia. Chat, H-MEM, tools, and WebLLM. Desktop mouse control is the Windows app. This product does not import Gaia. Company state is the World Model engine: tickets, claims, employees, the out-of-office fact. Nightshift on this Mac is the free M1+ edition once Kristof installs it. The web Nightshift has no hotspot for other apps. Judges run through the sample-mode adapter when his hotspot is absent.

## Dataset sketch

Fictional files are in `kristof/data/`. They are not loaded into a Zetaris instance. The refund limit used in the files is 150.00 GC. Each source sits in a different container so a Zetaris filestore can register them side by side.

| Source | Container | Demo fact |
|---|---|---|
| Employees | `employees.csv`, and the `employees` table in `jedipack.sqlite` | 4 double given names, emails `given.family@jedipack.com` with a hyphen where the name has one |
| Holiday | `holiday-2026.xlsx`, with `holiday-2026.csv` beside it | On 2026-10-22 employees 8, 15, 17, and 20 are out. Backup 16 is in. |
| Responsibility | `responsibility.csv`, and the same table in `jedipack.sqlite` | Refund is employee 15, backup 27. Replacement is employee 8, backup 9. |
| Policy | `policy.csv`, plus `wiki/refund-policy.md`, `wiki/replacement-policy.md`, and `wiki/what-may-leave.md` | Under 150.00 GC: employee 15 / 27. Over: the Sales head, employee 40, and the CEO, employee 201, when the head is out. A replacement is not a refund. |
| Categories | `categories.csv` | complaint, refund, question, appreciation, other. Rules first. |
| Trust ledger | `trust-ledger.csv` | Weights are the stored seeds. Affirm raises a weight. Reject lowers it. The 24 threads do not recompute the numbers. |
| Automation matrix | `automation-matrix.xml` | Autonomous only when the category weight is at or above the floor 0.80. Only appreciation qualifies. |
| Email intake | `intakes/email/*.eml` | One mailbox file per email thread. Padmé's correction is `T01-reply.eml`. |
| Contact form | `intakes/contact-form/submissions.json` | Five fictional form posts. No live endpoint. |
| Trustpilot | `intakes/trustpilot/reviews.json` | Three fictional reviews. `live_api` is false. |
| 24 threads | `threads/threads.jsonl` and the same rows in `threads/threads.parquet` | Send, hold, escalate, pure thank-you, follow-up, duplicate, and two external-data blocks. |
| Privacy sample | `memory/privacy-sample.json` | 10 memory rows. `mem-02` leaks an amount. `mem-05` leaks a fictional street. |

T01 is the misread. Her message asks for a replacement. The responsibility topic is replacement, so `category` is `replacement` even though that word is not one of the five mail labels. `agent_category` is `refund`, which is the mistake. The follow-up text is the quote in the judge sample below.

## Judge samples

Two scripted pairs. Each pair is one line with `status` `error`, then the next line `recovery` with `status` `success`. The run continues. Neither pair is a soft `needs_revision`.

**Zetaris refuses once.** In run `demo-recovery`, the first `zetaris.query` has `status` `error`. The summary says port 8888 refused the connection. The next line is `recovery`. The summary names the fixture rows that were used instead, and the same question is answered from those rows. The run does not stop.

**She says the agent misunderstood her.** Same ticket as the refund draft for Padmé Amidala. Her reply is a new message on that thread:

> You misunderstood me. I did not ask for my money back. The saber arrived cracked and I asked you to replace it. Your reply says a refund is on the way. That is wrong. Do not send a refund.

This is the bad one. The draft committed money for a request she did not make. In run `demo-misread`, `critique` has `status` `error`. The summary says the draft promised a refund and she asked for a replacement. The next line is `recovery`: the same ticket reopens, the refund commitment is withdrawn, and H-MEM `queueForHuman` fires. No third draft, and no send.

## Discovery

Filled only from his words, the published docs, and the search below. A missing answer stays unknown.

- **Problem.** A message arrives. Someone must decide whether the answer may leave, which policy row applies, who owns it, whether that person is in, and whether the agent may send.
- **Audience.** The employee responsible for that topic, and the backup. The external sender receives the reply only after send.
- **Handled today.** Unknown. He did not describe the current workaround.
- **Evidence it is needed.** His operational sketch. No metric from him. A public incident is cited by Nylas: a British Columbia tribunal in February 2024 ordered Air Canada to honor a refund a chatbot invented, because nothing stopped the send. Source: https://developer.nylas.com/docs/cookbook/agents/email-support-agent/ (page dated 23 Jun 2026).
- **Kill criteria.** Scout's proposal, not his: if a clean sample run cannot show one held send and one escalation in under 10 minutes, cut to refund-only and one intake. His own kill criterion: unknown.
- **Prior art.** Searched 22 Oct 2026. Queries: "autonomous customer support email agent policy approval escalation holiday backup 2026" and "Zendesk AI agent Intercom Fin Gorgias autonomous refund reply policy license".

| Name | Link | What it does | How this differs | Licence |
|---|---|---|---|---|
| Zendesk AI agents | https://www.zendesk.com/service/ai/ai-agents/ | Resolves support work across channels and learns from outcomes | We decide send, hold, escalate or close from holiday, limit, and backup rows, and we show the contract | Proprietary SaaS. Software licence not stated |
| Intercom Fin | https://www.intercom.com/learning-center/ai-agents-that-take-action | Takes refund and cancel actions through connectors | We do not issue the refund. We decide who may answer | Proprietary. $0.99 per outcome stated at https://www.intercom.com/learning-center/intercom-vs-gorgias . Software licence not stated |
| Gorgias AI | https://www.gorgias.com/comparison/zendesk | Autonomous Shopify refunds, cancels, reships | Ecommerce order actions, not an internal coverage matrix | Proprietary SaaS. Software licence not stated |
| Nylas email support recipe | https://developer.nylas.com/docs/cookbook/agents/email-support-agent/ | Confidence plus risk tier. The agent never hits send | Our floor allows a send when the rows and the evaluator agree. Theirs always queues | Not stated |
| Typewise go-live note | https://www.typewise.app/blog/how-support-teams-go-live-with-ai | Names a reviewer and a backup. A missing approver must not auto-send | A rollout guide, not a query across company sources | Not stated |
| Cherry Assistant coverage plan | https://www.cherryassistant.com/blog/customer-support-coverage-plan | Decision rights with a financial boundary | A human template, not an agent | Not stated |
| Macha | https://www.getmacha.com/blog/how-to-automate-refunds-in-zendesk | Refund drafts inside an existing helpdesk, safe mode until trusted | Sits on Zendesk or Shopify. We stage fictional sources in Zetaris | Service pricing stated on that page. Software licence not stated |

## Exploration

- **Outcome.** A judge runs one sample ticket and sees either a cited reply or a held ticket, and can point at the row, the floor, and the critique.
- **Alternatives.**
  - Simpler: one refund policy table, one owner, draft plus human approve, no trust floor. Safer, and thinner on track 3, because memory and the floor are the architecture.
  - Track 2 tilt: same gates, the judged artifact is the memo "why this reply is allowed."
  - Don't build it: the category is full of helpdesk agents. Build it only if the held-send trace is the demo.
- **Assumptions.** Labelled.
  - The team will accept a fictional company. Unconfirmed.
  - Zetaris local (UI 3000, API 8888) is up before feature work. Dependency, Kristof's setup.
  - Nightshift hotspot at `http://127.0.0.1:8088/v1` may be absent on a judge machine. Sample mode is required.
  - Seeded weights will be declared as seeded. If the deck says "the model learned," that claim is false.
- **Scope reason.** 144 hours, four people, submissions close Tue 27 Oct 2026 23:45 UTC. Both versions stay until the group rules. The scoped list is the one that can be run twice inside the window. Kristof wants the H-MEM learn proof inside it.
- **Next slice.** The four sources and the 24 threads are files in `kristof/data/`. The group has not kept the brief. The ticket path is still not built. That path is IMPLEMENT, and this pane does not start it.
- **Learning.** Whether a human reject on the dashboard changes the next ticket's action. If it does not, H-MEM and the ledger are decoration.
- **Sketch.** Above. No visual prototype this turn.

## Decisions for the group

The group rules on each row. Scout does not pick. Both versions stay written until the ruling.

| Id | Diff | Full list | Scoped | Kristof's position |
|---|---|---|---|---|
| D1 | What the submission is | All 27 items, estimate 56 | The keep list, estimate 80 | Keep both written. Rule which one is built. |
| D2 | H-MEM ingest and learn | Volume: about 300 threads, a nightly job | Two runs plus a floor move. Not authored yet | Worth it. Ship the proof in either version: run A writes a memory id, run B reads it and skips a chunk, a reject moves the floor. |
| D3 | Threads | About 300 | 24 authored | Open |
| D4 | Learning mechanism | The original dump named scikit-learn | Seeded weights. Affirm and reject move the weight. No trained model | The learn proof is the memory path and the floor, not a training loop |
| D5 | Swarm | Spawn workers above 75% of average mail | Claim column only | Open |
| D6 | Gaia | Imported as a library | Web workspace only. The product does not import it | Open |
| D7 | Relay | The Windows app is a dependency | Orchestrator is code. The app is not on the judge machine | Open |
| D8 | Dashboard | Three pages | Two views, both Zetaris queries | Open |
| D9 | Privacy | A GDPR program | A 10-row scan, `python run.py --job privacy` | Open |

## Hand off

Paste this file to the team, or into a fresh planner window, when the group is ready to keep or drop it.

Do not build from this pane. Item 22 stands: IMPLEMENT starts only after the group decides.

Do not spawn BACKUP-1. Kristof dropped that role for this challenge. There is no safety-net build beside the main one.

Path: `kristof/jedi-pack-inbox.md`

This is the one round. Round files use the names in `READ_FIRST.md` (`assignment.md`, `idea.md`, `result.md`). There is no second round and no `BACKUP-1`.
