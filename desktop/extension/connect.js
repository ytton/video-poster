if (location.hostname === "127.0.0.1" && location.pathname === "/connect") {
  const params = new URLSearchParams(location.hash.slice(1))
  const task = params.get("task")
  const token = params.get("token")
  history.replaceState(null, "", location.pathname)
  if (task && token && /^[a-f0-9-]{36}$/.test(task) && /^[a-f0-9]{64}$/.test(token)) {
    chrome.runtime.sendMessage({ type: "connect", task, token, base: location.origin }, result => {
      if (!chrome.runtime.lastError && result?.ok) return
      const message = chrome.runtime.lastError?.message || result?.error || "无法连接桌面程序"
      document.addEventListener("DOMContentLoaded", () => {
        const paragraph = document.createElement("p")
        paragraph.textContent = message
        paragraph.style.color = "#b42318"
        document.body.append(paragraph)
      }, { once: true })
    })
  }
}
