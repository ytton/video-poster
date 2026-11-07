import type { CliNode, FormValues } from "./types"

export type Origin = "" | "original" | "reprint"
export type ContentMark = "" | "none" | "ai" | "fiction" | "marketing" | "opinion" | "minors"

export interface PublishOverrides {
  origin?: Origin
  mark?: ContentMark
  confirmWeibo?: boolean
}

export interface CommonPublishFields {
  account: string
  file: string
  title: string
  desc: string
  tags: string
  thumbnail: string
  thumbnailLandscape: string
  thumbnailPortrait: string
  schedule: string
  prepareOnly: boolean
  origin: Origin
  mark: ContentMark
}

export const SHARED_OPTIONS = new Set([
  "account", "file", "title", "desc", "tags", "thumbnail", "schedule",
  "thumbnail_landscape", "thumbnail_portrait", "originality", "video_mark", "source", "declaration",
  "prepare_only", "draft",
])

export function normalizeTags(raw: string): string {
  return raw.split(/[,，]/).map(tag => tag.trim()).filter(Boolean).join(",")
}

export function preferredCover(landscape: string, portrait: string, videoLandscape: boolean): string {
  return (videoLandscape ? landscape || portrait : portrait || landscape).trim()
}

const dayuMarks: Record<Exclude<ContentMark, "">, string> = {
  none: "无需标注", ai: "AI生成", fiction: "虚构演绎", marketing: "营销信息",
  opinion: "个人观点", minors: "不适宜未成年人",
}

const zhihuMarks: Partial<Record<Exclude<ContentMark, "">, string>> = {
  none: "内容无需标注", ai: "含 AI 生成内容", fiction: "含虚构演绎内容",
  marketing: "内容含营销信息", opinion: "个人观点仅供参考",
}

const douyinMarks: Partial<Record<Exclude<ContentMark, "">, string>> = {
  ai: "内容由AI生成", opinion: "内容为个人观点或见解",
}

export function publishValues(platform: string, action: CliNode, common: CommonPublishFields, extras: FormValues, overrides: PublishOverrides = {}): FormValues {
  const has = (name: string) => action.options.some(option => option.name === name)
  const origin = overrides.origin ?? common.origin
  const contentMark = overrides.mark ?? common.mark
  const values: FormValues = {
    account: common.account, file: common.file, title: common.title,
    desc: common.desc, tags: normalizeTags(common.tags),
  }
  if (common.thumbnail && has("thumbnail") && !(has("thumbnail_landscape") && has("thumbnail_portrait"))) values.thumbnail = common.thumbnail
  if (common.thumbnailLandscape && has("thumbnail_landscape")) values.thumbnail_landscape = common.thumbnailLandscape
  if (common.thumbnailPortrait && has("thumbnail_portrait")) values.thumbnail_portrait = common.thumbnailPortrait
  if (common.schedule && has("schedule")) values.schedule = common.schedule
  if (common.prepareOnly) {
    if (has("prepare_only")) values.prepare_only = true
    else if (has("draft")) values.draft = true
    else throw new Error("当前 CLI 不支持只准备素材，请取消该账号或关闭开关")
  }

  if (platform === "zhihu") {
    if (!origin) throw new Error("请选择版权归属（原创或转载）")
    if (typeof extras.category !== "string" || !extras.category.trim()) throw new Error("请选择所属领域")
    const mark = origin === "reprint" && (!contentMark || contentMark === "none")
      ? "内容为转载" : contentMark && zhihuMarks[contentMark]
    if (!mark) throw new Error("请选择知乎支持的内容标记")
    values.originality = origin
    values.video_mark = mark
  } else if (platform === "dayu") {
    if (origin === "reprint" && contentMark && contentMark !== "none") {
      throw new Error("转载与其他内容标记不能同时设置，请调整声明或取消大鱼号")
    }
    if (!contentMark && origin !== "reprint") throw new Error("请选择内容标记")
    if (origin === "reprint" && (typeof extras.source_url !== "string" || !/^https?:\/\//i.test(extras.source_url.trim()))) {
      throw new Error("转载须在大鱼号专属设置中填写 http/https 原文链接")
    }
    values.source = origin === "reprint" ? "转载" : dayuMarks[contentMark as Exclude<ContentMark, "">]
  } else if (platform === "douyin") {
    if (origin === "reprint" && contentMark && contentMark !== "none") {
      throw new Error("转载与其他内容标记不能同时设置，请调整声明或取消抖音")
    }
    if (origin === "reprint") values.declaration = "内容为转载信息"
    else if (contentMark && contentMark !== "none") {
      const declaration = douyinMarks[contentMark]
      if (!declaration) throw new Error("该内容标记尚无抖音声明文案映射，请调整声明或取消抖音")
      values.declaration = declaration
    }
  } else if (platform === "weibo") {
    if (!overrides.confirmWeibo) {
      throw new Error("微博上传器固定选择“二创”和“含AI生成内容”；请在微博账号下确认声明")
    }
  }

  for (const [name, value] of Object.entries(extras)) {
    if (!SHARED_OPTIONS.has(name)) values[name] = value
  }
  return values
}
