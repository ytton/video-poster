import { useEffect, useRef, useState } from "react"
import { convertFileSrc } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { ImagePlus, X } from "lucide-react"
import { inDesktop, prepareCoverPreview } from "../cli"

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png"]

export function CoverDropzone({ label, ratio, videoPath, value, onChange, onOpenPicker, onError }: {
  label: string
  ratio: "4:3" | "3:4"
  videoPath: string
  value: string
  onChange: (path: string) => void
  onOpenPicker: () => void
  onError: (message: string) => void
}) {
  const dropzone = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [previewError, setPreviewError] = useState(false)
  const [videoError, setVideoError] = useState(false)
  const previewUrl = value && inDesktop ? convertFileSrc(value) : ""
  const videoUrl = videoPath && inDesktop ? convertFileSrc(videoPath) : ""

  useEffect(() => { setPreviewError(false) }, [value])
  useEffect(() => { setVideoError(false) }, [videoPath])

  const accept = async (path: string) => {
    if (!IMAGE_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() || "")) {
      onError("请选择 JPG 或 PNG 封面图片")
      return
    }
    try {
      onChange(await prepareCoverPreview(path))
      onError("")
    } catch (error) {
      onError(`无法读取封面：${String(error)}`)
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
        if (payload.paths.length !== 1) onError("一次只能选择一张封面图片")
        else void accept(payload.paths[0])
      }
    }).then(stop => { if (active) unlisten = stop; else stop() })
      .catch(error => onError(`无法接收封面拖拽：${String(error)}`))
    return () => { active = false; void unlisten?.() }
  }, [onChange, onError])

  return <div className="min-w-0 shrink-0 space-y-1.5">
    <div ref={dropzone} role="button" tabIndex={0} aria-label={`设置${label}封面，或拖入封面图片`}
      onClick={onOpenPicker}
      onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onOpenPicker() } }}
      className={`relative flex h-40 cursor-pointer items-center justify-center overflow-hidden rounded-md border-2 transition-colors focus-visible:outline-2 focus-visible:outline-ring ${ratio === "3:4" ? "aspect-[3/4]" : "aspect-[4/3]"} ${dragging ? "border-primary" : "border-input hover:border-primary"}`}>
      {previewUrl && !previewError ? <img src={previewUrl} alt={`${label}封面`} onError={() => setPreviewError(true)} className="absolute inset-0 h-full w-full object-cover" />
        : <>
          {videoUrl && !videoError && <video key={videoUrl} src={videoUrl} muted playsInline preload="metadata"
            onLoadedMetadata={event => { const element = event.currentTarget; if (Number.isFinite(element.duration) && element.duration > 1) element.currentTime = Math.min(1, element.duration / 4) }}
            onError={() => setVideoError(true)} className="absolute inset-0 h-full w-full scale-110 object-cover blur-md" />}
          <div className="absolute inset-0 bg-[#2f3a40]/60" />
          <span className="relative flex flex-col items-center gap-2 text-center text-white"><ImagePlus className="size-5" /><span className="text-xs font-semibold">{previewError ? "封面无法预览" : "选择封面"}</span></span>
        </>}
      {value && <button type="button" title={`移除${label}封面`} aria-label={`移除${label}封面`} onClick={event => { event.stopPropagation(); onChange("") }}
        className="absolute right-2 top-2 grid size-7 place-items-center rounded-md bg-white/95 text-muted-foreground shadow-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" /></button>}
    </div>
    <p className="text-xs text-muted-foreground">{label}封面 {ratio}</p>
  </div>
}
