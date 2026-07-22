import assert from "node:assert/strict";
import test from "node:test";
import { localAccessError } from "../src/lib/local-access.ts";

function request(url, { host, origin, method = "GET" } = {}) {
  const headers = new Headers();
  if (host) headers.set("host", host);
  if (origin) headers.set("origin", origin);
  return new Request(url, { headers, method });
}

test("localAccessError accepts loopback hosts", () => {
  assert.equal(localAccessError(request("http://localhost:3000/api/test", { host: "localhost:3000" })), "");
  assert.equal(localAccessError(request("http://127.0.0.1:3000/api/test", { host: "127.0.0.1:3000" })), "");
  assert.equal(localAccessError(request("http://[::1]:3000/api/test", { host: "[::1]:3000" })), "");
});

test("localAccessError rejects non-loopback and missing hosts", () => {
  assert.match(localAccessError(request("http://example.test/api/test", { host: "example.test" })), /仅允许从本机访问/);
  assert.match(localAccessError(request("http://localhost:3000/api/test")), /仅允许从本机访问/);
});

test("localAccessError requires a matching loopback origin for writes", () => {
  assert.equal(localAccessError(request("http://localhost:3000/api/test", {
    host: "localhost:3000", origin: "http://localhost:3000", method: "POST",
  }), { requireOrigin: true }), "");
  assert.match(localAccessError(request("http://localhost:3000/api/test", {
    host: "localhost:3000", method: "POST",
  }), { requireOrigin: true }), /请求来源无效/);
  assert.match(localAccessError(request("http://localhost:3000/api/test", {
    host: "localhost:3000", origin: "https://attacker.example", method: "POST",
  }), { requireOrigin: true }), /请求来源无效/);
  assert.match(localAccessError(request("http://localhost:3000/api/test", {
    host: "localhost:3000", origin: "http://127.0.0.1:3000", method: "POST",
  }), { requireOrigin: true }), /请求来源无效/);
  assert.match(localAccessError(request("http://localhost:3000/api/test", {
    host: "localhost:3000", origin: "https://localhost:3000", method: "POST",
  }), { requireOrigin: true }), /请求来源无效/);
});

test("localAccessError compares write origins with the Host header when the framework rewrites request.url", () => {
  assert.equal(localAccessError(request("http://localhost:3000/api/test", {
    host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", method: "POST",
  }), { requireOrigin: true }), "");
});
