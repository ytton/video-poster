import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const source = readFileSync(new URL("../extension/dayu.js", import.meta.url), "utf8")

function dayuPage(items) {
  let listener
  const context = vm.createContext({
    chrome: { runtime: { onMessage: { addListener(value) { listener = value } } } },
    document: { querySelector: () => null },
    location: { origin: "https://mp.dayu.com", pathname: "/dashboard/index" },
    crypto: { randomUUID: () => "00000000-0000-0000-0000-000000000001" },
    fetch: async () => ({ ok: true, json: async () => ({ dataList: { data: items, totalPage: 1 } }) }),
  })
  vm.runInContext(source, context)
  return message => new Promise(resolve => listener(message, null, resolve))
}

const payload = { title: "同一份作品" }

test("old or draft Dayu records never confirm a new publication", async () => {
  const send = dayuPage([
    { title: payload.title, content_id: "old", status: 1 },
    { title: payload.title, content_id: "draft", status: 0 },
  ])
  const result = await send({ type: "verify-record", payload, baseline: ["old"] })
  assert.equal(result.ok, false)
  assert.match(result.error, /尚未找到/)
})

test("a unique newly submitted Dayu record supplies publication evidence", async () => {
  const send = dayuPage([
    { title: payload.title, content_id: "old", status: 1 },
    { title: payload.title, content_id: "new", status: 3 },
  ])
  const result = await send({ type: "verify-record", payload, baseline: ["old"] })
  assert.equal(result.ok, true)
  assert.equal(result.evidence.recordId, "new")
  assert.equal(result.evidence.title, payload.title)
})
