(() => {
  if (globalThis.__videoPosterContentReady) return
  globalThis.__videoPosterContentReady = true
  let active = false

  function send(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, result => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
        else if (!result?.ok) reject(new Error(result?.error || "扩展操作失败"))
        else resolve(result)
      })
    })
  }

  function panel() {
    let host = document.getElementById("video-poster-status")
    if (host) return host.shadowRoot
    host = document.createElement("div")
    host.id = "video-poster-status"
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647"
    const shadow = host.attachShadow({ mode: "open" })
    shadow.innerHTML = `<style>div{width:280px;box-sizing:border-box;padding:13px 14px;border:1px solid #d5dce0;border-radius:6px;background:#fff;box-shadow:0 8px 30px #0002;color:#283438;font:13px/1.5 system-ui}strong{display:block;margin-bottom:4px}p{margin:0;white-space:pre-wrap}button{margin-top:8px;border:1px solid #ccd4d7;border-radius:4px;background:#fff;padding:5px 10px;cursor:pointer}</style><div><strong>视频发布台</strong><p></p><button hidden>继续填写</button></div>`
    document.documentElement.append(host)
    return shadow
  }

  function show(message, retry = false) {
    const root = panel()
    root.querySelector("p").textContent = message
    const button = root.querySelector("button")
    button.hidden = !retry
    button.onclick = retry ? () => void retryHere() : null
  }

  async function retryHere() {
    try {
      const result = await send({ type: "retry" })
      await fill(result.job)
    } catch (error) {
      show(String(error.message || error), true)
    }
  }

  async function status(value, message) {
    show(message, value === "failed")
    await send({ type: "status", status: value, message })
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const visible = element => !!element?.getClientRects().length

  async function waitUntil(find, timeout, message) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const value = find()
      if (value) return value
      await sleep(350)
    }
    throw new Error(message)
  }

  function exactText(text, scope = document) {
    return [...scope.querySelectorAll("button,span,label,div")].find(element =>
      element.childElementCount === 0 && element.textContent.trim() === text && visible(element))
  }

  async function fileFromBridge(job, asset) {
    const response = await fetch(asset.url, { headers: { Authorization: `Bearer ${job.token}` } })
    if (!response.ok) throw new Error(`无法读取本地文件（HTTP ${response.status}）`)
    const blob = await response.blob()
    if (blob.size !== asset.bytes) throw new Error("本地文件读取不完整，请重试")
    return new File([blob], asset.name, { type: asset.mime, lastModified: Date.now() })
  }

  function setFile(input, file) {
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }

  function titleInput() {
    return document.querySelector('input[placeholder*="填写作品标题"]')
  }

  function hasVideo() {
    if (titleInput()) return true
    if (document.querySelector('input.upload-btn-input')?.files?.length) return true
    if (document.querySelector('video[src]')) return true
    const uploadArea = [...document.querySelectorAll('[class*="long-card"], div.progress-div')]
      .map(element => element.textContent).join(" ")
    return /重新上传|上传中|上传成功|上传完成|处理中|检测中|\d+%/.test(uploadArea)
  }

  async function ensureVideo(job, payload) {
    if (hasVideo()) return
    if (!location.pathname.endsWith("/upload")) {
      throw new Error("当前页面不是抖音视频上传页。请切到上传页，或在这里手动上传视频后再点扩展。")
    }
    await status("uploading", "当前页面尚无视频，正在交给抖音上传")
    const input = await waitUntil(
      () => document.querySelector('input.upload-btn-input, div[class^="container"] input[accept*="video"], div[class^="container"] input[type="file"]'),
      60000, "未找到抖音的视频接收框",
    )
    if (hasVideo()) return
    setFile(input, await fileFromBridge(job, payload.video))
  }

  function fillInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }

  function appendEditor(editor, text) {
    editor.focus()
    const selection = document.getSelection()
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
    document.execCommand("insertText", false, text)
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }))
  }

  async function fillText(payload) {
    const title = await waitUntil(titleInput, 120000, "抖音尚未显示标题输入框，请检查视频是否已上传")
    if (!title.value.trim()) fillInput(title, payload.title)
    const editor = await waitUntil(() => document.querySelector('div.zone-container[contenteditable="true"]'),
      120000, "抖音尚未显示简介输入框")
    const existing = editor.textContent.trim()
    if (!existing.replace(/#([^\s#]+)/g, "").trim() && payload.description.trim()) {
      appendEditor(editor, `${existing ? " " : ""}${payload.description.trim()}`)
    }
    const currentTags = new Set([...editor.textContent.matchAll(/#([^\s#]+)/g)].map(match => match[1].trim()))
    const missing = payload.tags.filter(tag => !currentTags.has(tag))
    if (missing.length) appendEditor(editor, `${editor.textContent.trim() ? " " : ""}${missing.map(tag => `#${tag}`).join(" ")}`)
    if (!title.value.trim()) throw new Error("标题未能写入，请在抖音页面检查")
    for (const tag of payload.tags) {
      if (!editor.textContent.includes(`#${tag}`)) throw new Error(`话题 #${tag} 未能写入`)
    }
  }

  function declarationDialog() {
    const direct = [...document.querySelectorAll('[role="dialog"],.semi-modal-content,[class*="modal-content"]')]
      .find(element => visible(element) && /对作品内容添加声明|请选择声明类型/.test(element.textContent))
    if (direct) return direct
    const heading = exactText("对作品内容添加声明") || exactText("请选择声明类型（单选）")
    let parent = heading?.parentElement
    while (parent && parent !== document.body) {
      if (visible(parent) && [...parent.querySelectorAll("button")].some(button => button.textContent.trim() === "确定")
        && parent.textContent.includes("内容由AI生成")) return parent
      parent = parent.parentElement
    }
    return null
  }

  async function setDeclaration(value) {
    let dialog = declarationDialog()
    if (!dialog && !value) return
    if (!dialog && value) {
      if (exactText(value)) return
      const entry = ["请选择自主声明", "请选择声明类型", "添加自主声明", "自主声明", "作品声明", "添加声明"]
        .map(text => exactText(text)).find(Boolean)
      if (!entry) throw new Error("找不到抖音的作品声明入口，请在页面中手动设置")
      entry.click()
      dialog = await waitUntil(declarationDialog, 8000, "作品声明弹窗未打开")
    }
    if (!dialog) return
    const choice = value || "无需添加自主声明"
    const option = [...dialog.querySelectorAll('label,[role="radio"]')]
      .find(element => visible(element) && element.textContent.trim().includes(choice)) || exactText(choice, dialog)
    if (!option) throw new Error(`当前声明弹窗中没有“${choice}”选项`)
    const selected = option.matches('[aria-checked="true"],.semi-radio-checked')
      || !!option.querySelector('input[type="radio"]:checked,[aria-checked="true"],.semi-radio-checked')
    if (!selected) option.click()
    const confirm = await waitUntil(() => [...dialog.querySelectorAll("button")]
      .find(button => visible(button) && button.textContent.trim() === "确定" && !button.disabled),
    10000, "作品声明还不能确认，请检查弹窗")
    confirm.click()
    await waitUntil(() => !visible(dialog), 8000, "作品声明弹窗未关闭，请在页面中确认")
  }

  function coverDialog() {
    return [...document.querySelectorAll("div.dy-creator-content-modal")].find(visible)
  }

  function coverAlreadySet() {
    const edit = exactText("编辑封面")
    return !!edit && !!document.querySelector('[class*="cover"] img[src]')
  }

  async function setCover(job, payload) {
    if (!payload.portrait && !payload.landscape) return
    let dialog = coverDialog()
    if (!dialog && job.completed?.includes("cover") && coverAlreadySet()) return
    if (!dialog) {
      const trigger = ["编辑封面", "选择封面", "设置封面"].map(text => exactText(text)).find(Boolean)
        || document.querySelector('[class*="cover-"] img')?.closest('[class*="cover-"]')
      if (!trigger) throw new Error("找不到封面入口，请在抖音页面手动设置封面")
      trigger.click()
      dialog = await waitUntil(coverDialog, 10000, "封面设置弹窗未打开")
    }
    for (const [label, asset] of [["设置竖封面", payload.portrait], ["设置横封面", payload.landscape]]) {
      if (!asset) continue
      exactText(label, dialog)?.click()
      await sleep(400)
      const area = dialog.querySelector('.semi-upload:has(.semi-upload-drag-area-main-text)')
      if (area?.querySelector("img[src]")) continue
      const input = area?.querySelector("input.semi-upload-hidden-input")
        || [...dialog.querySelectorAll("input.semi-upload-hidden-input")].at(-1)
      if (!input) throw new Error(`找不到${label}的图片上传框`)
      setFile(input, await fileFromBridge(job, asset))
      await sleep(1200)
    }
    const finish = await waitUntil(() => [...dialog.querySelectorAll("button")]
      .find(button => visible(button) && button.textContent.trim() === "完成" && !button.disabled
        && !button.classList.contains("semi-button-disabled")), 30000, "抖音尚未处理完封面图片")
    finish.click()
    await sleep(800)
    if (visible(dialog)) {
      const confirm = ["确定", "确认", "仍然完成"].map(text => exactText(text)).find(Boolean)
      confirm?.click()
    }
    await waitUntil(() => !visible(dialog), 8000, "封面窗口未关闭，请在抖音页面检查封面")
    await send({ type: "checkpoint", step: "cover" })
  }

  async function waitForUploadComplete() {
    const end = Date.now() + 30 * 60 * 1000
    let noProgressSince = 0
    while (Date.now() < end) {
      const cards = [...document.querySelectorAll('[class*="long-card"]')]
      if (cards.some(element => element.textContent.includes("重新上传"))) return
      const progress = document.querySelector("div.progress-div")?.textContent || ""
      if (progress.includes("上传失败")) throw new Error("抖音显示视频上传失败，请在页面中重试")
      if (titleInput() && !/上传中|\d+%|处理中/.test(progress)) {
        if (!noProgressSince) noProgressSince = Date.now()
        if (Date.now() - noProgressSince > 5000) return
      } else noProgressSince = 0
      await sleep(1500)
    }
    throw new Error("尚未确认抖音视频上传完成，请在页面中核对上传进度")
  }

  async function fill(job) {
    if (active) return
    active = true
    try {
      const response = await fetch(`${job.base}/api/tasks/${job.task}`, { headers: { Authorization: `Bearer ${job.token}` } })
      if (!response.ok) throw new Error(`无法获取作品（HTTP ${response.status}）`)
      const payload = await response.json()
      if (payload.id !== job.task) throw new Error("作品任务不匹配")
      await ensureVideo(job, payload)
      await status("filling", "正在检查并补齐标题、简介、标签、声明和封面")
      if (declarationDialog()) await setDeclaration(payload.declaration)
      await fillText(payload)
      await setDeclaration(payload.declaration)
      await setCover(job, payload)
      await waitForUploadComplete()
      await status("prepared", "资料已补齐，请在抖音页面核对并亲自点击发布")
    } catch (error) {
      const message = String(error?.message || error)
      try { await status("failed", message) } catch { show(message, true) }
    } finally {
      active = false
    }
  }

  async function runCurrentJob() {
    const result = await send({ type: "job" })
    await fill(result.job)
  }

  function inspectPage() {
    const editor = document.querySelector('div.zone-container[contenteditable="true"]')
    return {
      uploadPage: /\/content\/(upload|publish|post\/video)/.test(location.pathname) || !!titleInput(),
      video: hasVideo(), title: !!titleInput()?.value.trim(),
      description: !!editor?.textContent.trim(), cover: coverAlreadySet(),
      declaration: !!declarationDialog() || !!exactText("内容由AI生成") || !!exactText("内容为转载信息")
        || !!exactText("内容为个人观点或见解"),
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === "inspect-page") { respond({ ok: true, page: inspectPage() }); return }
    if (message?.type !== "start") return
    void runCurrentJob().catch(error => show(String(error.message || error), true))
    respond({ ok: true })
  })

  async function init() {
    const result = await send({ type: "job" }).catch(() => null)
    if (!result?.job) return
    if (result.job.stage === "prepared") { show("资料已补齐，请核对并亲自点击发布"); return }
    if (result.job.stage === "failed") { show("上次填写未完成，可以在当前页面继续", true); return }
    if (["opened", "uploading", "filling"].includes(result.job.stage)) {
      if (/\/content\/(upload|publish|post\/video)/.test(location.pathname)) void fill(result.job)
      else show("请切到抖音视频上传页后点击扩展图标继续")
    }
  }

  void init()
  let previousPath = location.pathname
  window.setInterval(() => {
    if (location.pathname === previousPath) return
    previousPath = location.pathname
    if (!active) void init()
  }, 1000)
})()
