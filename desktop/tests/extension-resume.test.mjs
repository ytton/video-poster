import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const source = readFileSync(new URL("../extension/douyin.js", import.meta.url), "utf8")

function loadPage({ title, description, videoReady }) {
  const requests = []
  const statuses = []
  const panelText = { textContent: "" }
  const panelButton = { hidden: true, onclick: null }
  const host = { shadowRoot: { querySelector: selector => selector === "p" ? panelText : panelButton } }
  const titleField = title === null ? null : { value: title }
  const editor = description === null ? null : { textContent: description }
  const listeners = []
  let currentJob = null
  let finished
  const completion = new Promise(resolve => { finished = resolve })
  const document = {
    getElementById: () => host,
    querySelector(selector) {
      if (selector.includes("填写作品标题")) return titleField
      if (selector.includes("zone-container")) return editor
      return null
    },
    querySelectorAll(selector) {
      if (selector.includes("long-card") && videoReady) return [{ textContent: "重新上传" }]
      return []
    },
  }
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener: listener => listeners.push(listener), removeListener: () => {} },
      sendMessage(message, respond) {
        if (message.type === "job") respond({ ok: true, job: currentJob })
        else if (message.type === "status") {
          statuses.push(message)
          respond({ ok: true })
          if (["prepared", "failed"].includes(message.status)) finished()
        } else respond({ ok: true })
      },
    },
  }
  const context = vm.createContext({
    chrome, document, location: { pathname: "/creator-micro/content/upload" },
    window: { setInterval: () => 1, clearInterval: () => {} },
    fetch: async url => {
      requests.push(url)
      return { ok: true, json: async () => ({ id: "task-1", title: "作品标题", description: "作品简介", tags: [], declaration: "", portrait: null, landscape: null }) }
    },
    setTimeout, clearTimeout,
  })
  vm.runInContext(source, context)
  currentJob = { task: "task-1", base: "http://127.0.0.1:47653", token: "token", stage: "opened", resume: true }
  return {
    requests, statuses, completion, panelButton,
    start: () => listeners[0]({ type: "start" }, null, () => {}),
  }
}

test("resume keeps the current video and completed text", async () => {
  const page = loadPage({ title: "已有标题", description: "已有简介", videoReady: true })
  page.start()
  await page.completion
  assert.deepEqual(page.statuses.map(item => item.status), ["filling", "prepared"])
  assert.equal(page.requests.length, 1)
  assert.match(page.requests[0], /\/api\/tasks\/task-1$/)
})

test("resume stops when the current page has no recognizable video", async () => {
  const page = loadPage({ title: null, description: null, videoReady: false })
  page.start()
  await page.completion
  assert.deepEqual(page.statuses.map(item => item.status), ["failed"])
  assert.match(page.statuses[0].message, /不会重新上传视频/)
  assert.equal(page.requests.length, 1)
  assert.equal(page.panelButton.textContent, "补齐剩余内容")
})
