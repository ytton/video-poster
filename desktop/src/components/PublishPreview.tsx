import { useEffect, useMemo, useState, type ReactNode } from "react"
import { convertFileSrc } from "@tauri-apps/api/core"
import { Coins, Heart, MessageCircle, Play, Share2, Star, ThumbsUp } from "lucide-react"
import { inDesktop } from "../native"
import { platformLabel } from "../platforms"
import { CoverFeedPreview } from "./CoverFeedPreview"

const lightPlatforms = new Set(["bilibili", "xiaohongshu", "baijiahao", "dayu", "zhihu", "xueqiu", "hupu"])
const portraitCoverPlatforms = new Set(["douyin", "kuaishou", "xiaohongshu", "tencent", "instagram"])

function BilibiliVideoDetail({ media, title, account, description, topics }: {
  media: ReactNode
  title: string
  account: string
  description: string
  topics: string[]
}) {
  return <div className="absolute inset-0 flex flex-col overflow-hidden bg-white text-[#24252a]">
    <div className="relative aspect-video shrink-0 overflow-hidden bg-black">{media}</div>
    <div className="tool-scroll min-h-0 flex-1">
      <div className="border-b border-[#f0f0f2] px-3 pb-2 pt-3">
        <p className="line-clamp-3 break-words text-[12px] font-semibold leading-[18px]">{title || "视频标题"}</p>
        <div className="mt-2 flex items-center gap-2 text-[9px] text-[#a1a3aa]"><span>播放</span><span className="h-1.5 w-7 rounded bg-[#e8e9ec]" /><span>弹幕</span><span className="h-1.5 w-5 rounded bg-[#e8e9ec]" /></div>
      </div>
      <div className="flex h-12 items-center gap-2 border-b border-[#f0f0f2] px-3">
        <div className="grid size-7 shrink-0 place-items-center rounded-full bg-[#fce4ee] text-[10px] font-bold text-[#ec689b]">UP</div>
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium">{account || "账号预览"}</span>
        <span className="rounded-full bg-[#fb7299] px-2 py-1 text-[9px] font-medium text-white">+ 关注</span>
      </div>
      <div className="flex h-12 items-center justify-around border-b border-[#f0f0f2] text-[#888b94]">
        {([ [ThumbsUp, "点赞"], [Coins, "投币"], [Star, "收藏"], [Share2, "分享"] ] as const).map(([Icon, label]) =>
          <span key={label} className="flex flex-col items-center gap-0.5"><Icon className="size-4" /><span className="text-[9px]">{label}</span></span>)}
      </div>
      <div className="flex h-9 items-center gap-5 border-b border-[#f0f0f2] px-3 text-[10px]"><span className="font-semibold text-[#fb7299]">简介</span><span className="text-[#888b94]">评论</span></div>
      <div className="space-y-2 px-3 py-3">
        <p className="whitespace-pre-wrap break-words text-[10px] leading-4 text-[#60636b]">{description || "视频简介"}</p>
        {topics.length > 0 && <p className="break-words text-[10px] text-[#fb7299]">{topics.map(tag => `#${tag}`).join(" ")}</p>}
      </div>
      <div className="border-t border-[#f0f0f2] px-3 py-3"><div className="h-2 w-20 rounded bg-[#e9eaed]" /><div className="mt-3 aspect-video rounded-[4px] bg-[#eceef0]" /><div className="mt-2 h-1.5 w-4/5 rounded bg-[#eceef0]" /></div>
    </div>
    <div className="flex h-9 shrink-0 items-center gap-2 border-t border-[#f0f0f2] px-3 text-[9px] text-[#989aa3]"><MessageCircle className="size-4" /><span className="min-w-0 flex-1 rounded-full bg-[#f4f5f6] px-2 py-1">说点什么...</span><Star className="size-4" /><Share2 className="size-4" /></div>
  </div>
}

export function PublishPreview({ platforms, file, title, description, tags, coverForPlatform, onVideoOrientationChange, accountName }: {
  platforms: string[]
  file: string
  title: string
  description: string
  tags: string
  coverForPlatform: (platform: string, orientation: "landscape" | "portrait") => string | null
  onVideoOrientationChange: (landscape: boolean) => void
  accountName: (platform: string) => string
}) {
  const [active, setActive] = useState(platforms[0] || "douyin")
  const [mode, setMode] = useState<"video" | "cover">("video")
  const [coverOrientation, setCoverOrientation] = useState<"landscape" | "portrait">("portrait")
  const [videoError, setVideoError] = useState(false)
  const [landscape, setLandscape] = useState(false)
  const platform = platforms.includes(active) ? active : platforms[0] || "douyin"
  const isLight = lightPlatforms.has(platform) || landscape && (platform === "youtube" || platform === "facebook" || platform === "facebook-page")
  const phoneLight = mode === "cover" ? platform !== "douyin" && platform !== "kuaishou" : isLight
  const isImageFeed = platform === "xiaohongshu"
  const filename = file.split(/[\\/]/).pop() || "尚未选择视频"
  const caption = description.trim() || "视频简介将在这里显示"
  const topics = tags.split(/[,，]/).map(tag => tag.trim().replace(/^#/, "")).filter(Boolean)
  const videoUrl = useMemo(() => file && inDesktop ? convertFileSrc(file) : "", [file])
  const coverPath = coverForPlatform(platform, coverOrientation)
  const coverUrl = coverPath && inDesktop ? convertFileSrc(coverPath) : ""
  useEffect(() => { setVideoError(false); setLandscape(false); onVideoOrientationChange(false) }, [file, onVideoOrientationChange])
  const media = <>
    {videoUrl && !videoError && <video key={videoUrl} src={videoUrl} controls playsInline preload="metadata"
      onLoadedMetadata={event => { const isLandscape = event.currentTarget.videoWidth > event.currentTarget.videoHeight; setLandscape(isLandscape); onVideoOrientationChange(isLandscape) }}
      onError={() => setVideoError(true)} className="absolute inset-0 h-full w-full object-contain" />}
    {mode === "video" && (!videoUrl || videoError) && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-5 text-center text-white/70">
          <Play className="size-10" strokeWidth={1.5} /><span className="max-w-full break-all text-xs">{filename}</span>
        </div>}
  </>

  return <aside className="flex min-h-0 flex-col border-l border-border bg-white">
    {videoUrl && <video key={`metadata-${videoUrl}`} src={videoUrl} preload="metadata" aria-hidden="true" className="sr-only pointer-events-none"
      onLoadedMetadata={event => { const isLandscape = event.currentTarget.videoWidth > event.currentTarget.videoHeight; setLandscape(isLandscape); onVideoOrientationChange(isLandscape) }} />}
    <div className="shrink-0 border-b border-border px-3 py-2.5" role="tablist" aria-label="预览类型">
      <div className="grid grid-cols-2 rounded-md bg-muted p-0.5">
        {(["video", "cover"] as const).map(item => <button key={item} type="button" role="tab" aria-selected={mode === item}
          onClick={() => { setMode(item); if (item === "cover") setCoverOrientation(portraitCoverPlatforms.has(platform) ? "portrait" : "landscape") }}
          className={`h-8 rounded-[4px] text-xs font-medium transition-colors ${mode === item ? "bg-white text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
          {item === "video" ? "视频预览" : "封面预览"}
        </button>)}
      </div>
    </div>
    <div className="tool-scroll flex shrink-0 gap-1 border-b border-border px-3 py-2" role="tablist" aria-label="平台预览">
      {platforms.map(item => <button key={item} type="button" role="tab" aria-selected={platform === item}
        onClick={() => { setActive(item); setCoverOrientation(portraitCoverPlatforms.has(item) ? "portrait" : "landscape") }} className={`shrink-0 rounded px-2.5 py-1.5 text-xs ${platform === item ? "bg-primary font-medium text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
        {platformLabel(item)}
      </button>)}
    </div>
    <div className="tool-scroll min-h-0 flex-1 px-3 py-4" tabIndex={0}>
      <div className="mx-auto w-full max-w-[278px] overflow-hidden rounded-[24px] border-[5px] border-[#283238] bg-white shadow-sm">
        <div className={`flex h-5 items-center justify-center ${phoneLight ? "bg-white" : "bg-[#111a1f]"}`}><span className={`h-1.5 w-14 rounded-full ${phoneLight ? "bg-[#283238]" : "bg-white/65"}`} /></div>
        <div className="relative aspect-[9/16] w-full overflow-hidden">
          {mode === "cover" ? <CoverFeedPreview platform={platform} imageSrc={coverUrl} imageMissing={coverPath === null ? "平台自动生成封面" : undefined}
            title={title} account={accountName(platform)} orientation={coverOrientation} onOrientationChange={platform === "bilibili" ? undefined : setCoverOrientation} />
          : platform === "bilibili" ? <BilibiliVideoDetail media={media} title={title.trim()} account={accountName(platform)} description={description.trim()} topics={topics} />
          : isLight ? <div className="absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-white">
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
        <div className={`flex h-5 items-center justify-center ${phoneLight ? "bg-white" : "bg-[#20292e]"}`}><span className={`h-1 w-20 rounded-full ${phoneLight ? "bg-[#283238]" : "bg-white/70"}`} /></div>
      </div>
    </div>
  </aside>
}
