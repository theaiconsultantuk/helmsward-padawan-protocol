// The .env parser is one function in a side-effect-free module; config.mjs re-exports the same one (Codex reviews 9 and 10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnvFile } from "../src/envfile.mjs";
import { parseEnvFile as fromConfig } from "../src/config.mjs";

test("config.mjs re-exports the envfile parser itself (one parser, no drift)", () => {
  assert.equal(fromConfig, parseEnvFile);
});

test("parseEnvFile: export prefix, padding, matching quotes, comments, CRLF, last assignment wins", () => {
  const text = "# a comment\r\nexport API_TOKEN=\"abc\"\r\n  SPACED = 'x y'  \nUNMATCHED='abc\nEMPTY=\nDUP=1\nDUP=2\n=nokey\n";
  assert.deepEqual(parseEnvFile(text), { API_TOKEN: "abc", SPACED: "x y", UNMATCHED: "'abc", EMPTY: "", DUP: "2" });
});
