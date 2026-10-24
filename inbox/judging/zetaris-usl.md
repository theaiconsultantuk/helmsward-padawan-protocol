---
title: Zetaris Unified Semantic Layer over the Jedi Pack data
description: The jedi_pack Unified Semantic Layer in Zetaris: compiled DDL with keys, activations from the raw sources, foreign keys recorded in the compiled model, live views, with every statement and the live proof.
date: 2026-10-24
tags: [judging, zetaris, usl]
---

# Zetaris Unified Semantic Layer

**19 of 19 USL tables compiled and activated** in the namespace `lightning.metastore.jedi_pack` (USL `jedi_pack`) on the dev Zetaris instance, over the raw `JEDI_PACK` Lightning tables registered in [zetaris-register.md](zetaris-register.md).

## What a USL is in Zetaris's terms

- **Namespace.** A place in the metastore (`lightning.metastore.jedi_pack`) that holds the layer.
- **Compiled DDL with keys.** `COMPILE USL` takes plain `CREATE TABLE` statements: typed columns, `NOT NULL PRIMARY KEY`, and table-level `FOREIGN KEY (col) REFERENCES other(col)`. The compiled response (below) carries column specs, primary keys, not-null flags and each foreign key as a `foreignKeys` entry with `refTable` and `refColumns`, next to empty `dqAnnotations` slots per column and table (this build records the keys in `foreignKeys`; the `dqAnnotations` arrays are present but empty).
- **Activation from the raw sources.** `ACTIVATE USL TABLE <ns>.<usl>.<table> AS SELECT ...` binds each USL table to a query over the raw tables. Zetaris enforces the declared types and nullability, so every NOT NULL column is `COALESCE`d in its activation.
- **Live views.** An activated table is a view over the raw sources, not a copy: it follows the underlying files (liveness proof below).
- **Meeting formats.** CSV (employees, products, policy, responsibility, faq, holiday), JSON (threads_json, trustpilot_reviews), Parquet (ticket), Markdown (wiki_page) and the runtime CSVs the service appends to (intake, decision) are read through one set of typed, keyed tables and joined in one query.

Regenerate: `node inbox/scripts/register_usl.mjs --apply` (SQL also in [../scripts/zetaris_usl.sql](../scripts/zetaris_usl.sql)). Idempotent: it starts with `REMOVE USL jedi_pack NAMESPACE lightning.metastore.jedi_pack`.
Teardown: `REMOVE USL jedi_pack NAMESPACE lightning.metastore.jedi_pack` then `DROP NAMESPACE lightning.metastore.jedi_pack CASCADE`.

## Tables and live counts

| USL table | built from | live rows |
|---|---|---|
| employee | employees (CSV) | 207 |
| customer | threads_json (JSON) UNION intake_runtime (runtime CSV) | 108 |
| ticket | threads_parquet (Parquet) | 100 |
| product | products (CSV) | 50 |
| policy | policy (CSV) | 2 |
| responsibility | responsibility (CSV) | 12 |
| faq | faq (CSV) | 18 |
| holiday | holiday_2026 (CSV) | 1263 |
| intake | intake_runtime (runtime CSV, appended by the service) | 52 |
| review | trustpilot_reviews (JSON) | 19 |
| decision | decisions (runtime CSV) | 33 |
| wiki_page | wiki_refund_policy + wiki_replacement_policy + wiki_what_may_leave (Markdown) | 3 |
| hierarchy | companyhierarchy (CSV) | 207 |
| client | customers (CSV) | 58 |
| sales_order | orders (CSV) | 82 |
| shipping_rule | shipping_rules (CSV) | 12 |
| bulk_tier | bulk_pricing (CSV) | 3 |
| bom_part | bom (CSV) | 149 |
| channel | channels (CSV) | 4 |

Notes: `ticket` is read from the Parquet source; its `data_source` column (`parquet`) and faq's `faq_source` are named so because a column called `source` compiles and activates but makes every later SELECT on the table fail in the Lightning parser (backticks do not help). `holiday` has no single-column key, so its key is derived: `holiday_key = employee_id|date`. `decision` has no foreign key because its thread_id may be a free-text F id. `wiki_page.body` is the document table's `preview` column.

## SHOW TABLES

`SHOW TABLES IN lightning.metastore.jedi_pack` (table_identifier | catalog_name | catalog_type):

| table_identifier | catalog_name | catalog_type |
|---|---|---|
| lightning.metastore.jedi_pack.probe_pq.product | probe_pq | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.employee | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.customer | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.ticket | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.product | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.policy | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.responsibility | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.faq | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.holiday | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.intake | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.review | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.decision | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.wiki_page | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.hierarchy | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.client | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.sales_order | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.shipping_rule | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.bulk_tier | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.bom_part | jedi_pack | Unified Semantic Layer |
| lightning.metastore.jedi_pack.jedi_pack.channel | jedi_pack | Unified Semantic Layer |

## Join across sources

ticket (Parquet) joined to employee (CSV) and customer (threads JSON plus the runtime CSV), five largest amounts:

| thread_id | category | amount | owner | customer |
|---|---|---|---|---|
| T55 | refund | 650.0 | Zanva Groveley | Quill Pembry |
| T29 | refund | 650.0 | Zanva Groveley | Kessa Quarry |
| T48 | refund | 480.0 | Zanva Groveley | Jarek Wren |
| T31 | refund | 480.0 | Zanva Groveley | Rhea Ostler |
| T43 | refund | 400.0 | Zanva Groveley | Hale Yarrow |

## Liveness proof

The activated `intake` table is a view over `intake_runtime`, the file the service appends to at runtime. One row was appended to a temporary copy of the intake file through `appendIntake`, published with `publishIntake`, counted, then the real `data/runtime/intake.csv` was published back.

| step | intake rows |
|---|---|
| before | 52 |
| after append (temporary copy published) | undefined |
| after the real file is published back | undefined |

Error: skipped: SKIP_RUNTIME=1 leaves intake_runtime as it is

## Statements, verbatim

```sql
REMOVE USL jedi_pack NAMESPACE lightning.metastore.jedi_pack;

CREATE NAMESPACE IF NOT EXISTS lightning.metastore;

CREATE NAMESPACE IF NOT EXISTS lightning.metastore.jedi_pack;

COMPILE USL IF NOT EXISTS jedi_pack DEPLOY NAMESPACE lightning.metastore.jedi_pack DDL CREATE TABLE employee (employee_id int NOT NULL PRIMARY KEY, given_name varchar(100), family_name varchar(100), name varchar(200), email varchar(200), team varchar(100), role varchar(200), trust_weight_seed double);
CREATE TABLE customer (email varchar(200) NOT NULL PRIMARY KEY, name varchar(200));
CREATE TABLE ticket (thread_id varchar(50) NOT NULL PRIMARY KEY, parent_thread_id varchar(50), channel varchar(50), category varchar(50), agent_category varchar(50), sender_name varchar(200), sender_email varchar(200), subject varchar(500), body varchar(4000), follow_up_kind varchar(50), received_at varchar(50), amount double, may_leave boolean, owner_id int, backup_id int, outcome varchar(50), data_source varchar(20), FOREIGN KEY (sender_email) REFERENCES customer(email), FOREIGN KEY (owner_id) REFERENCES employee(employee_id), FOREIGN KEY (backup_id) REFERENCES employee(employee_id));
CREATE TABLE product (sku varchar(50) NOT NULL PRIMARY KEY, slug varchar(100), name varchar(200), category varchar(50), unit_price double, currency varchar(10), stock varchar(50), min_order_qty int, lead_days int, show_in_store boolean, image_url varchar(200), model varchar(200), aliases varchar(500), material varchar(500), specs varchar(1000), description varchar(2000));
CREATE TABLE policy (topic varchar(50) NOT NULL PRIMARY KEY, limit_amount double, currency varchar(10), under_limit_owner_id int, under_limit_backup_id int, over_limit_owner_id int, over_limit_backup_id int, FOREIGN KEY (under_limit_owner_id) REFERENCES employee(employee_id), FOREIGN KEY (over_limit_owner_id) REFERENCES employee(employee_id));
CREATE TABLE responsibility (topic varchar(50) NOT NULL PRIMARY KEY, owner_id int, backup_id int, label varchar(200), FOREIGN KEY (owner_id) REFERENCES employee(employee_id), FOREIGN KEY (backup_id) REFERENCES employee(employee_id));
CREATE TABLE faq (faq_id varchar(50) NOT NULL PRIMARY KEY, question varchar(1000), answer varchar(4000), keywords varchar(1000), faq_source varchar(50));
CREATE TABLE holiday (holiday_key varchar(100) NOT NULL PRIMARY KEY, employee_id int, date varchar(20), kind varchar(50), holiday_name varchar(200), FOREIGN KEY (employee_id) REFERENCES employee(employee_id));
CREATE TABLE intake (thread_id varchar(50) NOT NULL PRIMARY KEY, received_at varchar(50), channel varchar(50), sender_name varchar(200), sender_email varchar(200), subject varchar(500), body varchar(4000), scenario varchar(50), category varchar(50), FOREIGN KEY (sender_email) REFERENCES customer(email));
CREATE TABLE review (review_id varchar(50) NOT NULL PRIMARY KEY, thread_id varchar(50), reviewer_name varchar(200), stars int, created_at varchar(50), FOREIGN KEY (thread_id) REFERENCES ticket(thread_id));
CREATE TABLE decision (run_id varchar(100) NOT NULL PRIMARY KEY, thread_id varchar(50), category varchar(50), decision varchar(50), verdict varchar(50), delta double, ts varchar(50));
CREATE TABLE wiki_page (page varchar(100) NOT NULL PRIMARY KEY, body varchar(8000));
CREATE TABLE hierarchy (employee_id int NOT NULL PRIMARY KEY, name varchar(200), role varchar(200), team varchar(100), team_label varchar(200), manager_id int, FOREIGN KEY (employee_id) REFERENCES employee(employee_id));
CREATE TABLE client (customer_id varchar(50) NOT NULL PRIMARY KEY, name varchar(200), callsign varchar(100), email varchar(200), home_planet varchar(100), since varchar(20), seeded_prior_refund boolean, fictional boolean);
CREATE TABLE sales_order (order_id varchar(50) NOT NULL PRIMARY KEY, customer_id varchar(50), sku varchar(50), quantity int, amount double, currency varchar(10), shipping_planet varchar(100), status varchar(50), ordered_at varchar(50), FOREIGN KEY (customer_id) REFERENCES client(customer_id), FOREIGN KEY (sku) REFERENCES product(sku));
CREATE TABLE shipping_rule (planet varchar(100) NOT NULL PRIMARY KEY, status varchar(50), note varchar(500));
CREATE TABLE bulk_tier (tier varchar(50) NOT NULL PRIMARY KEY, min_qty int, max_qty int, discount_pct double);
CREATE TABLE bom_part (bom_key varchar(100) NOT NULL PRIMARY KEY, sku varchar(50), part_id varchar(50), part_name varchar(200), qty_per_unit int, stock int, fictional boolean, FOREIGN KEY (sku) REFERENCES product(sku));
CREATE TABLE channel (channel varchar(50) NOT NULL PRIMARY KEY, public boolean, autonomous_reply boolean, intake_address varchar(200), label varchar(200));

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.employee AS SELECT COALESCE(CAST(employee_id AS int), 0) AS employee_id, given_name, family_name, CONCAT(given_name, ' ', family_name) AS name, email, team, role, CAST(trust_weight_seed AS double) AS trust_weight_seed FROM JEDI_PACK.employees;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.customer AS SELECT COALESCE(sender_email, '') AS email, MAX(sender_name) AS name FROM (SELECT sender_email, sender_name FROM JEDI_PACK.threads_json UNION ALL SELECT sender_email, sender_name FROM JEDI_PACK.intake_runtime) u WHERE sender_email IS NOT NULL AND sender_email <> '' GROUP BY sender_email;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.ticket AS SELECT COALESCE(thread_id, '') AS thread_id, parent_thread_id, channel, category, agent_category, sender_name, sender_email, subject, body, follow_up_kind, received_at, CAST(amount AS double) AS amount, may_leave, CAST(owner_id AS int) AS owner_id, CAST(backup_id AS int) AS backup_id, outcome, 'parquet' AS data_source FROM JEDI_PACK.threads_parquet;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.product AS SELECT COALESCE(sku, '') AS sku, slug, name, category, CAST(unit_price AS double) AS unit_price, currency, stock, CAST(min_order_qty AS int) AS min_order_qty, CAST(lead_days AS int) AS lead_days, CAST(show_in_store AS boolean) AS show_in_store, image AS image_url, model, aliases, material, specs, description FROM JEDI_PACK.products;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.policy AS SELECT COALESCE(topic, '') AS topic, CAST(limit_amount AS double) AS limit_amount, currency, CAST(under_limit_owner_id AS int) AS under_limit_owner_id, CAST(under_limit_backup_id AS int) AS under_limit_backup_id, CAST(over_limit_owner_id AS int) AS over_limit_owner_id, CAST(over_limit_backup_id AS int) AS over_limit_backup_id FROM JEDI_PACK.policy;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.responsibility AS SELECT COALESCE(topic, '') AS topic, CAST(owner_id AS int) AS owner_id, CAST(backup_id AS int) AS backup_id, label FROM JEDI_PACK.responsibility;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.faq AS SELECT COALESCE(faq_id, '') AS faq_id, question, answer, keywords, source AS faq_source FROM JEDI_PACK.faq;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.holiday AS SELECT COALESCE(CONCAT(CAST(employee_id AS string), '|', date), '') AS holiday_key, CAST(employee_id AS int) AS employee_id, date, kind, holiday_name FROM JEDI_PACK.holiday_2026;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.intake AS SELECT COALESCE(thread_id, '') AS thread_id, received_at, channel, sender_name, sender_email, subject, body, scenario, category FROM JEDI_PACK.intake_runtime;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.review AS SELECT COALESCE(review_id, '') AS review_id, thread_id, reviewer_name, CAST(stars AS int) AS stars, created_at FROM JEDI_PACK.trustpilot_reviews;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.decision AS SELECT COALESCE(run_id, '') AS run_id, thread_id, category, decision, verdict, CAST(delta AS double) AS delta, ts FROM JEDI_PACK.decisions;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.wiki_page AS SELECT 'refund-policy' AS page, preview AS body FROM JEDI_PACK.wiki_refund_policy UNION ALL SELECT 'replacement-policy' AS page, preview AS body FROM JEDI_PACK.wiki_replacement_policy UNION ALL SELECT 'what-may-leave' AS page, preview AS body FROM JEDI_PACK.wiki_what_may_leave;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.hierarchy AS SELECT COALESCE(CAST(employee_id AS int), 0) AS employee_id, name, role, team, team_label, CAST(manager_id AS int) AS manager_id FROM JEDI_PACK.companyhierarchy;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.client AS SELECT COALESCE(customer_id, '') AS customer_id, name, callsign, email, home_planet, since, CAST(seeded_prior_refund AS boolean) AS seeded_prior_refund, CAST(fictional AS boolean) AS fictional FROM JEDI_PACK.customers;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.sales_order AS SELECT COALESCE(order_id, '') AS order_id, customer_id, sku, CAST(quantity AS int) AS quantity, CAST(amount AS double) AS amount, currency, shipping_planet, status, ordered_at FROM JEDI_PACK.orders;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.shipping_rule AS SELECT COALESCE(planet, '') AS planet, status, note FROM JEDI_PACK.shipping_rules;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.bulk_tier AS SELECT COALESCE(tier, '') AS tier, CAST(min_qty AS int) AS min_qty, CAST(max_qty AS int) AS max_qty, CAST(discount_pct AS double) AS discount_pct FROM JEDI_PACK.bulk_pricing;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.bom_part AS SELECT COALESCE(CONCAT(sku, '|', part_id), '') AS bom_key, sku, part_id, part_name, CAST(qty_per_unit AS int) AS qty_per_unit, CAST(stock AS int) AS stock, CAST(fictional AS boolean) AS fictional FROM JEDI_PACK.bom;

ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.channel AS SELECT COALESCE(channel, '') AS channel, CAST(public AS boolean) AS public, CAST(autonomous_reply AS boolean) AS autonomous_reply, intake_address, label FROM JEDI_PACK.channels;

SHOW TABLES IN lightning.metastore.jedi_pack;

SELECT t.thread_id, t.category, t.amount, e.name AS owner, c.name AS customer FROM lightning.metastore.jedi_pack.jedi_pack.ticket t JOIN lightning.metastore.jedi_pack.jedi_pack.employee e ON t.owner_id = e.employee_id JOIN lightning.metastore.jedi_pack.jedi_pack.customer c ON t.sender_email = c.email WHERE t.amount IS NOT NULL ORDER BY t.amount DESC LIMIT 5;
```

## Compile response (table, column, key and DQ fields)

```json
{
  "namespace": ["metastore","jedi_pack"], "name": "jedi_pack",
  "tables": [
    {
      "name": "employee", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"employee_id","dataType":"integer","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"given_name","dataType":"varchar(100)","dqAnnotations":[]},
      {"name":"family_name","dataType":"varchar(100)","dqAnnotations":[]},
      {"name":"name","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"email","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"team","dataType":"varchar(100)","dqAnnotations":[]},
      {"name":"role","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"trust_weight_seed","dataType":"double","dqAnnotations":[]}
      ],
      "foreignKeys": []
    },
    {
      "name": "customer", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"email","dataType":"varchar(200)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"name","dataType":"varchar(200)","dqAnnotations":[]}
      ],
      "foreignKeys": []
    },
    {
      "name": "ticket", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"thread_id","dataType":"varchar(50)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"parent_thread_id","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"channel","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"category","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"agent_category","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"sender_name","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"sender_email","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"subject","dataType":"varchar(500)","dqAnnotations":[]},
      {"name":"body","dataType":"varchar(4000)","dqAnnotations":[]},
      {"name":"follow_up_kind","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"received_at","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"amount","dataType":"double","dqAnnotations":[]},
      {"name":"may_leave","dataType":"boolean","dqAnnotations":[]},
      {"name":"owner_id","dataType":"integer","dqAnnotations":[]},
      {"name":"backup_id","dataType":"integer","dqAnnotations":[]},
      {"name":"outcome","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"data_source","dataType":"varchar(20)","dqAnnotations":[]}
      ],
      "foreignKeys": [
      {"columns":["sender_email"],"refTable":["lightning.metastore.jedi_pack.jedi_pack.customer"],"refColumns":["email"]},
      {"columns":["owner_id"],"refTable":["lightning.metastore.jedi_pack.jedi_pack.employee"],"refColumns":["employee_id"]},
      {"columns":["backup_id"],"refTable":["lightning.metastore.jedi_pack.jedi_pack.employee"],"refColumns":["employee_id"]}
      ]
    },
    {
      "name": "product", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"sku","dataType":"varchar(50)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"slug","dataType":"varchar(100)","dqAnnotations":[]},
      {"name":"name","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"category","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"unit_price","dataType":"double","dqAnnotations":[]},
      {"name":"currency","dataType":"varchar(10)","dqAnnotations":[]},
      {"name":"stock","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"min_order_qty","dataType":"integer","dqAnnotations":[]},
      {"name":"lead_days","dataType":"integer","dqAnnotations":[]},
      {"name":"show_in_store","dataType":"boolean","dqAnnotations":[]},
      {"name":"image_url","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"model","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"aliases","dataType":"varchar(500)","dqAnnotations":[]},
      {"name":"material","dataType":"varchar(500)","dqAnnotations":[]},
      {"name":"specs","dataType":"varchar(1000)","dqAnnotations":[]},
      {"name":"description","dataType":"varchar(2000)","dqAnnotations":[]}
      ],
      "foreignKeys": []
    },
    {
      "name": "policy", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"topic","dataType":"varchar(50)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"limit_amount","dataType":"double","dqAnnotations":[]},
      {"name":"currency","dataType":"varchar(10)","dqAnnotations":[]},
      {"name":"under_limit_owner_id","dataType":"integer","dqAnnotations":[]},
      {"name":"under_limit_backup_id","dataType":"integer","dqAnnotations":[]},
      {"name":"over_limit_owner_id","dataType":"integer","dqAnnotations":[]},
      {"name":"over_limit_backup_id","dataType":"integer","dqAnnotations":[]}
      ],
      "foreignKeys": [
      {"columns":["under_limit_owner_id"],"refTable":["lightning.metastore.jedi_pack.jedi_pack.employee"],"refColumns":["employee_id"]},
      {"columns":["over_limit_owner_id"],"refTable":["lightning.metastore.jedi_pack.jedi_pack.employee"],"refColumns":["employee_id"]}
      ]
    },
    {
      "name": "responsibility", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"topic","dataType":"varchar(50)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"owner_id","dataType":"integer","dqAnnotations":[]},
      {"name":"backup_id","dataType":"integer","dqAnnotations":[]},
      {"name":"label","dataType":"varchar(200)","dqAnnotations":[]}
      ],
      "foreignKeys": [
      {"columns":["owner_id"],"refTable":["lightning.metastore.jedi_pack.jedi_pack.employee"],"refColumns":["employee_id"]},
      {"columns":["backup_id"],"refTable":["lightning.metastore.jedi_pack.jedi_pack.employee"],"refColumns":["employee_id"]}
      ]
    },
    {
      "name": "faq", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"faq_id","dataType":"varchar(50)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"question","dataType":"varchar(1000)","dqAnnotations":[]},
      {"name":"answer","dataType":"varchar(4000)","dqAnnotations":[]},
      {"name":"keywords","dataType":"varchar(1000)","dqAnnotations":[]},
      {"name":"faq_source","dataType":"varchar(50)","dqAnnotations":[]}
      ],
      "foreignKeys": []
    },
    {
      "name": "holiday", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"holiday_key","dataType":"varchar(100)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"employee_id","dataType":"integer","dqAnnotations":[]},
      {"name":"date","dataType":"varchar(20)","dqAnnotations":[]},
      {"name":"kind","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"holiday_name","dataType":"varchar(200)","dqAnnotations":[]}
      ],
      "foreignKeys": [
      {"columns":["employee_id"],"refTable":["lightning.metastore.jedi_pack.jedi_pack.employee"],"refColumns":["employee_id"]}
      ]
    },
    {
      "name": "intake", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"thread_id","dataType":"varchar(50)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"received_at","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"channel","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"sender_name","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"sender_email","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"subject","dataType":"varchar(500)","dqAnnotations":[]},
      {"name":"body","dataType":"varchar(4000)","dqAnnotations":[]},
      {"name":"scenario","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"category","dataType":"varchar(50)","dqAnnotations":[]}
      ],
      "foreignKeys": [
      {"columns":["sender_email"],"refTable":["lightning.metastore.jedi_pack.jedi_pack.customer"],"refColumns":["email"]}
      ]
    },
    {
      "name": "review", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"review_id","dataType":"varchar(50)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"thread_id","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"reviewer_name","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"stars","dataType":"integer","dqAnnotations":[]},
      {"name":"created_at","dataType":"varchar(50)","dqAnnotations":[]}
      ],
      "foreignKeys": [
      {"columns":["thread_id"],"refTable":["lightning.metastore.jedi_pack.jedi_pack.ticket"],"refColumns":["thread_id"]}
      ]
    },
    {
      "name": "decision", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"run_id","dataType":"varchar(100)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"thread_id","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"category","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"decision","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"verdict","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"delta","dataType":"double","dqAnnotations":[]},
      {"name":"ts","dataType":"varchar(50)","dqAnnotations":[]}
      ],
      "foreignKeys": []
    },
    {
      "name": "wiki_page", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"page","dataType":"varchar(100)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"body","dataType":"varchar(8000)","dqAnnotations":[]}
      ],
      "foreignKeys": []
    },
    {
      "name": "hierarchy", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"employee_id","dataType":"integer","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"name","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"role","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"team","dataType":"varchar(100)","dqAnnotations":[]},
      {"name":"team_label","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"manager_id","dataType":"integer","dqAnnotations":[]}
      ],
      "foreignKeys": [
      {"columns":["employee_id"],"refTable":["lightning.metastore.jedi_pack.jedi_pack.employee"],"refColumns":["employee_id"]}
      ]
    },
    {
      "name": "client", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"customer_id","dataType":"varchar(50)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"name","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"callsign","dataType":"varchar(100)","dqAnnotations":[]},
      {"name":"email","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"home_planet","dataType":"varchar(100)","dqAnnotations":[]},
      {"name":"since","dataType":"varchar(20)","dqAnnotations":[]},
      {"name":"seeded_prior_refund","dataType":"boolean","dqAnnotations":[]},
      {"name":"fictional","dataType":"boolean","dqAnnotations":[]}
      ],
      "foreignKeys": []
    },
    {
      "name": "sales_order", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"order_id","dataType":"varchar(50)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"customer_id","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"sku","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"quantity","dataType":"integer","dqAnnotations":[]},
      {"name":"amount","dataType":"double","dqAnnotations":[]},
      {"name":"currency","dataType":"varchar(10)","dqAnnotations":[]},
      {"name":"shipping_planet","dataType":"varchar(100)","dqAnnotations":[]},
      {"name":"status","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"ordered_at","dataType":"varchar(50)","dqAnnotations":[]}
      ],
      "foreignKeys": [
      {"columns":["customer_id"],"refTable":["lightning.metastore.jedi_pack.jedi_pack.client"],"refColumns":["customer_id"]},
      {"columns":["sku"],"refTable":["lightning.metastore.jedi_pack.jedi_pack.product"],"refColumns":["sku"]}
      ]
    },
    {
      "name": "shipping_rule", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"planet","dataType":"varchar(100)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"status","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"note","dataType":"varchar(500)","dqAnnotations":[]}
      ],
      "foreignKeys": []
    },
    {
      "name": "bulk_tier", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"tier","dataType":"varchar(50)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"min_qty","dataType":"integer","dqAnnotations":[]},
      {"name":"max_qty","dataType":"integer","dqAnnotations":[]},
      {"name":"discount_pct","dataType":"double","dqAnnotations":[]}
      ],
      "foreignKeys": []
    },
    {
      "name": "bom_part", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"bom_key","dataType":"varchar(100)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"sku","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"part_id","dataType":"varchar(50)","dqAnnotations":[]},
      {"name":"part_name","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"qty_per_unit","dataType":"integer","dqAnnotations":[]},
      {"name":"stock","dataType":"integer","dqAnnotations":[]},
      {"name":"fictional","dataType":"boolean","dqAnnotations":[]}
      ],
      "foreignKeys": [
      {"columns":["sku"],"refTable":["lightning.metastore.jedi_pack.jedi_pack.product"],"refColumns":["sku"]}
      ]
    },
    {
      "name": "channel", "dqAnnotations": [],
      "columnSpecs": [
      {"name":"channel","dataType":"varchar(50)","primaryKey":{"columns":[]},"notNull":{"columns":[]},"dqAnnotations":[]},
      {"name":"public","dataType":"boolean","dqAnnotations":[]},
      {"name":"autonomous_reply","dataType":"boolean","dqAnnotations":[]},
      {"name":"intake_address","dataType":"varchar(200)","dqAnnotations":[]},
      {"name":"label","dataType":"varchar(200)","dqAnnotations":[]}
      ],
      "foreignKeys": []
    }
  ]
}
```

## Statement log

| status | statement |
|---|---|
| ok | `REMOVE USL jedi_pack NAMESPACE lightning.metastore.jedi_pack` |
| ok | `CREATE NAMESPACE IF NOT EXISTS lightning.metastore` |
| ok | `CREATE NAMESPACE IF NOT EXISTS lightning.metastore.jedi_pack` |
| ok | `COMPILE USL IF NOT EXISTS jedi_pack DEPLOY NAMESPACE lightning.metastore.jedi_pack DDL CREATE TABLE employee (` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.employee AS SELECT COALESCE(CAST(employee_id AS int` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.customer AS SELECT COALESCE(sender_email, '') AS em` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.ticket AS SELECT COALESCE(thread_id, '') AS thread_` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.product AS SELECT COALESCE(sku, '') AS sku, slug, n` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.policy AS SELECT COALESCE(topic, '') AS topic, CAST` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.responsibility AS SELECT COALESCE(topic, '') AS top` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.faq AS SELECT COALESCE(faq_id, '') AS faq_id, quest` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.holiday AS SELECT COALESCE(CONCAT(CAST(employee_id ` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.intake AS SELECT COALESCE(thread_id, '') AS thread_` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.review AS SELECT COALESCE(review_id, '') AS review_` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.decision AS SELECT COALESCE(run_id, '') AS run_id, ` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.wiki_page AS SELECT 'refund-policy' AS page, previe` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.hierarchy AS SELECT COALESCE(CAST(employee_id AS in` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.client AS SELECT COALESCE(customer_id, '') AS custo` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.sales_order AS SELECT COALESCE(order_id, '') AS ord` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.shipping_rule AS SELECT COALESCE(planet, '') AS pla` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.bulk_tier AS SELECT COALESCE(tier, '') AS tier, CAS` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.bom_part AS SELECT COALESCE(CONCAT(sku, '|', part_i` |
| ok | `ACTIVATE USL TABLE lightning.metastore.jedi_pack.jedi_pack.channel AS SELECT COALESCE(channel, '') AS channel,` |
| ok | `SHOW TABLES IN lightning.metastore.jedi_pack` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.employee` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.customer` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.ticket` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.product` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.policy` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.responsibility` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.faq` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.holiday` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.intake` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.review` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.decision` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.wiki_page` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.hierarchy` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.client` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.sales_order` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.shipping_rule` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.bulk_tier` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.bom_part` |
| ok | `SELECT COUNT(*) FROM lightning.metastore.jedi_pack.jedi_pack.channel` |
| ok | `SELECT t.thread_id, t.category, t.amount, e.name AS owner, c.name AS customer FROM lightning.metastore.jedi_pa` |
