const PLATFORMS = {
  douyin: { host: "creator.douyin.com", upload: "https://creator.douyin.com/creator-micro/content/upload", records: "https://creator.douyin.com/creator-micro/content/manage", script: "douyin.js" },
  baijiahao: { host: "baijiahao.baidu.com", upload: "https://baijiahao.baidu.com/builder/rc/edit?type=videoV2", records: "https://baijiahao.baidu.com/builder/rc/article?type=all", script: "baijiahao.js" },
  dayu: { host: "mp.dayu.com", upload: "https://mp.dayu.com/dashboard/video/write", records: "https://mp.dayu.com/dashboard/index", script: "dayu.js" },
}

function platformFor(url) {
  try { return Object.keys(PLATFORMS).find(id => new URL(url).hostname === PLATFORMS[id].host) || null }
  catch { return null }
}

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

async function reportStatus(job, status, message, evidence) {
  await bridgeFetch(job, `/api/tasks/${job.task}/status`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId: job.task, status, message: String(message).slice(0, 500), evidence }),
  })
}

async function taskPayload(bridge, taskId) {
  const response = await bridgeFetch(bridge, `/api/tasks/${taskId}`)
  const payload = await response.json()
  if (payload.id !== taskId || !PLATFORMS[payload.platform]) throw new Error("作品任务无效")
  return payload
}

async function inject(tabId, platform) {
  await chrome.scripting.executeScript({ target: { tabId }, files: [PLATFORMS[platform].script] })
}

async function startInTab(tabId, taskId, resume) {
  const bridge = await bridgeConnection()
  const tab = await chrome.tabs.get(tabId)
  const platform = platformFor(tab.url)
  const payload = await taskPayload(bridge, taskId)
  if (!platform || platform !== payload.platform) throw new Error("当前标签页与作品任务平台不一致")
  const baselineKey = `baseline:${taskId}`
  if (!(await chrome.storage.session.get(baselineKey))[baselineKey]) {
    const recordsTab = await verificationTab(platform)
    await inject(recordsTab, platform)
    const snapshot = await chrome.tabs.sendMessage(recordsTab, { type: "capture-records" })
    if (!snapshot?.ok) throw new Error(snapshot?.error || "无法读取发布前作品记录，请登录后重试")
    await chrome.storage.session.set({ [baselineKey]: snapshot.ids })
  }
  const previous = (await chrome.storage.session.get(`job:${tabId}`))[`job:${tabId}`]
  const job = { ...bridge, task: taskId, platform, stage: "opened", resume: !!resume || previous?.task === taskId,
    completed: previous?.task === taskId ? previous.completed || [] : [] }
  await chrome.storage.session.set({ [`job:${tabId}`]: job })
  await reportStatus(job, "opened", "已在当前页面检查现有内容")
  await inject(tabId, platform)
  await chrome.tabs.sendMessage(tabId, { type: "start" })
  return { ok: true }
}

async function inspectTab(tabId) {
  const tab = await chrome.tabs.get(tabId)
  const platform = platformFor(tab.url)
  if (!platform) throw new Error("当前不是已适配的创作者页面")
  await inject(tabId, platform)
  return chrome.tabs.sendMessage(tabId, { type: "inspect-page" })
}

async function verificationTab(platform) {
  const config = PLATFORMS[platform]
  const tabs = await chrome.tabs.query({ url: `https://${config.host}/*` })
  const listed = tabs.find(tab => tab.url?.startsWith(config.records))
  if (listed?.id) return listed.id
  if (platform === "dayu" && tabs[0]?.id) return tabs[0].id
  const tab = await chrome.tabs.create({ url: config.records, active: false })
  if (!tab.id) throw new Error("无法打开作品记录页")
  await new Promise(resolve => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve() }, 20000)
    const listener = (id, change) => {
      if (id !== tab.id || change.status !== "complete") return
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
  return tab.id
}

async function verifyTask(taskId) {
  const bridge = await bridgeConnection()
  try {
    const payload = await taskPayload(bridge, taskId)
    const tabId = await verificationTab(payload.platform)
    const baseline = (await chrome.storage.session.get(`baseline:${taskId}`))[`baseline:${taskId}`]
    if (!Array.isArray(baseline)) throw new Error("缺少发布前记录快照，无法区分已有同名作品；请在平台后台核对")
    await inject(tabId, payload.platform)
    const result = await chrome.tabs.sendMessage(tabId, { type: "verify-record", payload, baseline })
    if (!result?.ok || !result.evidence) throw new Error(result?.error || "尚未在平台作品记录中找到本次发布，请稍后重试")
    await reportStatus({ ...bridge, task: taskId }, "verified", "已找到平台发布记录", result.evidence)
    return { ok: true, evidence: result.evidence }
  } catch (error) {
    await reportStatus({ ...bridge, task: taskId }, "check-failed", String(error.message || error)).catch(() => {})
    throw error
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  ;(async () => {
    if (message?.type === "pair" || message?.type === "verify") {
      if (!sender.tab?.id || !sender.url?.startsWith(`${message.base}/connect`)
        || !/^http:\/\/127\.0\.0\.1:\d+$/.test(message.base)
        || !/^[a-f0-9]{64}$/.test(message.token)) throw new Error("连接页地址无效")
      const bridge = { base: message.base, token: message.token }
      await bridgeFetch(bridge, "/api/tasks")
      await chrome.storage.local.set({ bridge })
      if (message.type === "verify") return verifyTask(message.task)
      if (message.task) {
        const payload = await taskPayload(bridge, message.task)
        const config = PLATFORMS[payload.platform]
        const tabs = await chrome.tabs.query({ url: `https://${config.host}/*` })
        const existing = tabs.filter(tab => tab.url?.startsWith(config.upload)).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0]
        if (existing?.id) {
          await chrome.tabs.update(existing.id, { active: true })
          if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {})
          await chrome.tabs.remove(sender.tab.id)
        } else await chrome.tabs.update(sender.tab.id, { url: config.upload })
      }
      return { ok: true }
    }
    if (message?.type === "list") {
      const bridge = await bridgeConnection()
      const listing = await (await bridgeFetch(bridge, "/api/tasks")).json()
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
      if (!PLATFORMS[message.platform]) throw new Error("平台未适配")
      await chrome.tabs.create({ url: PLATFORMS[message.platform].upload })
      return { ok: true }
    }
    if (!sender.tab?.id || !platformFor(sender.url)) throw new Error("仅支持已适配的创作者页面")
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
      if (message.step === "baseline" && Array.isArray(message.ids)) {
        await chrome.storage.session.set({ [`baseline:${job.task}`]: message.ids.filter(id => typeof id === "string").slice(0, 300) })
        return { ok: true }
      }
      if (message.step !== "cover") throw new Error("未知填写步骤")
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

chrome.tabs.onRemoved.addListener(tabId => { chrome.storage.session.remove(`job:${tabId}`) })
