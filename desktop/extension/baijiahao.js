(() => {
  if (globalThis.__videoPosterBaijiahaoReady) return
  globalThis.__videoPosterBaijiahaoReady = true
  let active = false
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const visible = node => !!node?.getClientRects().length
  const titleNode = () => document.querySelector('div[class*="contentEditable"]')
  const hasVideo = () => !!titleNode() || !!document.querySelector('input[type="file"][accept*="video"]')?.files?.length
  const page = () => ({ uploadPage: location.pathname === "/builder/rc/edit" && new URLSearchParams(location.search).get("type") === "videoV2",
    video: hasVideo(), title: !!titleNode()?.textContent.trim(), description: false,
    cover: !!document.querySelector('[class*="cover"] img[src]'), declaration: !!document.querySelector('input[placeholder="请选择创作声明"]')?.value })

  function send(message) {
    return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, result => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
      else if (!result?.ok) reject(new Error(result?.error || "扩展操作失败"))
      else resolve(result)
    }))
  }

  async function waitFor(find, timeout, message) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const value = find()
      if (value) return value
      await sleep(350)
    }
    throw new Error(message)
  }

  async function media(job, asset) {
    const response = await fetch(asset.url, { headers: { Authorization: `Bearer ${job.token}` } })
    if (!response.ok) throw new Error(`无法读取本机文件（HTTP ${response.status}）`)
    const blob = await response.blob()
    if (blob.size !== asset.bytes) throw new Error("文件读取不完整")
    return new File([blob], asset.name, { type: asset.mime })
  }

  function setFile(input, file) {
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }

  function setEditor(node, value) {
    node.focus()
    node.textContent = value
    node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
  }

  async function waitForUpload() {
    const started = Date.now()
    let sawProgress = false
    let finishedChecks = 0
    while (Date.now() - started < 10 * 60 * 1000) {
      const text = document.body.textContent || ""
      if (text.includes("上传失败")) throw new Error("百家号显示视频上传失败")
      const progress = text.match(/(?:上传中|上传进度)[^\n]{0,24}?(\d{1,3})\s*%/)
      if (progress && Number(progress[1]) < 100) {
        sawProgress = true
        finishedChecks = 0
      } else if (sawProgress) {
        finishedChecks++
        if (finishedChecks >= 2) return
      } else if (Date.now() - started >= 15000) return
      await sleep(2000)
    }
    throw new Error("百家号上传进度未确认完成，请在当前页面核对")
  }

  function recordLinks() {
    if (!location.pathname.startsWith("/builder/rc/article")) throw new Error("请在百家号内容管理页面核对发布记录")
    const links = [...document.querySelectorAll('a[href*="article_id="],a[href*="/s?id="],a[href*="/builder/preview/s?id="]')]
    return links.map(link => {
      const url = new URL(link.href)
      const id = url.searchParams.get("article_id") || url.searchParams.get("id")
      const row = link.closest('tr,[class*="article-item"],[class*="content-item"]') || link.parentElement
      const title = link.textContent.trim()
      const status = row?.textContent || ""
      return { id, url: url.href, title, status }
    }).filter(item => item.id && item.title)
  }

  function verify(payload, baseline) {
    const matches = recordLinks().filter(item => item.title === payload.title && !baseline.includes(item.id)
      && /已发布|审核中|待审核|已通过/.test(item.status) && !/草稿|发布失败|未通过|已撤回/.test(item.status))
    if (matches.length !== 1) throw new Error(matches.length ? "百家号出现多条同名新作品，无法确定本次发布" : "尚未在百家号内容管理中找到本次已提交作品；请确认列表处于视频及全部状态")
    return { recordId: matches[0].id, recordUrl: matches[0].url, title: matches[0].title }
  }

  async function fill() {
    if (active) return
    active = true
    try {
      const { job } = await send({ type: "job" })
      const response = await fetch(`${job.base}/api/tasks/${job.task}`, { headers: { Authorization: `Bearer ${job.token}` } })
      if (!response.ok) throw new Error("无法读取作品资料")
      const payload = await response.json()
      if (payload.platform !== "baijiahao" || !page().uploadPage) throw new Error("请打开百家号视频发布页")
      if (!hasVideo()) {
        if (job.resume) throw new Error("当前页面未识别到已上传视频；继续填写不会重新上传")
        const input = await waitFor(() => document.querySelector('input[type="file"][accept*="video"],input[type="file"][accept*="mp4"]'), 30000, "找不到百家号视频接收框")
        await send({ type: "status", status: "uploading", message: "正在交给百家号上传视频" })
        setFile(input, await media(job, payload.video))
      }
      const title = await waitFor(titleNode, 180000, "尚未出现百家号标题编辑区")
      await waitForUpload()
      await send({ type: "status", status: "filling", message: "正在补齐百家号发布资料" })
      const currentTitle = title.textContent.trim()
      const fileStem = payload.video.name.replace(/\.[^.]+$/, "")
      if (!currentTitle || currentTitle === fileStem || currentTitle === payload.video.name) setEditor(title, payload.title)
      if (payload.declaration === "内容由AI生成") {
        const trigger = document.querySelector('input[placeholder="请选择创作声明"]')
        if (trigger && !trigger.value.trim()) {
          trigger.click()
          const option = await waitFor(() => [...document.querySelectorAll("label,span,div")].find(node =>
            visible(node) && node.childElementCount === 0 && node.textContent.trim() === "含AI生成内容"), 8000, "百家号 AI 声明选项未出现")
          option.click()
          const confirm = [...document.querySelectorAll("button")].find(node => visible(node) && node.textContent.trim() === "确定")
          confirm?.click()
        }
      }
      if (payload.landscape && !document.querySelector('[class*="cover"] img[src]') && !job.completed.includes("cover")) {
        const entry = document.querySelector('[data-testid="select-cover"]') || [...document.querySelectorAll("button,span")].find(node => visible(node) && node.textContent.trim() === "选择封面")
        if (entry) {
          entry.click()
          const tab = await waitFor(() => [...document.querySelectorAll("button,span")].find(node => visible(node) && node.textContent.trim() === "上传"), 10000, "封面上传选项未出现")
          tab.click()
          const input = await waitFor(() => document.querySelector('input[type="file"][accept*="image"],input[type="file"][accept*="jpg"],input[type="file"][accept*="png"]'), 10000, "封面图片接收框未出现")
          setFile(input, await media(job, payload.landscape))
          const finish = await waitFor(() => [...document.querySelectorAll("button")].find(node => visible(node) && /^(确定|完成|确认)$/.test(node.textContent.trim())), 15000, "封面确认按钮未出现")
          finish.click()
          await send({ type: "checkpoint", step: "cover" })
        }
      }
      await send({ type: "status", status: "prepared", message: "已补齐可识别项目；请核对简介、标签和声明，并亲自点击百家号发布" })
    } catch (error) {
      await send({ type: "status", status: "failed", message: String(error.message || error) }).catch(() => {})
    } finally { active = false }
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === "inspect-page") { respond({ ok: true, page: page() }); return }
    if (message?.type === "start") { void fill(); respond({ ok: true }); return }
    if (message?.type === "capture-records") {
      try { respond({ ok: true, ids: recordLinks().map(item => item.id) }) }
      catch (error) { respond({ ok: false, error: String(error.message || error) }) }
      return
    }
    if (message?.type === "verify-record") {
      try { respond({ ok: true, evidence: verify(message.payload, message.baseline) }) }
      catch (error) { respond({ ok: false, error: String(error.message || error) }) }
    }
  })
})()
