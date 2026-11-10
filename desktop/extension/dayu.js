(() => {
  if (globalThis.__videoPosterDayuReady) return
  globalThis.__videoPosterDayuReady = true
  let active = false
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const visible = node => !!node?.getClientRects().length
  const titleNode = () => document.querySelector('[contenteditable="true"][placeholder="视频标题最少5个字"]')
  const videoRegion = () => document.querySelector(".article-write_video-container")
  const hasVideo = () => {
    const text = videoRegion()?.textContent || ""
    return /视频上传成功|处理完成|处理中|上传中|\d+%/.test(text)
      || !!videoRegion()?.querySelector('input[name="file"]')?.files?.length
  }
  const page = () => ({ uploadPage: location.pathname.includes("/dashboard/video/write"), video: hasVideo(),
    title: !!titleNode()?.textContent.trim(), description: !!document.querySelector(".w-form-field textarea")?.value.trim(),
    cover: !!document.querySelector("#coverImg #form_main_cover_img[src]"), declaration: !!document.querySelector('input[type=radio]:checked') })

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
      await sleep(400)
    }
    throw new Error(message)
  }

  async function media(job, asset) {
    const response = await fetch(asset.url, { headers: { Authorization: `Bearer ${job.token}` } })
    if (!response.ok) throw new Error(`无法读取本机文件（HTTP ${response.status}）`)
    const blob = await response.blob()
    if (blob.size !== asset.bytes) throw new Error("视频文件读取不完整")
    return new File([blob], asset.name, { type: asset.mime })
  }

  function setFile(input, file) {
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }

  function fillEditor(node, value) {
    node.focus()
    node.textContent = value
    node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }))
  }

  function fillInput(node, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set
    setter.call(node, value)
    node.dispatchEvent(new Event("input", { bubbles: true }))
    node.dispatchEvent(new Event("change", { bubbles: true }))
  }

  async function records() {
    const all = []
    let total = 1
    for (let index = 1; index <= total && index <= 50; index++) {
      const response = await fetch(`/dashboard/getNewContentList?_rid=${crypto.randomUUID().replaceAll("-", "")}&currentView=all&source=all&page=${index}&currentTab=all&_=${Date.now()}`, { credentials: "include" })
      if (!response.ok) throw new Error(`大鱼号作品查询失败（HTTP ${response.status}）`)
      const data = await response.json()
      if (!Array.isArray(data?.dataList?.data)) throw new Error("大鱼号作品记录格式变化，请在后台核对")
      total = Number(data.dataList.totalPage) || 1
      if (total > 50) throw new Error("大鱼号作品记录超过检验范围，请在后台核对")
      all.push(...data.dataList.data)
    }
    return all
  }

  async function verify(payload, baseline) {
    const items = await records()
    const matches = items.filter(item => item.title === payload.title && item.content_id
      && !baseline.includes(String(item.content_id)) && [1, 3, 5].includes(Number(item.status)))
    if (matches.length !== 1) throw new Error(matches.length ? "有多条同名新作品，无法确定本次发布" : "尚未找到本次大鱼号已提交的作品记录")
    const item = matches[0]
    return { recordId: String(item.content_id), recordUrl: String(item.ucUrl || location.origin + "/dashboard/index"), title: item.title }
  }

  async function fill() {
    if (active) return
    active = true
    try {
      const { job } = await send({ type: "job" })
      const response = await fetch(`${job.base}/api/tasks/${job.task}`, { headers: { Authorization: `Bearer ${job.token}` } })
      if (!response.ok) throw new Error("无法读取作品资料")
      const payload = await response.json()
      if (payload.platform !== "dayu" || !page().uploadPage) throw new Error("请打开大鱼号视频发布页")
      if (!hasVideo()) {
        if (job.resume) throw new Error("当前页面未识别到已上传视频；继续填写不会重新上传")
        const input = await waitFor(() => document.querySelector('input[type="file"][name="file"]'), 30000, "找不到大鱼号视频接收框")
        await send({ type: "status", status: "uploading", message: "正在交给大鱼号上传视频" })
        setFile(input, await media(job, payload.video))
      }
      const title = await waitFor(titleNode, 120000, "尚未出现大鱼号标题输入框")
      await waitFor(() => videoRegion()?.textContent.includes("视频上传成功，处理完成"), 30 * 60 * 1000, "大鱼号尚未完成视频处理")
      await send({ type: "status", status: "filling", message: "正在补齐大鱼号发布资料" })
      if (!title.textContent.trim()) fillEditor(title, payload.title)
      const description = document.querySelector(".w-form-field textarea")
      if (description && !description.value.trim() && payload.description) fillInput(description, payload.description.slice(0, 200))
      const tags = document.querySelector(".article-write_video-tags")
      if (tags) for (const tag of payload.tags) {
        const exists = [...tags.querySelectorAll("input")].some(input => input.value === tag)
        if (exists) continue
        const input = [...tags.querySelectorAll("input")].find(input => !input.value.trim())
        if (!input) break
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set
        setter.call(input, tag.slice(0, 10))
        input.dispatchEvent(new Event("input", { bubbles: true }))
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
        await sleep(300)
      }
      const sourceValue = payload.declaration === "内容为转载信息" ? "转载"
        : payload.declaration === "内容由AI生成" ? "AI生成"
          : payload.declaration === "内容为个人观点或见解" ? "个人观点" : "无需标注"
      const source = [...document.querySelectorAll('input[type="radio"]')].find(input => input.value === sourceValue)
      if (source && !source.checked) source.click()
      if (payload.landscape && !document.querySelector("#coverImg #form_main_cover_img[src]") && !job.completed.includes("cover")) {
        const coverInput = document.querySelector('#coverImg input[type="file"]')
        if (coverInput) {
          setFile(coverInput, await media(job, payload.landscape))
          const dialog = await waitFor(() => [...document.querySelectorAll(".article-material-image-dialog")].find(visible), 30000, "封面裁剪窗口未出现")
          const save = [...dialog.querySelectorAll("button")].find(button => button.textContent.trim() === "保存")
          if (!save) throw new Error("找不到大鱼号封面保存按钮")
          save.click()
          await waitFor(() => !!document.querySelector("#coverImg #form_main_cover_img[src]"), 30000, "封面尚未保存")
          await send({ type: "checkpoint", step: "cover" })
        }
      }
      await send({ type: "status", status: "prepared", message: "已补齐可识别项目；请核对视频分类及转载原文链接，并在大鱼号点击发表" })
    } catch (error) {
      await send({ type: "status", status: "failed", message: String(error.message || error) }).catch(() => {})
    } finally { active = false }
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === "inspect-page") { respond({ ok: true, page: page() }); return }
    if (message?.type === "start") { void fill(); respond({ ok: true }); return }
    if (message?.type === "capture-records") {
      void records().then(items => respond({ ok: true, ids: items.filter(item => item.content_id).map(item => String(item.content_id)) }))
        .catch(error => respond({ ok: false, error: String(error.message || error) }))
      return true
    }
    if (message?.type === "verify-record") {
      void verify(message.payload, message.baseline).then(evidence => respond({ ok: true, evidence }))
        .catch(error => respond({ ok: false, error: String(error.message || error) }))
      return true
    }
  })
})()
