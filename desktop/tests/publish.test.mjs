import assert from "node:assert/strict"
import test from "node:test"
import { normalizeTags, preferredCover, publishValues } from "../src/publish.ts"

const action = (...names) => ({ name: "upload-video", description: "", actions: [], options: names.map(name => ({ name })) })
const common = (changes = {}) => ({
  account: "creator", file: "video.mp4", title: "标题", desc: "简介", tags: "标签",
  thumbnail: "cover.png", thumbnailLandscape: "wide.png", thumbnailPortrait: "tall.png",
  schedule: "", prepareOnly: false, origin: "", mark: "", ...changes,
})

test("common cover and copy are reused without overriding platform fields", () => {
  const values = publishValues("kuaishou", action("thumbnail", "tags"), common(), {
    collection: "系列", title: "错误覆盖", thumbnail: "other.png",
  })
  assert.equal(values.thumbnail, "cover.png")
  assert.equal(values.title, "标题")
  assert.equal(values.collection, "系列")
  assert.equal(publishValues("zhihu", action("originality", "video_mark"), common({ origin: "original", mark: "none" }), { category: "教育" }).thumbnail, undefined)
})

test("declarations map to each supported CLI contract", () => {
  const fields = common({ origin: "original", mark: "ai" })
  assert.equal(publishValues("douyin", action("declaration"), fields, {}).declaration, "内容由AI生成")
  assert.equal(publishValues("dayu", action("source"), fields, {}).source, "AI生成")
  const zhihu = publishValues("zhihu", action("originality", "video_mark"), fields, { category: "教育" })
  assert.equal(zhihu.originality, "original")
  assert.equal(zhihu.video_mark, "含 AI 生成内容")
})

test("reprint maps only with required Dayu source URL", () => {
  const fields = common({ origin: "reprint", mark: "none" })
  assert.equal(publishValues("douyin", action("declaration"), fields, {}).declaration, "内容为转载信息")
  assert.equal(publishValues("zhihu", action("originality", "video_mark"), fields, { category: "教育" }).video_mark, "内容为转载")
  assert.throws(() => publishValues("dayu", action("source"), fields, {}), /原文链接/)
  assert.equal(publishValues("dayu", action("source"), fields, { source_url: "https://example.com/story" }).source, "转载")
})

test("unsupported or contradictory declarations stop before queueing", () => {
  assert.throws(() => publishValues("zhihu", action("originality", "video_mark"), common({ mark: "ai" }), {}), /版权归属/)
  assert.throws(() => publishValues("zhihu", action("originality", "video_mark"), common({ origin: "original", mark: "ai" }), {}), /所属领域/)
  assert.throws(() => publishValues("douyin", action("declaration"), common({ mark: "fiction" }), {}), /抖音声明文案/)
  assert.throws(() => publishValues("dayu", action("source"), common({ origin: "reprint", mark: "ai" }), {}), /不能同时设置/)
  assert.throws(() => publishValues("weibo", action(), common({ origin: "original", mark: "ai" }), {}), /固定选择/)
})

test("one account can override the shared declaration", () => {
  const fields = common({ origin: "original", mark: "fiction" })
  const douyin = publishValues("douyin", action("declaration"), fields, {}, { mark: "ai" })
  assert.equal(douyin.declaration, "内容由AI生成")
  const zhihu = publishValues("zhihu", action("originality", "video_mark"), fields, { category: "教育" }, { mark: "none" })
  assert.equal(zhihu.video_mark, "内容无需标注")
  assert.equal(publishValues("dayu", action("source"), fields, {}).source, "虚构演绎")
})

test("Weibo's fixed declaration needs explicit confirmation", () => {
  const fields = common({ origin: "original", mark: "none" })
  assert.throws(() => publishValues("weibo", action("thumbnail"), fields, {}), /确认声明/)
  assert.equal(publishValues("weibo", action("thumbnail"), fields, {}, { confirmWeibo: true }).thumbnail, "cover.png")
})

test("Chinese and English commas share one tag list", () => {
  assert.equal(normalizeTags(" 旅行，摄影, 美食 ， #城市 "), "旅行,摄影,美食,#城市")
  assert.equal(publishValues("douyin", action("tags"), common({ tags: "旅行，摄影,美食" }), {}).tags, "旅行,摄影,美食")
})

test("cover selection passes both aspect ratios where supported", () => {
  const fields = common()
  const values = publishValues("tencent", action("thumbnail", "thumbnail_landscape", "thumbnail_portrait"), fields, {})
  assert.equal(values.thumbnail, undefined)
  assert.equal(values.thumbnail_landscape, "wide.png")
  assert.equal(values.thumbnail_portrait, "tall.png")
  assert.equal(preferredCover("wide.png", "tall.png", true), "wide.png")
  assert.equal(preferredCover("wide.png", "tall.png", false), "tall.png")
})

test("prepare-only never queues an unsupported publishing action", () => {
  const fields = common({ prepareOnly: true })
  assert.equal(publishValues("douyin", action("prepare_only"), fields, {}).prepare_only, true)
  assert.equal(publishValues("kuaishou", action("prepare_only"), fields, {}).prepare_only, true)
  assert.equal(publishValues("zhihu", action("prepare_only"), { ...fields, origin: "original", mark: "none" }, { category: "教育" }).prepare_only, true)
  assert.equal(publishValues("tencent", action("draft"), fields, {}).draft, true)
  assert.throws(() => publishValues("youtube", action("title"), fields, {}), /不支持只准备素材/)
})
