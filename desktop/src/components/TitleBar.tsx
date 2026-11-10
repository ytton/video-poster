import { useEffect, useState } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { Settings, Minus, Square, Copy, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { inDesktop } from "../native"

export function TitleBar({ onSettings }: { onSettings: () => void }) {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    if (!inDesktop) return
    const window = getCurrentWindow()
    void window.isMaximized().then(setMaximized)
    let stop: (() => void) | undefined
    void window.onResized(() => { void window.isMaximized().then(setMaximized) }).then(fn => { stop = fn })
    return () => stop?.()
  }, [])
  const close = () => { if (inDesktop) void getCurrentWindow().close() }
  return <header className="flex h-9 shrink-0 items-center border-b border-border bg-white pl-3 select-none">
    <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
      <span className="grid size-5 place-items-center rounded bg-primary text-white"><span className="ml-0.5 text-[10px]">▶</span></span>
      视频发布台
    </div>
    <div className="h-full flex-1" data-tauri-drag-region onDoubleClick={() => { if (inDesktop) void getCurrentWindow().toggleMaximize() }} />
    <Button variant="ghost" size="icon-sm" className="size-9 rounded-none" title="设置" onClick={onSettings}><Settings /></Button>
    <Button variant="ghost" size="icon-sm" className="size-9 rounded-none" title="最小化" onClick={() => { if (inDesktop) void getCurrentWindow().minimize() }}><Minus /></Button>
    <Button variant="ghost" size="icon-sm" className="size-9 rounded-none" title={maximized ? "还原" : "最大化"} onClick={() => { if (inDesktop) void getCurrentWindow().toggleMaximize() }}>{maximized ? <Copy /> : <Square />}</Button>
    <Button variant="ghost" size="icon-sm" className="size-9 rounded-none hover:bg-destructive hover:text-white" title="关闭" onClick={close}><X /></Button>
  </header>
}
