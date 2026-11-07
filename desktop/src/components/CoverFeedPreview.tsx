import { useEffect, useState, type ReactNode } from "react"
import { BatteryFull, Heart, Home, ImageIcon, Mail, Menu, MessageCircle, MoreVertical, Plus, PlusSquare, Search, ShoppingBag, Signal, ThumbsUp, Tv, UserRound, Wifi } from "lucide-react"
import { platformLabel } from "../platforms"

type Orientation = "landscape" | "portrait"

const darkPlatforms = new Set(["douyin", "kuaishou"])
const portraitFeeds = new Set(["douyin", "kuaishou", "xiaohongshu", "tencent", "instagram"])
const sections: Record<string, string> = {
  douyin: "精选　关注　推荐", kuaishou: "发现　关注　同城", xiaohongshu: "发现",
  tencent: "视频号", instagram: "Reels", bilibili: "推荐", zhihu: "视频",
  youtube: "首页", weibo: "视频", facebook: "首页", "facebook-page": "视频",
}
const navigation: Record<string, string[]> = {
  douyin: ["首页", "朋友", "发布", "消息", "我"],
  kuaishou: ["首页", "精选", "发布", "消息", "我"],
  xiaohongshu: ["首页", "市集", "发布", "消息", "我"],
  tencent: ["微信", "通讯录", "发现", "视频号", "我"],
  instagram: ["首页", "搜索", "发布", "Reels", "主页"],
  bilibili: ["首页", "动态", "发布", "会员购", "我的"],
  zhihu: ["首页", "想法", "发布", "消息", "我的"],
  youtube: ["首页", "Shorts", "发布", "订阅", "我的"],
  weibo: ["首页", "视频", "发布", "消息", "我"],
}
const navIcons = [Home, Search, PlusSquare, MessageCircle, UserRound]

function BilibiliFeedPreview({ artwork, headline, author, showStatusBar }: {
  artwork: ReactNode
  headline: string
  author: string
  showStatusBar: boolean
}) {
  return <div className="absolute inset-0 overflow-hidden bg-[#f5f5f7] text-[#24242a]">
    {showStatusBar && <div className="flex h-5 items-center justify-between bg-white px-3 text-[9px] font-semibold"><span>9:41</span><span className="flex items-center gap-0.5"><Signal className="size-2.5" /><Wifi className="size-2.5" /><BatteryFull className="size-3" /></span></div>}
    <div className="flex h-11 items-center gap-2 bg-white px-2">
      <div className="grid size-7 shrink-0 place-items-center rounded-full bg-[#f5dce9] text-[9px] font-bold text-[#ec5d9d]">哔</div>
      <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full border border-[#b9bbc2] px-2.5 text-[#8b8c95]"><Search className="size-3.5 shrink-0" /><span className="truncate text-[9px]">搜索视频与创作者</span></div>
      <div className="size-6 shrink-0 rounded-full bg-[#e8f4fa]" />
      <Mail className="size-5 shrink-0 text-[#60646d]" />
    </div>
    <div className="flex h-9 items-center justify-between gap-2 overflow-hidden border-b border-[#e8e8eb] bg-white px-3 text-[11px] text-[#777981]">
      <span>直播</span><span className="relative flex h-full items-center font-semibold text-[#fb6aa2]">推荐<span className="absolute inset-x-0 bottom-0 h-0.5 rounded bg-[#fb6aa2]" /></span><span>热门</span><span>动画</span><span>影视</span><Menu className="size-3.5 shrink-0" />
    </div>
    <div className={`tool-scroll absolute inset-x-0 bottom-11 px-1 pb-3 pt-1 ${showStatusBar ? "top-25" : "top-20"}`}>
      <div className="mb-1.5 overflow-hidden rounded-[4px] bg-white">
        <div className="aspect-video bg-[#e9eaee]" />
        <div className="flex h-8 items-center gap-2 px-2"><span className="h-2 w-3/4 rounded bg-[#e9eaee]" /><ThumbsUp className="ml-auto size-3.5 shrink-0 text-[#c4c6ce]" /><MoreVertical className="size-3.5 shrink-0 text-[#c4c6ce]" /></div>
      </div>
      <div className="grid grid-cols-2 items-start gap-1.5">
        <div className="min-w-0 overflow-hidden rounded-[4px] bg-white">
          <div className="relative aspect-[4/3] overflow-hidden">{artwork}</div>
          <p className="line-clamp-2 h-10 break-words px-1.5 pt-1 text-[10px] font-medium leading-4">{headline}</p>
          <div className="flex items-center gap-1 px-1.5 pb-1.5 text-[8px] text-[#94969f]"><span className="min-w-0 flex-1 truncate">{author}</span><MoreVertical className="size-3 shrink-0" /></div>
        </div>
        {[0, 1, 2].map(index => <div key={index} className="min-w-0 overflow-hidden rounded-[4px] bg-white" aria-hidden="true">
          <div className="aspect-[4/3] bg-[#e9eaee]" />
          <div className="flex h-10 flex-col gap-1 px-1.5 pt-2"><span className="h-1.5 w-4/5 rounded bg-[#e9eaee]" /><span className="h-1.5 w-3/5 rounded bg-[#e9eaee]" /></div>
          <div className="px-1.5 pb-2"><span className="block h-1.5 w-2/5 rounded bg-[#e9eaee]" /></div>
        </div>)}
      </div>
    </div>
    <div className="absolute inset-x-0 bottom-0 flex h-11 items-center justify-around border-t border-[#ededf0] bg-white text-[#777981]">
      <span className="flex flex-col items-center gap-0.5 text-[#fb6aa2]"><Home className="size-4" /><span className="text-[8px]">首页</span></span>
      <span className="flex flex-col items-center gap-0.5"><MessageCircle className="size-4" /><span className="text-[8px]">动态</span></span>
      <span className="grid size-7 place-items-center rounded-[8px] bg-[#fb6aa2] text-white"><Plus className="size-5" /></span>
      <span className="flex flex-col items-center gap-0.5"><ShoppingBag className="size-4" /><span className="text-[8px]">会员购</span></span>
      <span className="flex flex-col items-center gap-0.5"><Tv className="size-4" /><span className="text-[8px]">我的</span></span>
    </div>
  </div>
}

export function CoverFeedPreview({ platform, imageSrc, imageMissing, title, account, orientation, onOrientationChange, showStatusBar = false }: {
  platform: string
  imageSrc: string
  imageMissing?: string
  title: string
  account: string
  orientation: Orientation
  onOrientationChange?: (value: Orientation) => void
  showStatusBar?: boolean
}) {
  const dark = darkPlatforms.has(platform)
  const portrait = orientation === "portrait"
  const gridLayout = portrait || portraitFeeds.has(platform)
  const [imageFailed, setImageFailed] = useState(false)
  useEffect(() => setImageFailed(false), [imageSrc])
  const headline = title.trim() || "视频标题"
  const author = account || "账号预览"
  const artwork = imageSrc && !imageFailed ? <img src={imageSrc} alt="封面" onError={() => setImageFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
    : <div className={`absolute inset-0 flex flex-col items-center justify-center gap-2 px-2 text-center ${dark ? "bg-[#252525] text-white/55" : "bg-[#e9ecee] text-muted-foreground"}`}>
      <ImageIcon className="size-6" strokeWidth={1.5} /><span className="text-[10px]">{imageFailed ? "封面无法预览" : imageMissing || "尚未选择封面"}</span>
    </div>
  if (platform === "bilibili") return <BilibiliFeedPreview artwork={artwork} headline={headline} author={author} showStatusBar={showStatusBar} />
  const mutedTile = <div className={`relative overflow-hidden rounded-[4px] ${portrait ? "aspect-[3/4]" : "aspect-[4/3]"} ${dark ? "bg-[#1e1e1e]" : "bg-[#eceeef]"}`}>
    <div className={`absolute inset-x-2 bottom-3 space-y-1 ${dark ? "opacity-35" : "opacity-45"}`}>
      <div className={`h-1.5 w-4/5 rounded ${dark ? "bg-white/25" : "bg-gray-300"}`} />
      <div className={`h-1.5 w-2/3 rounded ${dark ? "bg-white/25" : "bg-gray-300"}`} />
    </div>
  </div>

  return <div className={`absolute inset-0 overflow-hidden ${dark ? "bg-[#0e0e0f] text-white" : "bg-white text-foreground"}`}>
    {showStatusBar && <div className="flex h-5 items-center justify-between px-3 text-[9px] font-semibold"><span>9:41</span><span className="flex items-center gap-0.5"><Signal className="size-2.5" /><Wifi className="size-2.5" /><BatteryFull className="size-3" /></span></div>}
    <div className={`flex h-10 items-center justify-between border-b px-3 text-[11px] ${dark ? "border-white/10" : "border-border"}`}>
      {darkPlatforms.has(platform) ? <Menu className="size-4" /> : <span className="font-semibold">{platformLabel(platform)}</span>}
      <span className="font-semibold">{sections[platform] || (portrait ? "发现" : "视频")}</span>
      <Search className="size-4" />
    </div>
    <div className={`tool-scroll absolute inset-x-0 bottom-10 px-2 pb-12 pt-2 ${showStatusBar ? "top-15" : "top-10"}`}>
      {dark && <div className="mb-2 h-32 rounded-[4px] bg-[#1c1c1d] px-2 py-3">
        <div className="h-full border-b border-white/5" /><div className="-mt-6 h-1.5 w-28 rounded bg-white/15" />
      </div>}
      {gridLayout ? <div className="grid grid-cols-2 items-start gap-2">
        <div className={`min-w-0 overflow-hidden rounded-[4px] ${dark ? "bg-[#1b1b1c]" : "bg-white"}`}>
          <div className={`relative overflow-hidden ${portrait ? "aspect-[3/4]" : "aspect-[4/3]"}`}>{artwork}
            {dark && <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-8 text-[10px] font-semibold leading-4"><p className="line-clamp-2 break-words">{headline}</p></div>}
          </div>
          {!dark && <p className="line-clamp-2 min-h-8 break-words px-1 pt-1 text-[10px] font-medium leading-4">{headline}</p>}
          <div className={`flex min-w-0 items-center gap-1 px-1 py-1 text-[9px] ${dark ? "text-white/75" : "text-muted-foreground"}`}>
            <span className={`size-3 shrink-0 rounded-full ${dark ? "bg-white/35" : "bg-gray-300"}`} />
            <span className="min-w-0 flex-1 truncate">{author}</span><Heart className="size-3 shrink-0" />
          </div>
        </div>
        {mutedTile}{mutedTile}{mutedTile}
      </div> : <div className="space-y-3">
        <div className={`overflow-hidden rounded-[4px] ${dark ? "bg-[#1b1b1c]" : "bg-white"}`}>
          <div className="relative aspect-video overflow-hidden bg-muted">{artwork}</div>
          <div className="flex gap-2 px-1 py-2"><span className="mt-0.5 size-6 shrink-0 rounded-full bg-gray-300" />
            <div className="min-w-0"><p className="line-clamp-2 break-words text-[11px] font-semibold leading-4">{headline}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{author}</p></div>
          </div>
        </div>
        <div className="space-y-2"><div className="h-28 rounded-[4px] bg-muted" /><div className="h-2 w-4/5 rounded bg-muted" /><div className="h-2 w-1/2 rounded bg-muted" /></div>
      </div>}
    </div>
    {onOrientationChange && <div className={`absolute bottom-11 left-1/2 z-10 grid w-36 -translate-x-1/2 grid-cols-2 rounded-full p-0.5 shadow-sm ${dark ? "bg-white" : "border border-border bg-white"}`} role="group" aria-label="封面比例">
      {(["landscape", "portrait"] as const).map(item => <button key={item} type="button" aria-pressed={orientation === item}
        onClick={() => onOrientationChange(item)} className={`h-6 rounded-full text-[10px] font-medium ${orientation === item ? "bg-primary text-white" : "text-muted-foreground"}`}>
        {item === "landscape" ? "横封面" : "竖封面"}
      </button>)}
    </div>}
    <div className={`absolute inset-x-0 bottom-0 flex h-10 items-center justify-around border-t ${dark ? "border-white/10 bg-[#0e0e0f] text-white/60" : "border-border bg-white text-muted-foreground"}`}>
      {(navigation[platform] || ["首页", "发现", "发布", "消息", "我"]).map((label, index) => {
        const Icon = navIcons[index]
        return <span key={`${label}-${index}`} className="flex min-w-0 flex-col items-center justify-center gap-0.5"><Icon className="size-3.5" /><span className="max-w-12 truncate text-[8px]">{label}</span></span>
      })}
    </div>
  </div>
}
