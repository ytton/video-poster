export const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  kuaishou: "快手",
  xiaohongshu: "小红书",
  bilibili: "哔哩哔哩",
  tencent: "视频号",
  baijiahao: "百家号",
  dayu: "大鱼号",
  alipay: "支付宝生活号",
  weibo: "微博",
  hupu: "虎扑",
  zhihu: "知乎",
  xueqiu: "雪球",
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
  "facebook-page": "Facebook Page",
  article: "本地文章",
}

export const PLATFORM_COLORS: Record<string, string> = {
  douyin: "#17242a",
  kuaishou: "#ec6a29",
  xiaohongshu: "#bc3442",
  bilibili: "#167ba5",
  tencent: "#28935e",
  baijiahao: "#3155a6",
  dayu: "#5a70ad",
  alipay: "#147cb7",
  weibo: "#db6c27",
  hupu: "#a13a35",
  zhihu: "#2463ad",
  xueqiu: "#7c944a",
  youtube: "#d43f3a",
  instagram: "#a64580",
  facebook: "#3263a7",
  "facebook-page": "#3263a7",
}

export const platformLabel = (id: string) => PLATFORM_LABELS[id] ?? id
export const accountId = (repoRoot: string, platform: string, name: string) => `${repoRoot}|${platform}|${name}`

export const FIELD_LABELS: Record<string, string> = {
  account: "账号别名", file: "文件", images: "图片", title: "标题", desc: "简介",
  note: "正文", tags: "话题标签", thumbnail: "封面", thumbnail_landscape: "横版封面",
  thumbnail_portrait: "竖版封面", schedule: "定时发布", tid: "B站分区 ID",
  category: "分类", originality: "原创声明", video_mark: "视频标记",
  declaration: "创作声明", product_link: "商品链接", product_title: "商品名称",
  short_title: "短标题", collection: "合集", proxy: "网络代理",
  page: "主页", page_id: "主页 ID", post_url: "作品链接",
  content_id: "作品 ID", expected_text: "校验文本", result: "结果路径",
  output: "输出路径", content_file: "正文文件", notef: "正文文件",
  upload_timeout: "上传超时（秒）", timeout: "等待超时（秒）",
  draft: "存草稿", prepare_only: "仅准备，不发布", headed: "显示浏览器",
  debug: "调试模式", show_options: "查看可选项", overwrite: "覆盖输出",
}

export const fieldLabel = (name: string) => FIELD_LABELS[name] ?? name.replaceAll("_", " ")
