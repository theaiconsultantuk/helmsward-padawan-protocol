#!/usr/bin/env python3
"""Synthetic Jedi Pack company data generator (Task 1.1).

Everything is fictional and labelled synthetic. Deterministic from --seed:
no wall-clock, no set iteration order, seeded random only.
Run: uv run --with pyarrow python gen_company.py --out <dir> --seed 42
"""
import argparse, csv, datetime as dt, io, json, os, quopri, random, shutil
import pyarrow as pa
import pyarrow.parquet as pq

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SRC = os.path.normpath(os.path.join(HERE, "..", "..", "kristof", "data"))

FIELDS = ["thread_id", "parent_thread_id", "channel", "category", "agent_category", "sender_name",
          "sender_email", "subject", "body", "follow_up_body", "follow_up_kind", "received_at",
          "amount_usd", "may_leave", "owner_id", "backup_id", "owner_out", "outcome",
          "outcome_reason", "ledger_effect", "source_id", "fictional"]

GIVEN_A = ["Ar", "Bel", "Cor", "Dal", "El", "Fen", "Gal", "Hal", "Ive", "Jor", "Kal", "Lor", "Mer",
           "Nor", "Ol", "Per", "Quen", "Ros", "Sel", "Tar", "Ul", "Ven", "Wil", "Yor", "Zan"]
GIVEN_B = ["a", "ek", "in", "ob", "ul", "ira", "wen", "ric", "dro", "mel", "tis", "va"]
FAMILY_A = ["Ash", "Bren", "Crest", "Dray", "Elm", "Fall", "Grove", "Hart", "Ink", "Joss", "Kern",
            "Lark", "Moor", "Nash", "Oak", "Pike", "Quist", "Reed", "Stone", "Thorn", "Vale", "Wick"]
FAMILY_B = ["ton", "wood", "er", "field", "ley", "man", "son", "by", "ford", "worth"]
TEAMS = {
    "Support": ["Support Agent", "Senior Support Agent", "Support Lead"],
    "Billing": ["Billing Clerk", "Refund Analyst", "Billing Lead"],
    "Fulfilment": ["Packer", "Picker", "Dispatch Coordinator", "Warehouse Lead"],
    "Product": ["Product Specialist", "Quality Inspector", "Product Manager"],
    "Sales": ["Account Executive", "Sales Associate", "Sales Lead"],
    "Engineering": ["Developer", "Data Engineer", "Site Reliability Engineer"],
    "People": ["People Partner", "Recruiter"],
    "Finance": ["Accountant", "Finance Analyst"],
}
TEAM_NAMES = sorted(TEAMS)
PRODUCTS = ["training saber", "hilt", "kyber crystal case", "travel cloak", "utility belt", "holster",
            "padawan robe", "saber stand", "pilgrim pack", "boot set"]
FIRST = ["Aldo", "Brenna", "Cato", "Dessa", "Edric", "Fenna", "Garo", "Hale", "Isolde", "Jarek", "Kessa",
         "Lorn", "Mina", "Nolan", "Orla", "Pavo", "Quill", "Rhea", "Sorin", "Tavi", "Ulric", "Vesna",
         "Wex", "Xara", "Yoren", "Zeda"]
LAST = ["Arden", "Bright", "Calloway", "Dunmore", "Ember", "Fairlow", "Grimsby", "Holloway", "Ivers",
        "Jessop", "Kestrel", "Lowell", "Marlow", "Northam", "Ostler", "Pembry", "Quarry", "Rowan",
        "Slate", "Tarn", "Umber", "Vance", "Wren", "Yarrow"]
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def read_bytes(p):
    with open(p, "rb") as f:
        return f.read()


def write_bytes(p, data):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "wb") as f:
        f.write(data)


def write_text(p, s):
    write_bytes(p, s.encode("utf-8"))


def read_csv(p):
    with open(p, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def jarray(objs):
    return json.dumps(list(objs), ensure_ascii=False, indent=2) + "\n"


def jline(obj):
    return json.dumps(obj, ensure_ascii=False)


def gen_employees(src, rng):
    orig = read_csv(os.path.join(src, "employees.csv"))
    rows = []
    used_emails = set()
    for r in orig:
        team = TEAM_NAMES[int(r["employee_id"]) % len(TEAM_NAMES)]
        rows.append([r["employee_id"], r["given_name"], r["family_name"], r["email"], team,
                     rng.choice(TEAMS[team]), "%.2f" % rng.uniform(0.40, 0.90)])
        used_emails.add(r["email"])
    names = set((r["given_name"], r["family_name"]) for r in orig)
    nid = len(orig) + 1
    while nid <= 200:
        g = rng.choice(GIVEN_A) + rng.choice(GIVEN_B)
        f = rng.choice(FAMILY_A) + rng.choice(FAMILY_B)
        if (g, f) in names:
            continue
        names.add((g, f))
        email = "%s.%s@jedipack.example" % (g.lower(), f.lower())
        used_emails.add(email)
        team = rng.choice(TEAM_NAMES)
        rows.append([str(nid), g, f, email, team, rng.choice(TEAMS[team]), "%.2f" % rng.uniform(0.40, 0.90)])
        nid += 1
    head = "employee_id,given_name,family_name,email,team,role,trust_weight_seed"
    return head, rows


def weekdays(year):
    d = dt.date(year, 1, 1)
    out = []
    while d.year == year:
        if d.weekday() < 5:
            out.append(d)
        d += dt.timedelta(days=1)
    return out


def gen_holidays(src, rng, protected):
    """Original bytes first; then generated vacation rows for employees NOT in protected
    (the authored owner/backup pairs), so authored availability is never changed."""
    raw = read_bytes(os.path.join(src, "holiday-2026.csv"))
    days = weekdays(2026)
    out = []
    for emp in range(21, 201):
        for d in sorted(rng.sample(days, 4)):
            out.append("%d,%s,vacation," % (emp, d.isoformat()))
    extra = "".join(l + "\r\n" for l in out).encode("utf-8")
    return raw + extra, len(raw.decode("utf-8").splitlines()) - 1 + len(out)


def person(rng):
    return rng.choice(FIRST), rng.choice(LAST)


TEMPLATES = {
    "refund": [
        ("Refund for order JP-{o}", "Please refund order JP-{o}. The {p} was not what I ordered. The charge was {a} USD."),
        ("Money back for my {p}", "I want my money back for order JP-{o}. The {p} never fit. I paid {a} USD."),
        ("Refund request JP-{o}", "Order JP-{o} was a mistake on my side. Could I get a refund of {a} USD for the {p}?"),
    ],
    "complaint": [
        ("Box arrived crushed", "My {p} arrived in a crushed box and the courier left it outside. Order JP-{o}. Please have a person look at this."),
        ("Slow answers from support", "I wrote twice about order JP-{o} and nobody answered. This is not good enough."),
        ("Listing does not match", "The photo of the {p} does not match what I received in order JP-{o}."),
    ],
    "question": [
        ("How long does shipping take", "How many days from order to delivery for a {p}?"),
        ("Do you ship to my region", "Can a {p} be sent to a post box? I could not find it on the site."),
        ("Care for my {p}", "How should I clean the {p} after a long day of training?"),
    ],
    "appreciation": [
        ("Love the {p}", "The {p} is wonderful and fits well. No question, just wanted you to know."),
        ("Thank you", "Order JP-{o} arrived early and the {p} is great. Thank you to the packers."),
    ],
    "other": [
        ("Are you hiring", "Are you hiring a packer? This is not an order."),
        ("Partnership idea", "I run a small fan club and would like to talk about a bulk visit. This is not an order."),
        ("Wrong inbox maybe", "I am looking for the cantina next door. Sorry if this reached you by mistake."),
    ],
}
CH_SUBJ_STARS = {"complaint": (1, 2), "refund": (2, 3), "question": (3, 4), "appreciation": (5, 5), "other": (3, 3)}


def rfc_date(ts):
    d = dt.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ")
    return "%s, %02d %s %d %02d:%02d:%02d +0000" % (DAYS[d.weekday()], d.day, MONTHS[d.month - 1], d.year, d.hour, d.minute, d.second)


def eml(t):
    body = quopri.encodestring(t["body"].encode("utf-8")).decode("ascii")
    head = ("From: %s <%s>\nTo: inbox@jedipack.com\nSubject: %s\nDate: %s\nMessage-ID: <%s@example.com>\n"
            "Content-Type: text/plain; charset=\"utf-8\"\nContent-Transfer-Encoding: quoted-printable\n"
            "MIME-Version: 1.0\n\n") % (t["sender_name"], t["sender_email"], t["subject"], rfc_date(t["received_at"]), t["thread_id"])
    return head + body


FAQ = [
    ("Q01", "How long does shipping take?",
     "Shipping time depends on your region and the product. Your order confirmation shows the estimate for your address, and customer service can tell you where your order is.",
     "shipping delivery time long arrive ship days", "authored"),
    ("Q02", "Which regions do you ship to, and do you ship to post boxes?",
     "We ship to most regions. Some remote regions and post boxes cannot take a courier delivery, so give a street address where you can. Customer service confirms your region before the order ships.",
     "regions region country countries post box pobox ship international", "authored"),
    ("Q03", "How do I care for my gear?",
     "Wipe it with a soft dry cloth, keep it out of long direct sun, and store it in its case or bag. Do not use solvents on the hilt or the crystal case.",
     "care clean cleaning wash maintain store storage", "authored"),
    ("Q04", "How long is the warranty?",
     "Every product carries a warranty against manufacturing faults. The length is stated on your order confirmation, and a faulty item is handled as a replacement, not a refund.",
     "warranty guarantee fault faulty defect length covered", "wiki/replacement-policy.md"),
    ("Q05", "Which colours do you ship?",
     "The colours shown on each product page are the colours we ship. If a colour is not shown, it is not in stock, and customer service can tell you if it is coming back.",
     "colour colours color colors shade available stock", "authored"),
    ("Q06", "Do you sell stands for the sabers?",
     "Yes, the saber stand is in our product list, and it fits the training saber and the hilt.",
     "stand stands display holder saber hilt", "products.csv"),
    ("Q07", "Can you engrave my gear?",
     "Engraving is not offered at the moment. Customer service can note a request, but we do not promise it.",
     "engrave engraving engraved personalise personalize name custom", "authored"),
    ("Q08", "What is your returns and refund policy?",
     "A refund at or under 150 USD can be approved by our refund owner. Above 150 USD it goes to the manager. A replacement is not a refund. Write to us with your order reference.",
     "return returns refund refunds money back policy", "wiki/refund-policy.md"),
    ("Q09", "Where is my order?",
     "Send us your order reference and customer service will check its status and reply to you. We never ask for a card number.",
     "order status track tracking where parcel package reference", "wiki/what-may-leave.md"),
    ("Q10", "Which payment methods do you accept?",
     "We accept the payment methods shown at checkout. We never ask for a card number by email or chat.",
     "payment pay payments card methods checkout invoice", "wiki/what-may-leave.md"),
    ("Q11", "Do you offer gift wrapping?",
     "Gift wrapping is not offered at the moment. Customer service can add a gift note to the order.",
     "gift wrapping wrap present note", "authored"),
    ("Q12", "Can I place a bulk order?",
     "Yes. Sales quotes bulk orders: tell us the product and the quantity and sales will reply with a quote.",
     "bulk order quote quotes wholesale quantity volume units", "authored"),
]


def gen_only(out, a):
    """--only: write just the named files and refresh their sources.json rows; nothing else is touched."""
    only = {x.strip() for x in a.only.split(",") if x.strip()}
    bad = only - {"products", "faq", "responsibility"}
    if bad:
        raise SystemExit("unknown --only: %s" % ",".join(sorted(bad)))
    if not os.path.isdir(out):
        raise SystemExit("--only needs an existing --out (no rmtree)")
    rng2 = random.Random(a.seed + 1)
    counts = {}
    if "products" in only:
        prices = [29, 39, 49, 59, 79, 99, 119, 149, 189, 249]
        rng2.shuffle(prices)
        rows = ["product_id,name,unit_price_usd,currency,min_order_qty,lead_days\n"]
        for i, (n, pr) in enumerate(zip(PRODUCTS, prices), 1):
            rows.append("P%02d,%s,%d,USD,1,%d\n" % (i, n, pr, rng2.randint(3, 14)))
        write_text(os.path.join(out, "products.csv"), "".join(rows))
        counts["products"] = len(rows) - 1
    if "faq" in only:
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(["faq_id", "question", "answer", "keywords", "source"])
        for r in FAQ:
            w.writerow(r)
        write_text(os.path.join(out, "faq.csv"), buf.getvalue())
        counts["faq"] = len(FAQ)
    if "responsibility" in only:
        p = os.path.join(out, "responsibility.csv")
        txt = read_bytes(p).decode()
        have = {r["topic"] for r in read_csv(p)}
        if not txt.endswith("\r\n"):
            txt += "\r\n"
        for line in ["rfq,6,14", "customer_service,7,15"]:
            if line.split(",")[0] not in have:
                txt += line + "\r\n"
        write_text(p, txt)
        counts["responsibility"] = len(read_csv(p))
    sp = os.path.join(os.path.dirname(out), "sources.json")
    sj = json.load(open(sp))
    by = {s["name"]: s for s in sj["sources"]}
    def ent(name, path, table, rows):
        return {"name": name, "path": path, "format": "CSV", "table": table, "database": "JEDI_PACK",
                "options": {"header": "true"}, "licence": "synthetic, CC0", "rows": rows}
    # The intake table is written by the service with doubled quotes and embedded newlines (decisions.q):
    # Spark's CSV reader escapes with a backslash by default, so the table says escape + multiLine.
    runtime_opts = {"header": "true", "escape": "\"", "multiLine": "true"}
    new = {"products": ent("products", "products.csv", "products", counts.get("products", 0)),
           "faq": ent("faq", "faq.csv", "faq", counts.get("faq", 0)),
           "intake_runtime": {**ent("intake_runtime", "runtime/intake.csv", "intake_runtime", 0),
                              "options": runtime_opts, "licence": "runtime, written by the service", "runtime": True}}
    for k, e in new.items():
        if k == "intake_runtime" or k in only:
            if k in by:
                by[k]["rows"] = e["rows"]
            else:
                sj["sources"].append(e)
    if "responsibility" in only:
        by["responsibility"]["rows"] = counts["responsibility"]
    write_text(sp, json.dumps(sj, indent=2) + "\n")
    print("wrote (only)", out, counts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--src", default=DEFAULT_SRC)
    ap.add_argument("--only", default="", help="comma list of products,faq,responsibility: write only those files, keep the rest")
    a = ap.parse_args()
    out, src = os.path.abspath(a.out), os.path.abspath(a.src)
    if a.only:
        return gen_only(out, a)
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(out)
    rng = random.Random(a.seed)
    counts = {}

    # employees
    head, erows = gen_employees(src, rng)
    write_text(os.path.join(out, "employees.csv"), head + "\n" + "".join(",".join(r) + "\n" for r in erows))
    counts["employees.csv"] = len(erows)

    # unchanged copies
    for n in ["responsibility.csv", "policy.csv", "categories.csv", "trust-ledger.csv", "automation-matrix.xml"]:
        write_bytes(os.path.join(out, n), read_bytes(os.path.join(src, n)))
    counts["responsibility.csv"] = len(read_csv(os.path.join(src, "responsibility.csv")))
    counts["policy.csv"] = len(read_csv(os.path.join(src, "policy.csv")))
    counts["categories.csv"] = len(read_csv(os.path.join(src, "categories.csv")))
    counts["trust-ledger.csv"] = len(read_csv(os.path.join(src, "trust-ledger.csv")))
    counts["automation-matrix.xml"] = read_bytes(os.path.join(src, "automation-matrix.xml")).decode().count("<category ")

    # holidays
    protected = {1, 2, 3, 4, 5, 6, 8, 9, 15, 16}
    hol, hn = gen_holidays(src, rng, protected)
    write_bytes(os.path.join(out, "holiday-2026.csv"), hol)
    counts["holiday-2026.csv"] = hn
    absent = set()
    for r in read_csv(os.path.join(out, "holiday-2026.csv")):
        if r["employee_id"]:
            absent.add((int(r["employee_id"]), r["date"]))

    # wiki
    for n in ["refund-policy.md", "replacement-policy.md", "what-may-leave.md"]:
        s = read_bytes(os.path.join(src, "wiki", n)).decode("utf-8")
        if not s.startswith("---"):
            title = n[:-3].replace("-", " ").capitalize()
            s = ('---\ntitle: "%s"\ndescription: "Synthetic Jedi Pack Inc policy page."\ndate: 2026-10-23\n'
                 'tags: [policy, synthetic]\n---\n\n' % title) + s
        write_text(os.path.join(out, "wiki", n), s)
        counts["wiki/" + n] = len(s.splitlines())

    # threads
    pol = read_csv(os.path.join(src, "policy.csv"))[0]
    limit = float(pol["limit_amount"])
    resp = {r["topic"]: r for r in read_csv(os.path.join(src, "responsibility.csv"))}
    cats = [r["category"] for r in read_csv(os.path.join(src, "categories.csv"))]
    cat_w = {"complaint": 25, "refund": 30, "question": 25, "appreciation": 12, "other": 8}
    weights = [cat_w.get(c, 5) for c in cats]
    ch_pick = ["email"] * 9 + ["contact-form"] * 6 + ["trustpilot"] * 5
    stamps = sorted(
        "2026-10-%02d" % rng.randint(1, 31) + "T%02d:%02d:00Z" % (rng.randint(8, 17), rng.randint(0, 59))
        for _ in range(76))
    authored = read_bytes(os.path.join(src, "threads", "threads.jsonl")).decode("utf-8").splitlines(keepends=True)
    assert len(authored) == 24
    gen = []
    for i in range(76):
        tid = "T%d" % (25 + i)
        cat = rng.choices(cats, weights)[0]
        ch = rng.choice(ch_pick)
        g, f = person(rng)
        order = rng.randint(1200, 1999)
        prod = rng.choice(PRODUCTS)
        amount = None
        if cat == "refund":
            if rng.random() < 0.55:
                amount = float(rng.choice([15, 25, 35, 40, 55, 70, 90, 110, 125, 145, 150]))
            else:
                amount = float(rng.choice([160, 180, 220, 260, 320, 400, 480, 650]))
        subj_t, body_t = rng.choice(TEMPLATES[cat])
        astr = "%.2f" % amount if amount is not None else ""
        subject = subj_t.format(o=order, p=prod, a=astr)
        body = body_t.format(o=order, p=prod, a=astr)
        topic = cat if cat in resp else None
        if cat == "refund":
            if amount <= limit:
                owner, backup = int(pol["under_limit_owner_id"]), int(pol["under_limit_backup_id"])
            else:
                owner, backup = int(pol["over_limit_owner_id"]), int(pol["over_limit_backup_id"])
        elif topic:
            owner, backup = int(resp[topic]["owner_id"]), int(resp[topic]["backup_id"])
        else:
            owner = backup = None
        date = stamps[i][:10]
        gen.append({
            "thread_id": tid, "parent_thread_id": "", "channel": ch, "category": cat, "agent_category": "",
            "sender_name": "%s %s" % (g, f), "sender_email": "%s.%s%d@example.com" % (g.lower(), f.lower(), i + 1),
            "subject": subject, "body": body, "follow_up_body": "", "follow_up_kind": "",
            "received_at": stamps[i], "amount_usd": amount,
            # Every generated ticket may be answered: no template asks for a card number, a staff price list or a staff home address
            # (what-may-leave.md). Until 24 Oct this read "refund within the limit", so 64 of the 76 generated threads held as
            # data-block and T27, an over-limit refund, held instead of escalating (Paul, 24 Oct). Only authored threads carry false.
            "may_leave": True, "owner_id": owner, "backup_id": backup,
            "owner_out": bool(owner is not None and (owner, date) in absent),
            "outcome": "", "outcome_reason": "", "ledger_effect": "", "source_id": "synthetic-" + tid,
            "fictional": True})
    for t in gen:
        assert list(t) == FIELDS
    tj = "".join(authored) + "".join(jline(t) + "\n" for t in gen)
    write_text(os.path.join(out, "threads", "threads.jsonl"), tj)
    counts["threads/threads.jsonl"] = 100
    allrows = [json.loads(l) for l in authored] + gen
    # Zetaris FILESTORE JSON reads one document per file: arrays + multiLine "true" give every record.
    write_text(os.path.join(out, "threads", "threads.json"), jarray(allrows))
    counts["threads/threads.json"] = 100
    cols = {}
    for k in FIELDS:
        vals = [r[k] for r in allrows]
        if k == "amount_usd":
            cols[k] = pa.array(vals, type=pa.float64())
        elif k in ("may_leave", "owner_out", "fictional"):
            cols[k] = pa.array(vals, type=pa.bool_())
        elif k in ("owner_id", "backup_id"):
            cols[k] = pa.array(vals, type=pa.int64())
        else:
            cols[k] = pa.array(["" if v is None else str(v) for v in vals], type=pa.string())
    pq.write_table(pa.table(cols), os.path.join(out, "threads", "threads.parquet"), compression="snappy")
    counts["threads/threads.parquet"] = 100

    # intakes
    for n in sorted(os.listdir(os.path.join(src, "intakes", "email"))):
        write_bytes(os.path.join(out, "intakes", "email", n), read_bytes(os.path.join(src, "intakes", "email", n)))
    for t in gen:
        if t["channel"] == "email":
            write_text(os.path.join(out, "intakes", "email", t["thread_id"] + ".eml"), eml(t))
    cf = json.load(open(os.path.join(src, "intakes", "contact-form", "submissions.json"), encoding="utf-8"))
    for t in gen:
        if t["channel"] == "contact-form":
            cf.append({"submission_id": "CF-" + t["thread_id"], "thread_id": t["thread_id"],
                       "received_at": t["received_at"], "name": t["sender_name"], "email": t["sender_email"],
                       "subject": t["subject"], "message": t["body"], "fictional": True})
    write_text(os.path.join(out, "intakes", "contact-form", "submissions.json"), jarray(cf))
    counts["intakes/contact-form/submissions.json"] = len(cf)
    tp = json.load(open(os.path.join(src, "intakes", "trustpilot", "reviews.json"), encoding="utf-8"))
    for t in gen:
        if t["channel"] == "trustpilot":
            lo, hi = CH_SUBJ_STARS[t["category"]]
            tp.append({"review_id": "TP-" + t["thread_id"], "thread_id": t["thread_id"],
                       "created_at": t["received_at"], "reviewer_name": t["sender_name"],
                       "stars": rng.randint(lo, hi), "title": t["subject"], "text": t["body"],
                       "source": "fictional", "live_api": False})
    write_text(os.path.join(out, "intakes", "trustpilot", "reviews.json"), jarray(tp))
    counts["intakes/trustpilot/reviews.json"] = len(tp)

    # notes
    notes = """Jedi Pack Inc escalation notes (synthetic, fictional company)
1. These notes are a synthetic runbook. Nothing here describes a real business.
2. Refunds at or under 150.00 USD go to employee 15, backup employee 16.
3. Refunds above 150.00 USD go to employee 3, backup employee 4.
4. Replacements go to employee 8, backup employee 9.
5. Complaints go to employee 5, backup employee 6.
6. Questions go to employee 1, backup employee 2.
7. Check who is out on the day the message was received, not on the day you read it.
8. If the owner is out and the backup is in, hold the draft for the backup.
9. If both are out, escalate to the manager, employee 3.
10. Never promise a refund the customer did not ask for.
11. A replacement is not a refund.
12. Appreciation messages may be answered without a person once trust passes the floor of 0.80.
13. Order numbers and customer names may stay in the reply to that customer only.
14. Internal employee ids and trust weights never leave the company.
15. If a customer says you misread them, withdraw the earlier promise and escalate.
16. Public reviews get a calm reply or a hold, never an argument.
17. Log every decision with its reason so the next person can follow it.
18. When unsure, hold and ask a person.
19. Update the wiki pages when a rule changes.
20. End of notes.
"""
    write_text(os.path.join(out, "notes", "escalation-notes.txt"), notes)
    counts["notes/escalation-notes.txt"] = 20

    # sources.json goes next to the synthetic dir
    def src_(name, path, fmt, table, opts, rows):
        return {"name": name, "path": path, "format": fmt, "table": table, "database": "JEDI_PACK",
                "options": opts, "licence": "synthetic, CC0", "rows": rows}
    C, J = {"header": "true"}, {"multiLine": "true"}
    S = [
        src_("employees", "employees.csv", "CSV", "employees", C, counts["employees.csv"]),
        src_("holiday_2026", "holiday-2026.csv", "CSV", "holiday_2026", C, counts["holiday-2026.csv"]),
        src_("responsibility", "responsibility.csv", "CSV", "responsibility", C, counts["responsibility.csv"]),
        src_("policy", "policy.csv", "CSV", "policy", C, counts["policy.csv"]),
        src_("categories", "categories.csv", "CSV", "categories", C, counts["categories.csv"]),
        src_("trust_ledger", "trust-ledger.csv", "CSV", "trust_ledger", C, counts["trust-ledger.csv"]),
        src_("automation_matrix", "automation-matrix.xml", "XML", "automation_matrix", {"rowTag": "category"}, counts["automation-matrix.xml"]),
        src_("wiki_refund_policy", "wiki/refund-policy.md", "MARKDOWN", "wiki_refund_policy", {}, counts["wiki/refund-policy.md"]),
        src_("wiki_replacement_policy", "wiki/replacement-policy.md", "MARKDOWN", "wiki_replacement_policy", {}, counts["wiki/replacement-policy.md"]),
        src_("wiki_what_may_leave", "wiki/what-may-leave.md", "MARKDOWN", "wiki_what_may_leave", {}, counts["wiki/what-may-leave.md"]),
        src_("threads_json", "threads/threads.json", "JSON", "threads_json", J, 100),
        src_("threads_parquet", "threads/threads.parquet", "PARQUET", "threads_parquet", {}, 100),
        src_("contact_form_submissions", "intakes/contact-form/submissions.json", "JSON", "contact_form_submissions", J, len(cf)),
        src_("trustpilot_reviews", "intakes/trustpilot/reviews.json", "JSON", "trustpilot_reviews", J, len(tp)),
        src_("escalation_notes", "notes/escalation-notes.txt", "TEXT", "escalation_notes", {}, 20),
    ]
    sj = {"synthetic": True, "generated_by": "scripts/gen_company.py --seed %d" % a.seed, "sources": S}
    # sources.json lives in the parent of the synthetic dir (data/)
    write_text(os.path.join(os.path.dirname(out), "sources.json") if os.path.basename(out) == "synthetic"
               else os.path.join(out, "..", os.path.basename(out) + "-sources.json"),
               json.dumps(sj, indent=2) + "\n")
    print("wrote", out, counts)


if __name__ == "__main__":
    main()
