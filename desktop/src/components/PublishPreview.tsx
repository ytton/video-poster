import { useEffect, useMemo, useState } from "react"
import { convertFileSrc } from "@tauri-apps/api/core"
import { Heart, MessageCircle, Play, Share2 } from "lucide-react"
import { inDesktop } from "../cli"
import { platformLabel } from "../platforms"

const lightPlatforms = new Set(["bilibili", "xiaohongshu", "baijiahao", "dayu", "zhihu", "xueqiu", "hupu"])

export function PublishPreview({ platforms, file, title, description, tags, accountName }: {
  platforms: string[]
  file: string
  title: string
  description: string
  tags: string
  accountName: (platform: string) => string
}) {
  const [active, setActive] = useState(platforms[0] || "douyin")
  const [videoError, setVideoError] = useState(false)
  const [landscape, setLandscape] = useState(false)
  const platform = platforms.includes(active) ? active : platforms[0] || "douyin"
  const isLight = lightPlatforms.has(platform) || landscape && (platform === "youtube" || platform === "facebook" || platform === "facebook-page")
  const isImageFeed = platform === "xiaohongshu"
  const filename = file.split(/[\\/]/).pop() || "尚未选择视频"
  const caption = description.trim() || "视频简介将在这里显示"
  const topics = tags.split(",").map(tag => tag.trim().replace(/^#/, "")).filter(Boolean)
  const videoUrl = useMemo(() => file && inDesktop ? convertFileSrc(file) : "", [file])
  useEffect(() => { setVideoError(false); setLandscape(false) }, [file])

  const media = videoUrl && !videoError ?
    <video key={videoUrl} src={videoUrl} controls playsInline preload="metadata"
      onLoadedMetadata={event => setLandscape(event.currentTarget.videoWidth > event.currentTarget.videoHeight)}
      onError={() => setVideoError(true)} className="absolute inset-0 h-full w-full object-contain" />
    : <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-5 text-center text-white/70">
      <Play className="size-10" strokeWidth={1.5} />
      <span className="max-w-full break-all text-xs">{filename}</span>
    </div>

  return <aside className="flex min-h-0 flex-col border-l border-border bg-white">
    <div className="shrink-0 border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">发布预览</h2></div>
    <div className="tool-scroll flex shrink-0 gap-1 border-b border-border px-3 py-2" role="tablist" aria-label="平台预览">
      {platforms.map(item => <button key={item} type="button" role="tab" aria-selected={platform === item}
        onClick={() => setActive(item)} className={`shrink-0 rounded px-2.5 py-1.5 text-xs ${platform === item ? "bg-primary font-medium text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
        {platformLabel(item)}
      </button>)}
    </div>
    <div className="tool-scroll min-h-0 flex-1 px-3 py-4" tabIndex={0}>
      <div className="mx-auto w-full max-w-[278px] overflow-hidden rounded-[24px] border-[5px] border-[#283238] bg-white shadow-sm">
        <div className={`flex h-5 items-center justify-center ${isLight ? "bg-white" : "bg-[#111a1f]"}`}><span className={`h-1.5 w-14 rounded-full ${isLight ? "bg-[#283238]" : "bg-white/65"}`} /></div>
        <div className="relative aspect-[9/16] w-full overflow-hidden">
          {isLight ? <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-white">
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3 text-xs font-semibold"><span>{platformLabel(platform)}</span><span className="text-muted-foreground">视频</span></div>
            <div className={`relative w-full shrink-0 overflow-hidden bg-[#20292e] ${isImageFeed ? "aspect-[4/5]" : "aspect-video"}`}>{media}</div>
            <div className="tool-scroll min-h-0 flex-1 space-y-2 px-3 py-3">
              <p className="text-[11px] font-medium text-foreground">{accountName(platform) || "账号预览"}</p>
              <p className="break-words text-xs font-semibold text-foreground">{title.trim() || "视频标题"}</p>
              <p className="whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">{caption}</p>
              {topics.length > 0 && <p className="break-words text-[11px] text-primary">{topics.map(tag => `#${tag}`).join(" ")}</p>}
            </div>
            <div className="flex h-9 shrink-0 items-center justify-around border-t border-border text-muted-foreground"><Heart className="size-4" /><MessageCircle className="size-4" /><Share2 className="size-4" /></div>
          </div> : <div className="absolute inset-0 overflow-hidden bg-[#20292e] text-white">
            <div className="absolute inset-0">{media}</div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/80 to-transparent" />
            <div className="pointer-events-none absolute bottom-14 left-3 right-12 space-y-2">
              <p className="truncate text-xs font-semibold">@{accountName(platform) || "账号预览"}</p>
              <p className="line-clamp-2 text-xs font-medium">{title.trim() || "视频标题"}</p>
              <p className="line-clamp-2 whitespace-pre-wrap text-[11px] leading-4 text-white/85">{caption}</p>
              {topics.length > 0 && <p className="line-clamp-1 text-[11px]">{topics.map(tag => `#${tag}`).join(" ")}</p>}
            </div>
            <div className="pointer-events-none absolute bottom-24 right-2 flex flex-col gap-4 text-white/90"><Heart className="size-5" /><MessageCircle className="size-5" /><Share2 className="size-5" /></div>
          </div>}
        </div>
        <div className={`flex h-5 items-center justify-center ${isLight ? "bg-white" : "bg-[#20292e]"}`}><span className={`h-1 w-20 rounded-full ${isLight ? "bg-[#283238]" : "bg-white/70"}`} /></div>
      </div>
    </div>
  </aside>
}
