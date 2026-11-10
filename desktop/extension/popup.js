function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, result => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
      else if (!result?.ok) reject(new Error(result?.error || "扩展操作失败"))
      else resolve(result)
    })
  })
}

const context = document.getElementById("context")
const list = document.getElementById("list")
const message = document.getElementById("message")
const openUpload = document.getElementById("open-upload")
const labels = { queued: "待填写", opened: "已接管", uploading: "上传中", filling: "填写中", failed: "可继续", prepared: "待人工发布" }

async function render() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    const onDouyin = tab?.url?.startsWith("https://creator.douyin.com/")
    let canFill = false
    let page = null
    context.textContent = onDouyin ? "当前抖音标签页可直接补齐资料" : "先切到抖音创作者页面，再选择作品"
    if (onDouyin) {
      try {
        const result = await send({ type: "inspect", tabId: tab.id })
        page = result.page
        canFill = page.uploadPage
        context.textContent = page.uploadPage
          ? `当前页面：${page.video ? "视频已上传" : "视频待上传"} · ${page.title ? "标题已有" : "标题待填"} · ${page.description ? "简介已有" : "简介待填"}`
          : "当前不是视频上传页，请打开抖音上传页"
      } catch (error) {
        context.textContent = `当前页面暂时无法检查：${error.message}`
      }
    }
    openUpload.hidden = canFill
    openUpload.onclick = () => void send({ type: "open-upload" })
      .then(() => window.close()).catch(error => { message.textContent = error.message })
    const result = await send({ type: "list" })
    const { activeTaskId } = await chrome.storage.local.get("activeTaskId")
    list.replaceChildren()
    if (!result.tasks.length) { list.textContent = "软件中还没有待填写作品"; return }
    for (const task of result.tasks) {
      const row = document.createElement("article")
      const info = document.createElement("div")
      const title = document.createElement("b")
      title.textContent = task.title
      const status = document.createElement("small")
      status.textContent = labels[task.status] || task.status
      info.append(title, status)
      const button = document.createElement("button")
      if (task.id === activeTaskId) row.style.borderColor = "#17657b"
      const resume = task.status !== "queued" || !!(page?.video || page?.title || page?.description || page?.cover || page?.declaration)
      button.textContent = resume ? "补齐剩余内容" : "自动填写"
      button.className = "primary"
      button.disabled = !canFill
      button.onclick = async () => {
        button.disabled = true
        message.textContent = "正在检查当前页面…"
        try {
          await send({ type: "start", tabId: tab.id, taskId: task.id, resume })
          window.close()
        } catch (error) {
          message.textContent = error.message
          button.disabled = false
        }
      }
      row.append(info, button)
      list.append(row)
    }
  } catch (error) {
    message.textContent = error.message
  }
}

void render()
