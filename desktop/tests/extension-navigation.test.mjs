import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const source = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8")

test("a Baijiahao task opens the Baijiahao upload page", async () => {
  let listener
  const updates = []
  const requests = []
  const chrome = {
    runtime: {
      onMessage: { addListener(value) { listener = value } },
      getManifest: () => ({ version: "0.3.1" }),
    },
    storage: { local: { async set() {} }, session: { async remove() {} } },
    tabs: {
      async query() { return [] },
      async update(id, change) { updates.push({ id, ...change }) },
      onRemoved: { addListener() {} },
    },
  }
  const fetch = async (url, options = {}) => {
    requests.push({ url, options })
    return { ok: true, async json() { return { id: "task-1", platform: "baijiahao" } } }
  }
  vm.runInNewContext(source, { chrome, fetch, URL, setTimeout, clearTimeout })
  const result = await new Promise(resolve => listener(
    { type: "pair", base: "http://127.0.0.1:47653", token: "a".repeat(64), task: "task-1" },
    { tab: { id: 7 }, url: "http://127.0.0.1:47653/connect" }, resolve,
  ))
  assert.equal(result.ok, true)
  assert.deepEqual(updates, [{ id: 7, url: "https://baijiahao.baidu.com/builder/rc/edit?type=videoV2" }])
  assert.equal(requests.find(item => item.url.endsWith("/api/extension/hello"))?.options.method, "POST")
})
