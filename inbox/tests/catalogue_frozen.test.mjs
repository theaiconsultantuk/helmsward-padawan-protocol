// einh's team rule (Kristof, 25 Oct 2026): DO NOT ADD ANY PRODUCTS OR CHANGE PRODUCT DESCRIPTIONS.
// The storefront parity test catches a changed row; this one also catches a product added to both files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const INBOX = fileURLToPath(new URL("..", import.meta.url));
const REPO = join(INBOX, "..");
const FROZEN = "Product catalogue is frozen for the hackathon (Kristof, 25 Oct): do not add products or change descriptions; ask Kristof.";
const sha = (s) => createHash("sha256").update(s).digest("hex");

const STOREFRONT_IDS = ["FS-A01", "FS-A02", "FS-A03", "FS-B01", "FS-B02", "FS-B03", "FS-C01", "FS-C02", "FS-C03", "FS-G01", "FS-G02", "FS-G03"];
const SKU_LIST_SHA256 = "437309e85465f7b48f43ad71a25d35822218937e4362d7af013d03ca54424ec2";
const SKU_COUNT = 50;
const COPY_SHA256 = "cc59f4ede997a3a5df7a9c8cddbd617d99aaa28e8dc2ed58c2478f4de3d219ca";

function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.length > 1 || row[0]) rows.push(row); row = []; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const csvs = {
  "kristof/data/products.csv": parseCsv(readFileSync(join(REPO, "kristof/data/products.csv"), "utf8")),
  "inbox/data/synthetic/products.csv": parseCsv(readFileSync(join(INBOX, "data/synthetic/products.csv"), "utf8")),
};

test("the storefront catalogue has exactly its 12 product ids", () => {
  const cat = JSON.parse(readFileSync(join(INBOX, "public/shop/data/catalogue.json"), "utf8"));
  assert.deepEqual(cat.products.map((p) => p.id).sort(), STOREFRONT_IDS, FROZEN);
});

for (const [file, rows] of Object.entries(csvs)) {
  test(`${file} has exactly its 50 skus`, () => {
    const skus = rows.map((r) => r.sku).sort();
    assert.equal(skus.length, SKU_COUNT, FROZEN);
    assert.equal(sha(skus.join("\n")), SKU_LIST_SHA256, FROZEN);
  });

  test(`${file}: the 12 storefront rows keep their name, description, material and specs`, () => {
    const by = Object.fromEntries(rows.map((r) => [r.sku, r]));
    const text = STOREFRONT_IDS.map((id) => {
      assert.ok(by[id], `${id} missing. ${FROZEN}`);
      return [id, by[id].name, by[id].description, by[id].material, by[id].specs].join("\u0001");
    }).join("\u0002");
    assert.equal(sha(text), COPY_SHA256, FROZEN);
  });
}
