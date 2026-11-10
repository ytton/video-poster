import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import { convertFileSrc } from "@tauri-apps/api/core"
import { open as chooseFile } from "@tauri-apps/plugin-dialog"
import { ArrowLeftRight, ImagePlus, ZoomIn, ZoomOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { inDesktop, prepareCoverPreview, saveCoverFrame } from "../native"
import { CoverFeedPreview } from "./CoverFeedPreview"

type Orientation = "landscape" | "portrait"
type Size = { width: number; height: number }
type Crop = { x: number; y: number; zoom: number }
type Frame = { time: number; image: string; width: number; height: number }

const initialCrop: Crop = { x: 0.5, y: 0.5, zoom: 1 }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`

function cropRect(size: Size, orientation: Orientation, crop: Crop) {
  const ratio = orientation === "landscape" ? 4 / 3 : 3 / 4
  const width = Math.min(size.width, size.height * ratio) / crop.zoom
  const height = width / ratio
  return {
    x: clamp(crop.x * size.width - width / 2, 0, size.width - width),
    y: clamp(crop.y * size.height - height / 2, 0, size.height - height),
    width, height,
  }
}

function cropCenterLimits(size: Size, orientation: Orientation, zoom: number, stageSize: Size, scale: number, viewCenter: { x: number; y: number }) {
  const rect = cropRect(size, orientation, { x: 0.5, y: 0.5, zoom })
  const frameWidth = rect.width * scale * zoom
  const frameHeight = rect.height * scale * zoom
  const travelX = Math.max(0, (stageSize.width - frameWidth) / (2 * size.width * scale * zoom))
  const travelY = Math.max(0, (stageSize.height - frameHeight) / (2 * size.height * scale * zoom))
  const halfWidth = rect.width / (2 * size.width)
  const halfHeight = rect.height / (2 * size.height)
  return {
    minX: Math.max(halfWidth, viewCenter.x - travelX),
    maxX: Math.min(1 - halfWidth, viewCenter.x + travelX),
    minY: Math.max(halfHeight, viewCenter.y - travelY),
    maxY: Math.min(1 - halfHeight, viewCenter.y + travelY),
    travelX, travelY, halfWidth, halfHeight,
  }
}

function drawCrop(canvas: HTMLCanvasElement, source: CanvasImageSource, size: Size, orientation: Orientation, crop: Crop, full: boolean) {
  canvas.width = full ? orientation === "landscape" ? 1200 : 900 : orientation === "landscape" ? 360 : 270
  canvas.height = full ? orientation === "landscape" ? 900 : 1200 : orientation === "landscape" ? 270 : 360
  const context = canvas.getContext("2d")
  if (!context) throw new Error("无法创建封面画布")
  const rect = cropRect(size, orientation, crop)
  context.imageSmoothingQuality = "high"
  context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height)
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("无法导出封面图片")), "image/jpeg", 0.88))
}

function waitFor(video: HTMLVideoElement, eventName: "loadedmetadata" | "loadeddata" | "seeked") {
  return new Promise<void>((resolve, reject) => {
    const finish = (problem?: Error) => {
      window.clearTimeout(timer)
      video.removeEventListener(eventName, onReady)
      video.removeEventListener("error", onError)
      if (problem) reject(problem)
      else resolve()
    }
    const onReady = () => finish()
    const onError = () => finish(new Error("无法读取视频帧"))
    const timer = window.setTimeout(() => finish(new Error("读取视频帧超时")), 8000)
    video.addEventListener(eventName, onReady)
    video.addEventListener("error", onError)
  })
}

export function VideoFramePicker({ open, onOpenChange, initialOrientation, file, title, account, onCaptured, onError }: {
  open: boolean
  onOpenChange: (value: boolean) => void
  initialOrientation: Orientation
  file: string
  title: string
  account: string
  onCaptured: (covers: Record<Orientation, string>) => void
  onError: (message: string) => void
}) {
  const [stageNode, setStageNode] = useState<HTMLDivElement | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const frameStrip = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; crop: Crop } | null>(null)
  const frameDrag = useRef<{ x: number; currentX: number; index: number } | null>(null)
  const frameDragMoved = useRef(false)
  const frameScrollTimer = useRef<number | null>(null)
  const [orientation, setOrientation] = useState<Orientation>("portrait")
  const [portraitCrop, setPortraitCrop] = useState<Crop>(initialCrop)
  const [landscapeCrop, setLandscapeCrop] = useState<Crop>(initialCrop)
  const [portraitViewCenter, setPortraitViewCenter] = useState({ x: 0.5, y: 0.5 })
  const [landscapeViewCenter, setLandscapeViewCenter] = useState({ x: 0.5, y: 0.5 })
  const [times, setTimes] = useState<Record<Orientation, number>>({ portrait: 0, landscape: 0 })
  const [imagePaths, setImagePaths] = useState<Record<Orientation, string>>({ portrait: "", landscape: "" })
  const lastOpenedFile = useRef<string | null>(null)
  const crop = orientation === "portrait" ? portraitCrop : landscapeCrop
  const setCrop = orientation === "portrait" ? setPortraitCrop : setLandscapeCrop
  const viewCenter = orientation === "portrait" ? portraitViewCenter : landscapeViewCenter
  const setViewCenter = orientation === "portrait" ? setPortraitViewCenter : setLandscapeViewCenter
  const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 })
  const [videoSize, setVideoSize] = useState<Size>({ width: 0, height: 0 })
  const [imageSize, setImageSize] = useState<Size>({ width: 0, height: 0 })
  const [videoReady, setVideoReady] = useState(false)
  const [loadedImagePath, setLoadedImagePath] = useState("")
  const [duration, setDuration] = useState(0)
  const [seeking, setSeeking] = useState(false)
  const [frameTick, setFrameTick] = useState(0)
  const [frames, setFrames] = useState<Frame[]>([])
  const [preview, setPreview] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const time = times[orientation]
  const imagePath = imagePaths[orientation]
  const setTime = (next: number) => setTimes(previous => ({ ...previous, [orientation]: next }))
  const videoUrl = useMemo(() => file && inDesktop ? convertFileSrc(file) : "", [file])
  const imageUrl = imagePath && inDesktop ? convertFileSrc(imagePath) : ""
  const size = imagePath ? imageSize : videoSize
  const ready = imagePath ? loadedImagePath === imagePath : videoReady && !seeking && (!video.current || Math.abs(video.current.currentTime - time) < 0.05)
  const source = imagePath ? image.current : video.current

  useEffect(() => {
    if (!open) return
    setOrientation(initialOrientation)
    setLoadedImagePath("")
    if (lastOpenedFile.current === file) return
    lastOpenedFile.current = file
    setPortraitCrop(initialCrop)
    setLandscapeCrop(initialCrop)
    setPortraitViewCenter({ x: 0.5, y: 0.5 })
    setLandscapeViewCenter({ x: 0.5, y: 0.5 })
    setImagePaths({ portrait: "", landscape: "" })
    setLoadedImagePath("")
    setVideoReady(false)
    setDuration(0)
    setTimes({ portrait: 0, landscape: 0 })
    setFrames([])
    setPreview("")
    setError("")
  }, [open, file, initialOrientation])

  useEffect(() => {
    if (!open || imagePath || !videoReady || !video.current) return
    if (Math.abs(video.current.currentTime - time) >= 0.05) video.current.currentTime = time
  }, [open, orientation, imagePath, videoReady, time])

  useEffect(() => {
    if (open) return
    if (frameScrollTimer.current !== null) window.clearTimeout(frameScrollTimer.current)
    frameScrollTimer.current = null
    frameDrag.current = null
  }, [open])

  useEffect(() => {
    if (!open || !stageNode) return
    const measure = () => {
      const rect = stageNode.getBoundingClientRect()
      setStageSize({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect) setStageSize({ width: rect.width, height: rect.height })
    })
    observer.observe(stageNode)
    return () => observer.disconnect()
  }, [open, stageNode])

  useEffect(() => {
    if (!open || !videoUrl) return
    let active = true
    const probe = document.createElement("video")
    probe.crossOrigin = "anonymous"
    probe.preload = "auto"
    probe.muted = true
    probe.src = videoUrl
    void (async () => {
      try {
        if (probe.readyState < HTMLMediaElement.HAVE_METADATA) await waitFor(probe, "loadedmetadata")
        if (probe.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitFor(probe, "loadeddata")
        const length = Number.isFinite(probe.duration) ? probe.duration : 0
        const frameCount = probe.videoWidth < probe.videoHeight ? 24 : 12
        const thumbnailScale = Math.min(96 / probe.videoWidth, 72 / probe.videoHeight)
        const thumbnailWidth = Math.max(1, Math.round(probe.videoWidth * thumbnailScale))
        const thumbnailHeight = Math.max(1, Math.round(probe.videoHeight * thumbnailScale))
        for (let index = 0; index < frameCount && active; index++) {
          const next = length > 0 ? clamp(length * (index + 0.3) / frameCount, 0, Math.max(0, length - 0.05)) : 0
          if (Math.abs(probe.currentTime - next) > 0.05) {
            const seekingDone = waitFor(probe, "seeked")
            probe.currentTime = next
            await seekingDone
          }
          if (!active) break
          const canvas = document.createElement("canvas")
          canvas.width = thumbnailWidth
          canvas.height = thumbnailHeight
          canvas.getContext("2d")?.drawImage(probe, 0, 0, thumbnailWidth, thumbnailHeight)
          setFrames(previous => [...previous, { time: next, image: canvas.toDataURL("image/jpeg", 0.7), width: thumbnailWidth, height: thumbnailHeight }])
        }
      } catch {
        if (active) setFrames([])
      } finally {
        probe.removeAttribute("src")
        probe.load()
      }
    })()
    return () => { active = false; probe.removeAttribute("src"); probe.load() }
  }, [open, videoUrl])

  useEffect(() => {
    if (!open || !ready || !source || !size.width || !size.height) {
      setPreview("")
      return
    }
    try {
      const canvas = document.createElement("canvas")
      drawCrop(canvas, source, size, orientation, crop, false)
      setPreview(canvas.toDataURL("image/jpeg", 0.78))
    } catch {
      setPreview("")
    }
  }, [open, ready, source, size.width, size.height, orientation, crop, frameTick])

  const scale = size.width && size.height && stageSize.width && stageSize.height
    ? Math.min(stageSize.width / size.width, stageSize.height / size.height) : 0
  const displayWidth = size.width * scale
  const displayHeight = size.height * scale
  const rect = scale ? cropRect(size, orientation, crop) : null
  const frameWidth = rect ? rect.width * scale * crop.zoom : 0
  const frameHeight = rect ? rect.height * scale * crop.zoom : 0
  const sourceLeft = stageSize.width / 2 - viewCenter.x * displayWidth * crop.zoom
  const sourceTop = stageSize.height / 2 - viewCenter.y * displayHeight * crop.zoom
  const cropStyle = rect ? {
    left: sourceLeft + rect.x * scale * crop.zoom,
    top: sourceTop + rect.y * scale * crop.zoom,
    width: frameWidth,
    height: frameHeight,
  } : undefined
  const sourceStyle = rect ? {
    left: sourceLeft,
    top: sourceTop,
    width: displayWidth * crop.zoom,
    height: displayHeight * crop.zoom,
  } : undefined
  const selectedFrameIndex = imagePath ? -1 : frames.reduce((nearest, frame, index) =>
    nearest < 0 || Math.abs(frame.time - time) < Math.abs(frames[nearest].time - time) ? index : nearest, -1)

  useEffect(() => {
    const strip = frameStrip.current
    const selected = strip?.querySelector(`[data-frame-index="${selectedFrameIndex}"]`)
    if (!strip || !selected) return
    if (frameDrag.current) return
    const stripBounds = strip.getBoundingClientRect()
    const selectedBounds = selected.getBoundingClientRect()
    if (selectedBounds.left < stripBounds.left + 12 || selectedBounds.right > stripBounds.right - 12) {
      strip.scrollLeft += (selectedBounds.left + selectedBounds.right - stripBounds.left - stripBounds.right) / 2
    }
  }, [selectedFrameIndex])

  useEffect(() => {
    if (!scale) return
    const limits = cropCenterLimits(size, orientation, crop.zoom, stageSize, scale, viewCenter)
    const x = clamp(crop.x, limits.halfWidth, 1 - limits.halfWidth)
    const y = clamp(crop.y, limits.halfHeight, 1 - limits.halfHeight)
    if (x !== crop.x || y !== crop.y) {
      setCrop({ ...crop, x, y })
    }
    const viewX = clamp(viewCenter.x, x - limits.travelX, x + limits.travelX)
    const viewY = clamp(viewCenter.y, y - limits.travelY, y + limits.travelY)
    if (viewX !== viewCenter.x || viewY !== viewCenter.y) setViewCenter({ x: viewX, y: viewY })
  }, [crop, viewCenter, size.width, size.height, orientation, stageSize.width, stageSize.height, scale])

  const handleDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current
    if (!start || !displayWidth || !displayHeight) return
    const limits = cropCenterLimits(size, orientation, start.crop.zoom, stageSize, scale, viewCenter)
    setCrop({ ...start.crop,
      x: clamp(start.crop.x + (event.clientX - start.x) / (displayWidth * start.crop.zoom), limits.minX, limits.maxX),
      y: clamp(start.crop.y + (event.clientY - start.y) / (displayHeight * start.crop.zoom), limits.minY, limits.maxY),
    })
  }

  const stopFrameScroll = () => {
    if (frameScrollTimer.current !== null) window.clearTimeout(frameScrollTimer.current)
    frameScrollTimer.current = null
  }

  const selectFrameAt = (strip: HTMLDivElement, pointerX: number) => {
    const dragging = frameDrag.current
    if (!dragging) return
    let nearest = dragging.index
    let distance = Number.POSITIVE_INFINITY
    for (const button of strip.querySelectorAll<HTMLButtonElement>("[data-frame-index]")) {
      const frameBounds = button.getBoundingClientRect()
      const nextDistance = Math.abs((frameBounds.left + frameBounds.right) / 2 - pointerX)
      if (nextDistance < distance) {
        distance = nextDistance
        nearest = Number(button.dataset.frameIndex)
      }
    }
    if (nearest !== dragging.index && frames[nearest]) {
      dragging.index = nearest
      seek(frames[nearest].time)
    }
  }

  const autoScrollFrames = () => {
    const dragging = frameDrag.current
    const strip = frameStrip.current
    if (!dragging || !strip || !frameDragMoved.current) { stopFrameScroll(); return }
    const bounds = strip.getBoundingClientRect()
    const direction = dragging.currentX < bounds.left + 24 ? -1 : dragging.currentX > bounds.right - 24 ? 1 : 0
    if (!direction) { stopFrameScroll(); return }
    const before = strip.scrollLeft
    strip.scrollLeft += direction * 12
    if (strip.scrollLeft === before) { stopFrameScroll(); return }
    selectFrameAt(strip, dragging.currentX)
    frameScrollTimer.current = window.setTimeout(autoScrollFrames, 30)
  }

  const handleFrameDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const dragging = frameDrag.current
    const strip = frameStrip.current
    if (!dragging || !strip) return
    dragging.currentX = event.clientX
    if (Math.abs(event.clientX - dragging.x) < 4 && !frameDragMoved.current) return
    frameDragMoved.current = true
    event.preventDefault()
    selectFrameAt(strip, event.clientX)
    const bounds = strip.getBoundingClientRect()
    if (event.clientX < bounds.left + 24 || event.clientX > bounds.right - 24) {
      if (frameScrollTimer.current === null) autoScrollFrames()
    } else stopFrameScroll()
  }

  const seek = (next: number) => {
    if (imagePath) {
      setImagePaths(previous => ({ ...previous, [orientation]: "" }))
      setCrop(initialCrop)
      setViewCenter({ x: 0.5, y: 0.5 })
    }
    setTime(next)
    if (video.current) video.current.currentTime = next
  }

  const uploadImage = async () => {
    try {
      const path = await chooseFile({ multiple: false, filters: [{ name: "封面图片", extensions: ["jpg", "jpeg", "png"] }] })
      if (typeof path !== "string") return
      const prepared = await prepareCoverPreview(path)
      setImagePaths(previous => ({ ...previous, [orientation]: prepared }))
      setLoadedImagePath("")
      setCrop(initialCrop)
      setViewCenter({ x: 0.5, y: 0.5 })
      setError("")
    } catch (problem) {
      setError(`读取封面失败：${String(problem)}`)
    }
  }

  const save = async () => {
    if (!ready || !source || !size.width) return
    setSaving(true)
    let frameVideo: HTMLVideoElement | null = null
    try {
      const covers = {} as Record<Orientation, string>
      if (!imagePaths.portrait || !imagePaths.landscape) {
        frameVideo = document.createElement("video")
        frameVideo.crossOrigin = "anonymous"
        frameVideo.preload = "auto"
        frameVideo.muted = true
        frameVideo.src = videoUrl
        if (frameVideo.readyState < HTMLMediaElement.HAVE_METADATA) await waitFor(frameVideo, "loadedmetadata")
        if (frameVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitFor(frameVideo, "loadeddata")
      }
      for (const direction of ["portrait", "landscape"] as const) {
        let frameSource: CanvasImageSource
        let frameSize: Size
        if (imagePaths[direction]) {
          const coverImage = new Image()
          coverImage.crossOrigin = "anonymous"
          coverImage.src = convertFileSrc(imagePaths[direction])
          await coverImage.decode()
          frameSource = coverImage
          frameSize = { width: coverImage.naturalWidth, height: coverImage.naturalHeight }
        } else {
          if (!frameVideo) throw new Error("无法读取视频帧")
          const next = times[direction]
          if (Math.abs(frameVideo.currentTime - next) > 0.05) {
            const seeked = waitFor(frameVideo, "seeked")
            frameVideo.currentTime = next
            await seeked
          }
          frameSource = frameVideo
          frameSize = { width: frameVideo.videoWidth, height: frameVideo.videoHeight }
        }
        const canvas = document.createElement("canvas")
        drawCrop(canvas, frameSource, frameSize, direction, direction === "portrait" ? portraitCrop : landscapeCrop, true)
        covers[direction] = await saveCoverFrame(direction, await canvasBlob(canvas))
      }
      onCaptured(covers)
      setError("")
      onError("")
      onOpenChange(false)
    } catch (problem) {
      const message = `保存封面失败：${String(problem)}`
      setError(message)
      onError(message)
    } finally {
      if (frameVideo) { frameVideo.removeAttribute("src"); frameVideo.load() }
      setSaving(false)
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="grid h-[calc(100%-3.5rem)] w-[calc(100%-2rem)] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-none">
    <DialogTitle className="sr-only">设置视频封面</DialogTitle><DialogDescription className="sr-only">选择视频帧或图片，调整竖版和横版裁切范围并应用封面。</DialogDescription>
    <div className="flex h-14 items-center justify-center border-b border-border px-5">
      <div className="grid w-64 grid-cols-2 rounded-md bg-muted p-0.5" role="tablist" aria-label="封面方向">
        {(["portrait", "landscape"] as const).map(item => <button key={item} type="button" role="tab" aria-selected={orientation === item}
          onClick={() => { setLoadedImagePath(""); setOrientation(item) }} disabled={saving} className={`h-9 rounded-[4px] text-sm font-medium ${orientation === item ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          {item === "portrait" ? "设置竖封面" : "设置横封面"}
        </button>)}
      </div>
    </div>
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_minmax(230px,28%)]">
      <div className="flex min-h-0 min-w-0 flex-col bg-[#f3f5f6]">
        <div ref={setStageNode} className="relative min-h-0 flex-1 overflow-hidden bg-[#5d6265]">
          {videoUrl && <video ref={video} src={videoUrl} crossOrigin="anonymous" muted playsInline preload="auto"
            onLoadedMetadata={event => { setVideoSize({ width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight }); setDuration(event.currentTarget.duration) }}
            onLoadedData={() => { setVideoReady(true); setFrameTick(value => value + 1) }}
            onSeeking={() => setSeeking(true)} onSeeked={() => { setSeeking(false); setFrameTick(value => value + 1) }}
            onError={() => { setVideoReady(false); setError("当前视频格式无法截帧，请上传封面图片") }}
            style={sourceStyle} className={`pointer-events-none absolute ${imagePath ? "invisible" : ""}`} />}
          {imageUrl && <img ref={image} src={imageUrl} alt="待裁切封面" crossOrigin="anonymous"
            onLoad={event => { setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setLoadedImagePath(imagePath) }}
            onError={() => { setLoadedImagePath(""); setError("无法读取这张封面图片") }} style={sourceStyle} className="pointer-events-none absolute" />}
          {ready && cropStyle && <div style={cropStyle} onPointerDown={event => { const bounds = cropRect(size, orientation, crop); drag.current = { x: event.clientX, y: event.clientY, crop: { ...crop, x: (bounds.x + bounds.width / 2) / size.width, y: (bounds.y + bounds.height / 2) / size.height } }; event.currentTarget.setPointerCapture(event.pointerId) }}
            onPointerMove={handleDrag} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}
            className="absolute touch-none cursor-move border-2 border-cyan-400 shadow-[0_0_0_2000px_rgba(0,0,0,0.48)]" aria-label="拖动调整封面裁切区域" title="拖动选择封面画面">
            <span className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-50">{Array.from({ length: 9 }, (_, index) => <span key={index} className="border border-white/25" />)}</span>
          </div>}
          {!ready && <div className="absolute inset-0 grid place-items-center px-5 text-center text-xs text-white/80">{imagePath ? "正在读取图片" : videoUrl ? "正在读取视频" : "上传封面图片以开始设置"}</div>}
        </div>
        <div className="flex h-11 shrink-0 items-center gap-2 border-t border-border px-4">
          <ZoomOut className="size-4 shrink-0 text-muted-foreground" /><input type="range" min="1" max="3" step="0.05" value={crop.zoom} aria-label="封面缩放" disabled={!ready}
            onChange={event => {
              const zoom = Number(event.target.value)
              if (scale) {
                const limits = cropCenterLimits(size, orientation, zoom, stageSize, scale, viewCenter)
                const x = clamp(crop.x, limits.halfWidth, 1 - limits.halfWidth)
                const y = clamp(crop.y, limits.halfHeight, 1 - limits.halfHeight)
                setViewCenter({
                  x: clamp(x - (crop.x - viewCenter.x) * crop.zoom / zoom, x - limits.travelX, x + limits.travelX),
                  y: clamp(y - (crop.y - viewCenter.y) * crop.zoom / zoom, y - limits.travelY, y + limits.travelY),
                })
              }
              setCrop(previous => ({ ...previous, zoom }))
            }} className="w-24 shrink-0 accent-primary" /><ZoomIn className="size-4 shrink-0 text-muted-foreground" />
          <span className="mx-1 h-5 w-px shrink-0 bg-border" /><input type="range" min="0" max={Number.isFinite(duration) ? duration : 0} step="0.04" value={time}
            disabled={!videoReady || !!imagePath} onChange={event => seek(Number(event.target.value))} aria-label="选择视频帧时间" className="min-w-0 flex-1 accent-primary" />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatTime(time)} / {Number.isFinite(duration) ? formatTime(duration) : "00:00"}</span>
        </div>
        <div className="flex h-24 shrink-0 items-center gap-2 border-t border-border px-3">
          <div ref={frameStrip} tabIndex={0} aria-label="视频参考帧" className="frame-strip-scroll flex h-24 min-w-0 flex-1 items-center gap-0 pl-3 pr-3">
            {frames.length ? frames.map((frame, index) => <button key={index} type="button" onClick={() => {
                if (frameDragMoved.current) { frameDragMoved.current = false; return }
                seek(frame.time)
              }} onPointerDown={event => {
                frameDragMoved.current = false
                if (selectedFrameIndex !== index) return
                frameDrag.current = { x: event.clientX, currentX: event.clientX, index }
                event.currentTarget.setPointerCapture(event.pointerId)
              }} onPointerMove={handleFrameDrag} onPointerUp={() => {
                frameDrag.current = null
                stopFrameScroll()
                window.setTimeout(() => { frameDragMoved.current = false }, 0)
              }} onPointerCancel={() => { frameDrag.current = null; frameDragMoved.current = false; stopFrameScroll() }}
              title={formatTime(frame.time)} data-frame-index={index} aria-pressed={selectedFrameIndex === index}
              style={{ width: 56 * frame.width / frame.height }}
              className={`relative h-14 shrink-0 p-0 ${selectedFrameIndex === index ? "z-10 -translate-y-1 scale-125 touch-none cursor-ew-resize rounded-[3px] border-[3px] border-white bg-white shadow-[0_4px_14px_rgba(0,0,0,0.4)]" : "hover:z-10 hover:scale-105"}`}>
              <img src={frame.image} alt={`${formatTime(frame.time)} 的视频帧`} draggable={false} className="block h-full w-full object-cover" />
              {selectedFrameIndex === index && <span className="absolute -bottom-3 inset-x-0 grid h-3 place-items-center rounded-b-[3px] bg-white text-[#4d5960] shadow-sm"><ArrowLeftRight className="size-2.5" /></span>}
            </button>) : <span className="px-2 text-xs text-muted-foreground">{videoReady ? "正在提取视频帧" : "等待视频帧"}</span>}
          </div>
          <button type="button" onClick={() => void uploadImage()} className="flex h-14 w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-[4px] bg-[#20292e] text-[11px] font-medium text-white hover:bg-[#33414a]">
            <ImagePlus className="size-4" />上传封面
          </button>
        </div>
      </div>
      <aside className="flex min-h-0 flex-col items-center justify-center gap-3 border-l border-border bg-white px-3 py-4">
        <div className="w-[min(280px,30vh)] overflow-hidden rounded-md border border-border bg-white shadow-sm">
          <div className="relative aspect-[9/16]"><CoverFeedPreview platform="douyin" imageSrc={preview} title={title} account={account} orientation={orientation} showStatusBar /></div>
        </div>
        <p className="text-xs text-muted-foreground">{orientation === "portrait" ? "竖封面预览（3:4）" : "横封面预览（4:3）"}</p>
      </aside>
    </div>
    <div className="flex min-h-16 items-center gap-3 border-t border-border bg-white px-5">
      {error && <p className="min-w-0 flex-1 truncate text-xs text-destructive" title={error}>{error}</p>}
      {!error && <span className="flex-1" />}
      <Button onClick={() => void save()} disabled={!ready || saving}>{saving ? "应用中" : "应用"}</Button>
    </div>
  </DialogContent></Dialog>
}
