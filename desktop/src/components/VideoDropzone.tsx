import { useEffect, useRef, useState } from "react"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { open } from "@tauri-apps/plugin-dialog"
import { Film, FolderOpen, X } from "lucide-react"
import { inDesktop, prepareVideoPreview } from "../cli"

const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "webm", "avi"]

export function VideoDropzone({ value, onChange, onError }: {
  value: string
  onChange: (path: string) => void
  onError: (message: string) => void
}) {
  const dropzone = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const accept = async (path: string) => {
    const extension = path.split(".").pop()?.toLowerCase()
    if (!extension || !VIDEO_EXTENSIONS.includes(extension)) {
      onError("请选择 MP4、MOV、MKV、WebM 或 AVI 视频文件")
      return
    }
    try {
      const prepared = await prepareVideoPreview(path)
      onError("")
      onChange(prepared)
    } catch (error) {
      onError(`无法读取视频：${String(error)}`)
    }
  }

  const choose = async () => {
    try {
      const path = await open({ multiple: false, filters: [{ name: "视频", extensions: VIDEO_EXTENSIONS }] })
      if (typeof path === "string") await accept(path)
    } catch (error) {
      onError(`选择视频失败：${String(error)}`)
    }
  }

  useEffect(() => {
    if (!inDesktop) return
    let active = true
    let unlisten: (() => void) | undefined
    const inside = (position: { x: number; y: number }) => {
      const rect = dropzone.current?.getBoundingClientRect()
      const x = position.x / window.devicePixelRatio
      const y = position.y / window.devicePixelRatio
      return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    }
    void getCurrentWindow().onDragDropEvent(event => {
      const payload = event.payload
      if (payload.type === "leave") { setDragging(false); return }
      const hovering = inside(payload.position)
      setDragging(hovering && payload.type !== "drop")
      if (payload.type === "drop" && hovering) {
        if (payload.paths.length !== 1) onError("一次只能选择一个视频文件")
        else void accept(payload.paths[0])
      }
    }).then(stop => { if (active) unlisten = stop; else stop() })
      .catch(error => onError(`无法接收拖拽文件：${String(error)}`))
    return () => { active = false; void unlisten?.() }
  }, [onChange, onError])

  const name = value.split(/[\\/]/).pop()
  return <div className="relative min-w-0">
    <div ref={dropzone} role="button" tabIndex={0} aria-label="选择或拖入视频文件"
      onClick={() => void choose()}
      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void choose() } }}
      className={`flex min-h-28 min-w-0 cursor-pointer items-center gap-3 rounded-md border-2 border-dashed py-3 pl-4 pr-14 transition-colors focus-visible:outline-2 focus-visible:outline-ring ${dragging ? "border-primary bg-accent" : "border-input bg-white hover:border-primary hover:bg-accent/40"}`}>
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-primary"><Film className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{name || "拖入视频，或点击选择文件"}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{value ? "已选择本地视频" : "MP4、MOV、MKV、WebM、AVI"}</span>
      </span>
      {!value && <FolderOpen className="absolute right-5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />}
    </div>
    {value && <button type="button" title="移除视频" aria-label="移除视频" onClick={() => onChange("")}
      className="absolute right-3 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" /></button>}
  </div>
}
