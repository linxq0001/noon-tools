import assert from "node:assert/strict";
import test from "node:test";

import { parseCliArgs } from "../scripts/lib/cli-args.js";

test("parseCliArgs parses flags and option values", () => {
  assert.deepEqual(parseCliArgs(["--profile", ".noon-profile", "--keep-open", "--noon-url", "https://example.test"]), {
    _: [],
    profile: ".noon-profile",
    "keep-open": "true",
    "noon-url": "https://example.test",
  });
});

test("parseCliArgs collects positional values in _", () => {
  assert.deepEqual(parseCliArgs(["https://example.test", "--limit", "2"]), {
    _: ["https://example.test"],
    limit: "2",
  });
});

test("parseCliArgs collects multiple positional values", () => {
  assert.deepEqual(parseCliArgs(["input.xlsx", "--dry-run", "--profile", ".noon-profile", "output.json"]), {
    _: ["input.xlsx", "output.json"],
    "dry-run": "true",
    profile: ".noon-profile",
  });
});
