const UPLOAD_URL = "https://creator.douyin.com/creator-micro/content/upload"

async function bridgeFetch(job, path, options = {}) {
  const response = await fetch(`${job.base}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${job.token}`, ...(options.headers || {}) },
  })
  if (!response.ok) throw new Error(`桌面连接失败（HTTP ${response.status}）`)
  return response
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  ;(async () => {
    if (message?.type === "connect") {
      if (!sender.tab?.id || !sender.url?.startsWith(`${message.base}/connect`)
        || !/^http:\/\/127\.0\.0\.1:\d+$/.test(message.base)) throw new Error("连接页地址无效")
      const job = { task: message.task, token: message.token, base: message.base, stage: "opened" }
      const taskResponse = await bridgeFetch(job, `/api/tasks/${job.task}`)
      const payload = await taskResponse.json()
      if (payload.id !== job.task) throw new Error("任务编号不匹配")
      await chrome.storage.session.set({ [`job:${sender.tab.id}`]: job })
      await bridgeFetch(job, `/api/tasks/${job.task}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: job.task, status: "opened", message: "已连接浏览器，正在打开抖音发布页" }),
      })
      await chrome.tabs.update(sender.tab.id, { url: UPLOAD_URL })
      return { ok: true }
    }
    if (!sender.tab?.id || !sender.url?.startsWith("https://creator.douyin.com/")) throw new Error("仅支持抖音创作者页面")
    const key = `job:${sender.tab.id}`
    const job = (await chrome.storage.session.get(key))[key]
    if (!job) return { ok: false, error: "当前标签没有待填写任务" }
    if (message?.type === "job") {
      return { ok: true, job }
    }
    if (message?.type === "status") {
      if (!["opened", "uploading", "filling", "prepared", "failed"].includes(message.status)) throw new Error("任务状态无效")
      await bridgeFetch(job, `/api/tasks/${job.task}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: job.task, status: message.status, message: String(message.message || "").slice(0, 500) }),
      })
      await chrome.storage.session.set({ [key]: { ...job, stage: message.status } })
      return { ok: true }
    }
    if (message?.type === "retry") {
      await chrome.storage.session.set({ [key]: { ...job, stage: "opened" } })
      return { ok: true }
    }
    throw new Error("未知扩展操作")
  })().then(respond).catch(error => respond({ ok: false, error: String(error.message || error) }))
  return true
})

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove(`job:${tabId}`)
})
