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
// sha256 of name, description, material and specs (joined by \u0001), for ALL 50 rows of both products.csv copies, by sku
const CSV_ROW_SHA256 = {
  "FS-B01": "81839f3ee72c33c34525a7323b14cdc5e5a8a989945991879b598812c7eaecea",
  "FS-B02": "a7329b1579e78a3f27c465e478b3436cf03635b1c6c67513884e55fb36590ac6",
  "FS-B03": "f93f69c5d550259d71a75a915fee8256ee634e9b0170a56dcdf2c8c3750bfae9",
  "FS-C01": "f49292bc436bfaac4d7eed37e02d5049559005f944f1c6216e82bcfe8cf050c7",
  "FS-C02": "f928139c218d82765a70b2d6844135a40aec18ac0f1718f383bd99873e12a028",
  "FS-C03": "a5d02ae5a115deb05a40b866e604acc453bed9399c769a8ef4a678e6901eed5b",
  "FS-A01": "44b261a6adda4f069086a7879d2148f547b9fbd91722cd7245ba553a402c33bd",
  "FS-A02": "bdaa6ee8d4731c5ebc218e31833f7aa903767314161b7f9bf2717ae4ada36621",
  "FS-A03": "c77020797c49e441a6bd168f2194dc51dc2b2a91a6f50ae8483304f515a45fe2",
  "FS-G01": "a4136d374b4700489628a3fbc1fbf7a00eb318d32aadc039c878918b63e01f75",
  "FS-G02": "ab95eb56618560c9775a75b175e07feeccea7e9ac56e674147b81dde88867ca6",
  "FS-G03": "80d0e1fc7b9cc50fbe3df480fa7fb16dbedc279a484658f9cbc919df47494115",
  "FS-B04": "915190b757a896f0df37b1fb929bb8972c5189ab2d43212d9cb844bcd096d2fd",
  "FS-B05": "a3dfc1c4738f7d4ed44223b5aef235068310e2b0ef9fed218eed5109fa76e977",
  "FS-B06": "e4ed1d40213e770a58d2f4d338e1bb635dac4fb60375d290a8415679cd941957",
  "FS-B07": "84d8ec79c8039c223ed79069be5a0f057d22fa4a00164ae13f4250af20eb387c",
  "FS-B08": "cdb5a11e5795bc26a01224d39d41121bd713e8a9d97ab84c8d6c18a995a4754f",
  "FS-B09": "e6202d27e1c1645bd5658b344a244c999915977e45f9d57be6f207568a112d27",
  "FS-C04": "32a0680adad6f0b74c6fee2962e12edfae1d4c1076e78d39d12bd0ebf6159f3d",
  "FS-C05": "78348b32ccbff0e199833672fbb50d947b60d69a6c42fa2bfc74ae180423755a",
  "FS-C06": "919d5a46c115de25a82c022982155880a4aad2a716decc94282bf7915fc8cffd",
  "FS-C07": "86d022d3135cc1fd9e9a47de7a1f399330a8f53cbf0877178fbfbc5697881b4a",
  "FS-C08": "63467a3d2317ca12c2f5ddbf2ab5a93fb60cfc11bba075c621878ac4e4bc5411",
  "FS-C09": "c9b4fb51ed0b926ab396dfbaf27ce095b0423b2f2bd92204232f77cba9d5b40a",
  "FS-A04": "f7ba2d38b1429763bd12c06d8def097b82029b0b76dbb2eb004f8c28f06c0d69",
  "FS-A05": "c96055ab59a4a18234c0c3a21e73ab17fee6be001c48c52da2b745735fe0e841",
  "FS-A06": "03dba5f056d5c946dec1eff69bb54937717b10cd77c05f45eb67db920ea8ba63",
  "FS-A07": "272b7fbb4ff4ce3e326f0a4f12e1c6465681f30aa5c3abe296d25588d721f8b6",
  "FS-A08": "425ae98c8059b19865438d72cea8b06cbdda5beb1b968c144702dfbc3595908a",
  "FS-A09": "f779170410b265989427ca4cab0d321568f2acfbbe2acc7b6e886bbefb242758",
  "FS-A10": "c93f11c4bf103b645eddac381a684582a6d05e6d1a0c273c761ebe370ca6ce16",
  "FS-G04": "1488af7a37e7c583ab74b288c543c2557016d942353e7f16efde5aae9fcf9235",
  "FS-G05": "2c37684685909e62633cb20406d9e40360a15f0d24ed41d9fc08f090d0920a90",
  "FS-G06": "d7ae529e74f7cc535e96fe869365faec9d9f3a89c5b4978d6b829e81f6c6597d",
  "FS-G07": "78f83a769de7a610f01ace5faf91f3460227cc4119a39467a00853bd0d3a5c4d",
  "FS-G08": "0a60fbc67c6b488f8a2e78c158bebd0dc1b385ee853222105c58231f3ecfd66e",
  "FS-G09": "3f20ece37312455b1a0b200e9e4404b87e2d598eb57892df68ab740398b35bf0",
  "FS-G10": "c6c7a6442588b3a7f18f85f84b0f62cee14902281996e80cb0249b5795f6ca32",
  "FS-G11": "14c5ea29ddc3b03c12096648138b81498716c531b77fe46370aaeb84d743680c",
  "FS-G12": "2d5483cf084ab4c3bbaaa166ff015718f491b7d9a1042d20457e4589658195b3",
  "FS-G13": "76687b5617f3405952964ebc7658c93d959aa881df0bbb7979596a96589812ba",
  "FS-G14": "95fa7e9b859049d31eedd9eefdfa9c5d1672486ad041281ed2814a00e41d35d3",
  "FS-G15": "90478d8ee3c2da0736fbb5073affb7860fccc565094e248a35738dc3a1a7e830",
  "FS-G16": "8f169359c2268351a12d8ea453a21b0c99492ca9e23e4d6281c4f08795810773",
  "FS-G17": "4085a2ae2b1b014564a980d61df5bfdc7588f6100a7adc1d1b13c34196b95b5c",
  "FS-G18": "3aab0de627be445c24f1d942a084276b9da23e9695653e76022e3997deed4edc",
  "FS-G19": "6f22b242931501a3d16e839edbfdeb61313c55444a4e2e1742a433850171ea36",
  "FS-G20": "2d11ec8cac74601c24d19c6e5d5518f8088815f51a8d8e894d872770243707be",
  "FS-G21": "c1009024170c8bfce2d5b40c7d3c984882f48d5b3b9d22720564128eedd9c3b9",
  "FS-G22": "0805249cf02d5befc304efff911134f0790e6de0b1b22f2158330d52645579e7"
};
// sha256 of name, description, tagline and materials_specs of each storefront product in catalogue.json (the list of spec lines joined by newlines)
const CATALOGUE_ROW_SHA256 = {
  "FS-B01": "2abd4c227090978d9be2a3cbf4e48d9fdf7ece69ba4f6939eda3e2e3f085e135",
  "FS-B02": "325a130a8290442722b165d02161452c2834df78738add5f30d4995c83495a06",
  "FS-B03": "28d4a2417fda741859d1bc293b97cefb543f95ba3dd091f4b0a7fd0a448062f9",
  "FS-C01": "2089e15a6783fd13d52ac38e6948fe63ea56d1c553f492556ed9f073148777a0",
  "FS-C02": "1035dabe9bb015219f58839549291944628866b308d2a04b801118587401935c",
  "FS-C03": "f4121a289310f2c05dab04ace738aa8c1b270fca68289d14d3e9da597d73dd43",
  "FS-A01": "55e2d8f7f048da35a2f864cd657c2e1b3693bf0394dda56ccb376ca08ded1031",
  "FS-A02": "1ca257ff0788c5777fd75a1be035b24e6f57a17ae01e786e72ba93942bfad8c1",
  "FS-A03": "e1f6966a80bbcf19515bec8ee8b4bbfc3bc3e942ec9d295350f7357b57e7b717",
  "FS-G01": "f8263adc4d48ace6773da1c5dc5f70801e05455877ecb372366d798cbf589ad1",
  "FS-G02": "4982694d947dfa2e030a868cf8c5965831bba933415490e059bf34813e7a645c",
  "FS-G03": "b1af352991eb1eefe932f43666859b0d446ea426e245442e3022f81dcd6777fb"
};

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

const catalogue = JSON.parse(readFileSync(join(INBOX, "public/shop/data/catalogue.json"), "utf8"));
const stable = (v) => (Array.isArray(v) ? v.join("\n") : String(v));

test("the storefront catalogue has exactly its 12 product ids", () => {
  assert.deepEqual(catalogue.products.map((p) => p.id).sort(), STOREFRONT_IDS, FROZEN);
});

test("catalogue.json: every storefront product keeps its name, description, tagline and materials_specs", () => {
  for (const p of catalogue.products) {
    const got = sha([p.name, p.description, p.tagline, stable(p.materials_specs)].join("\u0001"));
    assert.equal(got, CATALOGUE_ROW_SHA256[p.id], `${p.id}: ${FROZEN}`);
  }
});

for (const [file, rows] of Object.entries(csvs)) {
  test(`${file} has exactly its 50 skus`, () => {
    const skus = rows.map((r) => r.sku).sort();
    assert.equal(skus.length, SKU_COUNT, FROZEN);
    assert.equal(sha(skus.join("\n")), SKU_LIST_SHA256, FROZEN);
  });

  test(`${file}: all 50 rows keep their name, description, material and specs`, () => {
    for (const r of rows) {
      const got = sha([r.name, r.description, r.material, r.specs].join("\u0001"));
      assert.equal(got, CSV_ROW_SHA256[r.sku], `${r.sku}: ${FROZEN}`);
    }
  });
}
