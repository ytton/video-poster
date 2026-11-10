(() => {
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
    shadow.innerHTML = `<style>div{width:260px;box-sizing:border-box;padding:13px 14px;border:1px solid #d5dce0;border-radius:6px;background:#fff;box-shadow:0 8px 30px #0002;color:#283438;font:13px/1.5 system-ui}strong{display:block;margin-bottom:4px}p{margin:0;white-space:pre-wrap}button{margin-top:8px;border:1px solid #ccd4d7;border-radius:4px;background:#fff;padding:5px 10px;cursor:pointer}</style><div><strong>视频发布台</strong><p></p><button hidden>重试填写</button></div>`
    document.documentElement.append(host)
    return shadow
  }

  function show(message, retry = false) {
    const root = panel()
    root.querySelector("p").textContent = message
    const button = root.querySelector("button")
    button.hidden = !retry
    button.onclick = retry ? async () => {
      await send({ type: "retry" })
      location.reload()
    } : null
  }

  async function status(value, message) {
    show(message, value === "failed")
    await send({ type: "status", status: value, message })
  }

  async function waitFor(selector, timeout = 120000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const found = document.querySelector(selector)
      if (found) return found
      await new Promise(resolve => setTimeout(resolve, 350))
    }
    throw new Error(`抖音页面未出现所需控件：${selector}`)
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

  function fillInput(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set
    setter.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }

  function exactText(text, scope = document) {
    return [...scope.querySelectorAll("button,span,label,div")].find(element =>
      element.childElementCount === 0 && element.textContent.trim() === text && element.getClientRects().length)
  }

  async function setCover(job, payload) {
    if (!payload.portrait && !payload.landscape) return
    let trigger = ["编辑封面", "选择封面", "设置封面"].map(text => exactText(text)).find(Boolean)
    if (!trigger) trigger = document.querySelector('[class*="cover-"] img')?.closest('[class*="cover-"]')
    if (!trigger) throw new Error("找不到封面入口，请在抖音页面手动设置封面")
    trigger.click()
    const dialog = await waitFor("div.dy-creator-content-modal", 10000)
    for (const [label, asset] of [["设置竖封面", payload.portrait], ["设置横封面", payload.landscape]]) {
      if (!asset) continue
      exactText(label, dialog)?.click()
      await new Promise(resolve => setTimeout(resolve, 500))
      const input = dialog.querySelector('.semi-upload:has(.semi-upload-drag-area-main-text) input.semi-upload-hidden-input')
        || [...dialog.querySelectorAll("input.semi-upload-hidden-input")].at(-1)
      if (!input) throw new Error(`找不到${label}的图片上传框`)
      setFile(input, await fileFromBridge(job, asset))
      await new Promise(resolve => setTimeout(resolve, 1400))
    }
    const finish = [...dialog.querySelectorAll("button")].find(button => button.textContent.trim() === "完成")
    if (!finish) throw new Error("找不到封面设置的完成按钮")
    const end = Date.now() + 30000
    while (finish.disabled || finish.classList.contains("semi-button-disabled")) {
      if (Date.now() > end) throw new Error("抖音尚未处理完封面图片")
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    finish.click()
    await new Promise(resolve => setTimeout(resolve, 1200))
    if (document.contains(dialog) && dialog.getClientRects().length) {
      const confirm = ["确定", "确认", "仍然完成"].map(text => exactText(text)).find(Boolean)
      confirm?.click()
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    if (document.contains(dialog) && dialog.getClientRects().length) throw new Error("封面窗口未关闭，请在抖音页面检查封面")
  }

  async function setDeclaration(value) {
    if (!value) return
    const entry = ["请选择自主声明", "请选择声明类型", "添加自主声明", "自主声明", "作品声明"]
      .map(text => exactText(text)).find(Boolean)
    if (!entry) throw new Error("找不到自主声明入口，请在抖音页面手动设置")
    entry.click()
    const dialog = await waitFor(".semi-modal-content", 8000)
    if (!dialog.textContent.includes("声明类型")) throw new Error("自主声明窗口未打开")
    const option = [...dialog.querySelectorAll("label.semi-radio")].find(label => label.textContent.includes(value))
    if (!option) throw new Error(`当前页面没有声明选项：${value}`)
    option.click()
    const confirm = [...dialog.querySelectorAll("button")].find(button => button.textContent.trim() === "确定")
    if (!confirm) throw new Error("找不到自主声明确认按钮")
    confirm.click()
  }

  async function waitForUploadComplete() {
    const end = Date.now() + 30 * 60 * 1000
    while (Date.now() < end) {
      const card = [...document.querySelectorAll('[class^="long-card"], [class*="long-card"]')]
        .find(element => element.textContent.includes("重新上传"))
      if (card) return
      const progress = document.querySelector("div.progress-div")
      if (progress?.textContent.includes("上传失败")) throw new Error("抖音显示视频上传失败，请在页面中重试")
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    throw new Error("尚未确认抖音视频上传完成，请在页面中核对上传进度")
  }

  async function fill(job) {
    if (active) return
    active = true
    try {
      const response = await fetch(`${job.base}/api/tasks/${job.task}`, { headers: { Authorization: `Bearer ${job.token}` } })
      if (!response.ok) throw new Error(`无法获取任务（HTTP ${response.status}）`)
      const payload = await response.json()
      if (payload.id !== job.task) throw new Error("任务编号不匹配")
      if (location.pathname.endsWith("/upload")) {
        await status("uploading", "正在从桌面程序读取视频并交给抖音上传")
        const input = await waitFor('input.upload-btn-input, div[class^="container"] input[accept*="video"], div[class^="container"] input[type="file"]', 60000)
        setFile(input, await fileFromBridge(job, payload.video))
      }
      await status("filling", "等待抖音发布表单，准备填写资料")
      const title = await waitFor('input[placeholder*="填写作品标题"]', 120000)
      fillInput(title, payload.title)
      const editor = await waitFor('div.zone-container[contenteditable="true"]', 120000)
      editor.focus()
      document.execCommand("selectAll", false)
      const description = [payload.description.trim(), ...payload.tags.map(tag => `#${tag}`)].filter(Boolean).join(" ")
      document.execCommand("insertText", false, description)
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: description }))
      if (editor.textContent.trim() !== description) throw new Error("简介或话题未完整写入，请在抖音页面检查")
      await setDeclaration(payload.declaration)
      await setCover(job, payload)
      await waitForUploadComplete()
      await status("prepared", "视频与资料已填好，请在抖音页面核对并亲自点击发布")
    } catch (error) {
      const message = String(error?.message || error)
      if (!location.pathname.includes("/creator-micro/content/")) {
        try { await status("opened", "请先在浏览器登录抖音，返回上传页后会继续填写") }
        catch { show("请先在浏览器登录抖音，返回上传页后会继续填写") }
      } else {
        try { await status("failed", message) } catch { show(message, true) }
      }
    } finally {
      active = false
    }
  }

  async function init() {
    const result = await send({ type: "job" }).catch(() => null)
    if (!result?.job) return
    if (result.job.stage === "prepared") { show("资料已填好，请核对并亲自点击发布"); return }
    if (result.job.stage === "failed") { show("上次填写未完成，请点击重试", true); return }
    if (!/\/content\/(upload|publish|post\/video)/.test(location.pathname)) {
      if (location.pathname.startsWith("/creator-micro/")) {
        location.assign("https://creator.douyin.com/creator-micro/content/upload")
        return
      }
      show("请先在浏览器完成抖音登录，再回到发布页。")
      return
    }
    void fill(result.job)
  }

  void init()
  let previousPath = location.pathname
  window.setInterval(() => {
    if (location.pathname === previousPath) return
    previousPath = location.pathname
    if (!active) void init()
  }, 1000)
})()
