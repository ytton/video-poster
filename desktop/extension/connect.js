if (location.hostname === "127.0.0.1" && location.pathname === "/connect") {
  const token = new URLSearchParams(location.hash.slice(1)).get("token")
  const task = new URLSearchParams(location.hash.slice(1)).get("task")
  history.replaceState(null, "", location.pathname)
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    chrome.runtime.sendMessage({ type: "pair", token, task, base: location.origin }, result => {
      const message = !chrome.runtime.lastError && result?.ok
        ? "扩展已连接视频发布台。现在可以在抖音发布页点击扩展图标，选择作品自动补齐。"
        : chrome.runtime.lastError?.message || result?.error || "无法连接桌面程序"
      const show = () => {
        const paragraph = document.createElement("p")
        paragraph.textContent = message
        paragraph.style.color = result?.ok ? "#177245" : "#b42318"
        document.body.append(paragraph)
      }
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show, { once: true })
      else show()
    })
  }
}
