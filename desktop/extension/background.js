const UPLOAD_URL = "https://creator.douyin.com/creator-micro/content/upload"

async function bridgeConnection() {
  const { bridge } = await chrome.storage.local.get("bridge")
  if (!bridge) throw new Error("扩展尚未连接软件。请在软件的“浏览器扩展”页点击“连接扩展”。")
  return bridge
}

async function bridgeFetch(bridge, path, options = {}) {
  const response = await fetch(`${bridge.base}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${bridge.token}`, ...(options.headers || {}) },
  })
  if (!response.ok) throw new Error(response.status === 401
    ? "连接已失效，请在软件中重新连接扩展"
    : `桌面连接失败（HTTP ${response.status}）`)
  return response
}

async function reportStatus(job, status, message) {
  await bridgeFetch(job, `/api/tasks/${job.task}/status`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId: job.task, status, message: String(message).slice(0, 500) }),
  })
}

async function startInTab(tabId, taskId, resume) {
  const bridge = await bridgeConnection()
  const tab = await chrome.tabs.get(tabId)
  if (!tab.url?.startsWith("https://creator.douyin.com/")) {
    throw new Error("请先切到抖音创作者上传页，再点击自动补齐")
  }
  const response = await bridgeFetch(bridge, `/api/tasks/${taskId}`)
  const payload = await response.json()
  if (payload.id !== taskId) throw new Error("作品任务无效")
  const previous = (await chrome.storage.session.get(`job:${tabId}`))[`job:${tabId}`]
  const job = { ...bridge, task: taskId, stage: "opened", resume: !!resume || previous?.task === taskId,
    completed: previous?.task === taskId ? previous.completed || [] : [] }
  await chrome.storage.session.set({ [`job:${tabId}`]: job })
  await reportStatus(job, "opened", "已在当前抖音标签页开始检查现有内容")
  await chrome.scripting.executeScript({ target: { tabId }, files: ["douyin.js"] })
  await chrome.tabs.sendMessage(tabId, { type: "start" })
  return { ok: true }
}

async function inspectTab(tabId) {
  const tab = await chrome.tabs.get(tabId)
  if (!tab.url?.startsWith("https://creator.douyin.com/")) throw new Error("当前不是抖音创作者页面")
  await chrome.scripting.executeScript({ target: { tabId }, files: ["douyin.js"] })
  return chrome.tabs.sendMessage(tabId, { type: "inspect-page" })
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  ;(async () => {
    if (message?.type === "pair") {
      if (!sender.tab?.id || !sender.url?.startsWith(`${message.base}/connect`)
        || !/^http:\/\/127\.0\.0\.1:\d+$/.test(message.base)
        || !/^[a-f0-9]{64}$/.test(message.token)) throw new Error("连接页地址无效")
      const bridge = { base: message.base, token: message.token }
      await bridgeFetch(bridge, "/api/tasks")
      await chrome.storage.local.set({ bridge })
      if (message.task) {
        const response = await bridgeFetch(bridge, `/api/tasks/${message.task}`)
        const payload = await response.json()
        if (payload.id !== message.task) throw new Error("作品任务无效")
        const tabs = await chrome.tabs.query({ url: "https://creator.douyin.com/*" })
        const existing = tabs.sort((a, b) =>
          Number(b.url?.includes("/content/")) - Number(a.url?.includes("/content/"))
          || (b.lastAccessed || 0) - (a.lastAccessed || 0))[0]
        if (existing?.id) {
          await chrome.tabs.update(existing.id, { active: true })
          if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {})
          await chrome.tabs.remove(sender.tab.id)
        } else {
          await chrome.tabs.update(sender.tab.id, { url: UPLOAD_URL })
        }
      }
      return { ok: true }
    }
    if (message?.type === "list") {
      const bridge = await bridgeConnection()
      const response = await bridgeFetch(bridge, "/api/tasks")
      const listing = await response.json()
      return { ok: true, tasks: listing.tasks, activeTaskId: listing.activeTaskId }
    }
    if (message?.type === "start") {
      if (sender.tab) throw new Error("请从扩展弹窗选择作品")
      return startInTab(message.tabId, message.taskId, message.resume)
    }
    if (message?.type === "inspect") {
      if (sender.tab) throw new Error("请从扩展弹窗查看页面")
      return inspectTab(message.tabId)
    }
    if (message?.type === "open-upload") {
      if (sender.tab) throw new Error("请从扩展弹窗打开上传页")
      await chrome.tabs.create({ url: UPLOAD_URL })
      return { ok: true }
    }
    if (!sender.tab?.id || !sender.url?.startsWith("https://creator.douyin.com/")) {
      throw new Error("仅支持抖音创作者页面")
    }
    const key = `job:${sender.tab.id}`
    const job = (await chrome.storage.session.get(key))[key]
    if (!job) return { ok: false, error: "当前标签没有待填写任务" }
    if (message?.type === "job") return { ok: true, job }
    if (message?.type === "status") {
      if (!["opened", "uploading", "filling", "prepared", "failed"].includes(message.status)) throw new Error("任务状态无效")
      await reportStatus(job, message.status, message.message || "")
      await chrome.storage.session.set({ [key]: { ...job, stage: message.status } })
      return { ok: true }
    }
    if (message?.type === "checkpoint") {
      if (!["cover"].includes(message.step)) throw new Error("未知填写步骤")
      await chrome.storage.session.set({ [key]: { ...job, completed: [...new Set([...(job.completed || []), message.step])] } })
      return { ok: true }
    }
    if (message?.type === "resume") {
      const resumed = { ...job, stage: "opened", resume: true }
      await chrome.storage.session.set({ [key]: resumed })
      return { ok: true, job: resumed }
    }
    throw new Error("未知扩展操作")
  })().then(respond).catch(error => respond({ ok: false, error: String(error.message || error) }))
  return true
})

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(`job:${tabId}`)
})
