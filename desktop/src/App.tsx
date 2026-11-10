import { Component, useEffect, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from "react"
import { convertFileSrc } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Check, CircleAlert, CircleHelp, Clapperboard, Copy, ExternalLink, Globe2, History, LockKeyhole, Plus, Puzzle, RefreshCw, Send, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppProvider, useApp } from "./state"
import { inDesktop, prepareCoverPreview, prepareVideoPreview } from "./native"
import { CREATOR_PAGES, platformLabel, PLATFORM_COLORS, UPLOAD_PAGES } from "./platforms"
import { VideoDropzone } from "./components/VideoDropzone"
import { CoverDropzone } from "./components/CoverDropzone"
import { VideoFramePicker } from "./components/VideoFramePicker"
import { PublishPreview } from "./components/PublishPreview"
import { FaultDialog } from "./components/FaultDialog"
import { TitleBar } from "./components/TitleBar"
import { getFaults, reportFault, subscribeFaults } from "./faults"
import type { TaskRecord, WorkRecord } from "./types"
import authorAvatar from "./assets/author.jpg"

type Page = "publish" | "works" | "platforms" | "tasks" | "extension"
const mainPages: { id: Page; label: string; icon: typeof Send }[] = [
  { id: "works", label: "作品管理", icon: Clapperboard },
  { id: "publish", label: "新建作品", icon: Plus },
  { id: "platforms", label: "平台", icon: Globe2 },
  { id: "tasks", label: "任务", icon: History },
  { id: "extension", label: "浏览器扩展", icon: Puzzle },
]

function PlatformMark({ platform }: { platform: string }) {
  return <span className="inline-grid size-7 shrink-0 place-items-center rounded-md text-xs font-semibold text-white"
    style={{ backgroundColor: PLATFORM_COLORS[platform] || "#5b6870" }} aria-hidden="true">{platformLabel(platform).slice(0, 1)}</span>
}

function StatusTag({ status }: { status: string }) {
  const labels: Record<string, string> = {
    queued: "等待扩展", running: "进行中", prepared: "待平台发布", verified: "已检验", success: "已发布",
    failed: "失败", interrupted: "需核对", cancelled: "已停止",
  }
  const styles: Record<string, string> = {
    queued: "border-gray-200 bg-gray-50 text-gray-700", running: "border-sky-200 bg-sky-50 text-sky-800",
    prepared: "border-amber-200 bg-amber-50 text-amber-800", verified: "border-emerald-200 bg-emerald-50 text-emerald-800", success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    failed: "border-red-200 bg-red-50 text-red-800", interrupted: "border-amber-200 bg-amber-50 text-amber-800",
  }
  return <Badge variant="outline" className={`font-normal ${styles[status] || "border-gray-200 text-gray-700"}`}>{labels[status] || status}</Badge>
}

function SectionHead({ title, right, subtitle }: { title: string; right?: ReactNode; subtitle?: string }) {
  return <div className="flex min-h-10 shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-3">
    <div className="min-w-0"><h1 className="text-base font-semibold">{title}</h1>{subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}</div>
    <div className="flex shrink-0 items-center gap-2">{right}</div>
  </div>
}

function WorkThumbnail({ work }: { work: WorkRecord }) {
  const [url, setUrl] = useState("")
  const path = work.content.thumbnailPortrait || work.content.thumbnailLandscape
  useEffect(() => {
    let active = true
    setUrl("")
    if (path && inDesktop) void prepareCoverPreview(path).then(prepared => { if (active) setUrl(convertFileSrc(prepared)) }).catch(() => {})
    return () => { active = false }
  }, [path])
  return <span className="absolute inset-0 grid place-items-center overflow-hidden bg-muted">
    {url ? <img src={url} alt="作品封面" className="h-full w-full object-cover" /> : <Clapperboard className="size-5 text-muted-foreground" />}
  </span>
}

function Empty({ icon: Icon, title, detail }: { icon: typeof Send; title: string; detail?: string }) {
  return <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
    <Icon className="size-7 opacity-50" strokeWidth={1.5} /><p className="font-medium text-foreground">{title}</p>{detail && <p className="text-xs">{detail}</p>}
  </div>
}

function PublishPage({ onPublished, initialWork, selectedPlatforms, openPlatforms }: {
  onPublished: (id: string) => void; initialWork?: WorkRecord; selectedPlatforms: string[]; openPlatforms: () => void
}) {
  const { tasks, prepareWork, createTask, resumeTask, refreshTask, startManualPlatform, activateWork, verifyPublished, setOperationError } = useApp()
  const [file, setFile] = useState("")
  const [title, setTitle] = useState(initialWork?.content.title || "")
  const [description, setDescription] = useState(initialWork?.content.description || "")
  const [tags, setTags] = useState(initialWork?.content.tags || "")
  const [thumbnailLandscape, setThumbnailLandscape] = useState("")
  const [thumbnailPortrait, setThumbnailPortrait] = useState("")
  const [framePickerOpen, setFramePickerOpen] = useState(false)
  const [framePickerOrientation, setFramePickerOrientation] = useState<"portrait" | "landscape">("portrait")
  const [origin, setOrigin] = useState(initialWork?.content.origin === "reprint" ? "reprint" : "original")
  const [mark, setMark] = useState(["ai", "opinion"].includes(initialWork?.content.mark || "") ? initialWork!.content.mark : "none")
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [confirmingPlatform, setConfirmingPlatform] = useState("")
  const completed = new Set(initialWork?.publications.map(item => item.platform) || [])
  const platformTask = (platform: string) => tasks.find(task => task.workId === initialWork?.id && task.platform === platform && !["cancelled", "success"].includes(task.status))

  useEffect(() => {
    if (!initialWork) return
    let active = true
    void prepareVideoPreview(initialWork.filePath).then(path => { if (active) setFile(path) })
      .catch(() => { if (active) setFormError("原视频文件不可用，请重新选择同一份视频") })
    for (const [path, setter] of [
      [initialWork.content.thumbnailLandscape, setThumbnailLandscape],
      [initialWork.content.thumbnailPortrait, setThumbnailPortrait],
    ] as const) {
      if (path) void prepareCoverPreview(path).then(prepared => { if (active) setter(prepared) }).catch(() => {})
    }
    return () => { active = false }
  }, [initialWork?.id])

  const changeVideo = (path: string) => {
    if (path !== file) {
      if (!initialWork) { setThumbnailLandscape(""); setThumbnailPortrait("") }
      setFramePickerOpen(false)
    }
    setFile(path)
  }
  const openFramePicker = (orientation: "portrait" | "landscape") => {
    setFramePickerOrientation(orientation)
    setFramePickerOpen(true)
  }
  const declaration = origin === "reprint" ? "内容为转载信息" : mark === "ai" ? "内容由AI生成" : mark === "opinion" ? "内容为个人观点或见解" : ""
  const saveCurrentWork = async () => {
    setFormError("")
    if (!file || !title.trim()) { setFormError("请选择视频并填写标题"); return null }
    if (!selectedPlatforms.length) { setFormError("请先到平台页选择发布平台"); return null }
    if (selectedPlatforms.includes("douyin") && title.trim().length > 30) { setFormError("抖音标题最多 30 字"); return null }
    if (selectedPlatforms.includes("baijiahao") && title.trim().length < 9) { setFormError("百家号视频标题至少 9 字"); return null }
    if (selectedPlatforms.includes("dayu") && title.trim().length < 5) { setFormError("大鱼号视频标题至少 5 字"); return null }
    if (selectedPlatforms.includes("dayu") && description.length > 200) { setFormError("大鱼号视频简介最多 200 字"); return null }
    if (selectedPlatforms.includes("douyin") && origin === "reprint" && mark !== "none") { setFormError("转载与其他内容声明不能同时设置"); return null }
    setSubmitting(true)
    try {
      const normalizedTags = tags.split(/[,，]/).map(tag => tag.trim().replace(/^#/, "")).filter(Boolean)
      const work = await prepareWork(file, {
        title: title.trim(), description, tags: normalizedTags.join(","), platforms: selectedPlatforms, thumbnailLandscape,
        thumbnailPortrait, origin, mark, schedule: "",
      }, initialWork?.sha256)
      await activateWork(work, false)
      onPublished(work.id)
      return work
    } catch (error) {
      setFormError(String(error))
      return null
    } finally { setSubmitting(false) }
  }

  const startPlatform = async (platform: string) => {
    setConfirmingPlatform(platform)
    try {
      const work = await saveCurrentWork()
      if (!work) return
      if (!UPLOAD_PAGES[platform]) {
        await startManualPlatform(work, platform)
        return
      }
      const pending = tasks.find(task => task.workId === work.id && task.platform === platform && !["cancelled", "success"].includes(task.status))
      const input = {
        platform, filePath: file, title: title.trim(), description,
        tags: tags.split(/[,，]/).map(tag => tag.trim().replace(/^#/, "")).filter(Boolean),
        declaration, thumbnailPortrait, thumbnailLandscape,
      }
      if (pending) { await refreshTask(pending.id, input); await resumeTask(pending.id) }
      else await createTask(work, input)
    } catch (error) { setOperationError(`无法打开${platformLabel(platform)}发布页：${String(error)}`) }
    finally { setConfirmingPlatform("") }
  }

  const verifyPlatform = async (platform: string) => {
    const task = platformTask(platform)
    if (!task) return
    setConfirmingPlatform(platform)
    try { await verifyPublished(task.id) }
    catch (error) { setOperationError(String(error)) }
    finally { setConfirmingPlatform("") }
  }

  return <div className="flex h-full min-h-0 flex-col">
    <SectionHead title={initialWork ? "编辑作品" : "新建作品"}
      subtitle="保存作品后逐个平台去发布，完成后回来检验记录"
      right={<Button size="sm" onClick={() => void saveCurrentWork()} disabled={submitting}><Upload />{submitting ? "正在保存" : "保存作品"}</Button>} />
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(270px,320px)]">
      <div className="tool-scroll min-h-0 px-5 py-4" tabIndex={0}><div className="space-y-5">
        <section className="space-y-3"><h2 className="text-sm font-semibold">视频与文案</h2>
          <div className="grid gap-3">
            <div className="flex flex-col gap-1.5"><span className="text-xs font-medium">视频文件 *</span><VideoDropzone value={file} onChange={changeVideo} onError={setFormError} /></div>
            <label className="flex flex-col gap-1.5"><span className="text-xs font-medium">标题 * <span className="font-normal text-muted-foreground">{title.length}/30</span></span><Input className="bg-white" value={title} onChange={event => setTitle(event.target.value)} placeholder="视频标题" maxLength={30} /></label>
            <label className="flex flex-col gap-1.5"><span className="text-xs font-medium">简介</span><Textarea className="min-h-20 bg-white" value={description} onChange={event => setDescription(event.target.value)} placeholder="视频简介" /></label>
            <label className="flex flex-col gap-1.5"><span className="text-xs font-medium">话题标签</span><Input className="bg-white" value={tags} onChange={event => setTags(event.target.value)} placeholder="用中文或英文逗号分隔" /></label>
          </div>
        </section>
        <section className="space-y-3 border-t border-border pt-4"><h2 className="text-sm font-semibold">封面与声明</h2>
          <div className="flex min-w-0 items-start gap-3">
            <CoverDropzone label="竖版" ratio="3:4" videoPath={file} value={thumbnailPortrait} onChange={setThumbnailPortrait} onOpenPicker={() => openFramePicker("portrait")} onError={setFormError} />
            <CoverDropzone label="横版" ratio="4:3" videoPath={file} value={thumbnailLandscape} onChange={setThumbnailLandscape} onOpenPicker={() => openFramePicker("landscape")} onError={setFormError} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-medium">版权归属</span><Select value={origin} onValueChange={setOrigin}><SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="original">原创</SelectItem><SelectItem value="reprint">转载</SelectItem></SelectContent></Select></label>
            <label className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-medium">内容声明</span><Select value={mark} onValueChange={setMark}><SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">无需标注</SelectItem><SelectItem value="ai">AI 生成</SelectItem><SelectItem value="opinion">个人观点</SelectItem></SelectContent></Select></label>
          </div>
        </section>
        <section className="space-y-2 border-t border-border pt-4"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">发布平台</h2>
          <Button size="sm" variant="ghost" onClick={openPlatforms}>选择平台</Button></div>
          {!selectedPlatforms.length && <p className="text-xs text-muted-foreground">尚未选择发布平台</p>}
          <div className="divide-y divide-border border-y border-border bg-white">{selectedPlatforms.map(platform => {
            const publication = initialWork?.publications.find(item => item.platform === platform)
            const done = !!publication
            const task = platformTask(platform)
            return <div key={platform} className="flex min-h-11 items-center gap-2 px-2.5 py-1.5 text-xs">
              <PlatformMark platform={platform} /><span className="min-w-0 flex-1 font-medium">{platformLabel(platform)}</span>
              <span className={done ? "text-emerald-700" : "text-muted-foreground"}>{done ? "已发布" : task ? !UPLOAD_PAGES[platform] ? "手动发布中" : task.status === "prepared" ? "待用户发布" : task.status === "failed" ? "需补齐" : "进行中" : "未发布"}</span>
              {!done && <Button size="sm" variant="ghost" disabled={confirmingPlatform === platform || submitting} onClick={() => void startPlatform(platform)}><ExternalLink />{task ? "继续发布" : "去发布"}</Button>}
              {!done && task && !!UPLOAD_PAGES[platform] && <Button size="sm" variant="outline" disabled={confirmingPlatform === platform} onClick={() => void verifyPlatform(platform)}><Check />检验已发布</Button>}
              {publication?.evidence?.recordUrl && <Button size="icon-sm" variant="ghost" title="打开平台作品记录" aria-label="打开平台作品记录"
                onClick={() => void openUrl(publication.evidence!.recordUrl).catch(error => setOperationError(String(error)))}><ExternalLink /></Button>}
            </div>
          })}</div>
          {initialWork && [...completed].filter(platform => !selectedPlatforms.includes(platform)).map(platform =>
            <p key={platform} className="text-xs text-emerald-700">{platformLabel(platform)}已发布</p>)}
        </section>
        {formError && <p className="rounded bg-red-50 p-3 text-xs text-destructive">{formError}</p>}
      </div>
      </div>
      <PublishPreview platforms={selectedPlatforms.length ? selectedPlatforms : ["douyin"]} file={file} title={title} description={description} tags={tags}
        onVideoOrientationChange={() => {}}
        coverForPlatform={(_, orientation) => orientation === "landscape" ? thumbnailLandscape : thumbnailPortrait}
        accountName={() => "浏览器账号"} />
    </div>
    <VideoFramePicker open={framePickerOpen} onOpenChange={setFramePickerOpen} initialOrientation={framePickerOrientation}
      file={file} title={title} account="浏览器账号"
      onCaptured={covers => { setThumbnailPortrait(covers.portrait); setThumbnailLandscape(covers.landscape) }} onError={setFormError} />
  </div>
}

function WorksPage({ onReuse, onNew, selectedPlatforms }: { onReuse: (id: string) => void; onNew: () => void; selectedPlatforms: string[] }) {
  const { works, activeWorkId, activateWork, deactivateWork, setOperationError } = useApp()
  const [query, setQuery] = useState("")
  const visible = works.filter(work => `${work.content.title} ${work.filePath} ${work.sha256}`.toLowerCase().includes(query.toLowerCase()))
  const toggleLock = async (work: WorkRecord) => {
    try {
      if (activeWorkId === work.id) await deactivateWork()
      else await activateWork(work, (work.content.platforms || selectedPlatforms).includes("douyin"))
    } catch (error) { setOperationError(`无法锁定作品：${String(error)}`) }
  }
  return <div className="flex h-full min-h-0 flex-col">
    <SectionHead title="作品管理" subtitle={`${works.length} 部视频 · 按文件 SHA-256 归档`}
      right={<Button size="sm" onClick={onNew}><Plus />新建作品</Button>} />
    <div className="shrink-0 border-b border-border px-5 py-3"><Input className="max-w-md bg-white" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题、文件或哈希" aria-label="搜索作品" /></div>
    {!visible.length ? <Empty icon={Clapperboard} title={works.length ? "没有匹配的作品" : "暂无作品"} detail="新建作品并填写视频资料" /> :
      <div className="tool-scroll min-h-0 flex-1 p-4" tabIndex={0}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,152px))] content-start gap-3">{visible.map(work => <div key={work.id}
          className={`group relative min-w-0 overflow-hidden rounded border bg-muted ${activeWorkId === work.id ? "border-primary ring-1 ring-primary" : "border-border"}`}>
          <button type="button" onClick={() => onReuse(work.id)} title={`编辑 ${work.content.title || "未命名视频"}`}
            className="relative block aspect-[3/4] w-full text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
            <WorkThumbnail work={work} />
            <span className="absolute inset-x-0 bottom-0 min-h-16 bg-black/75 px-2.5 py-2 text-white">
              <span className="line-clamp-2 break-words text-xs font-semibold leading-4">{work.content.title || "未命名视频"}</span>
              <span className="mt-1 block truncate text-[11px] text-white/80">已发布 {new Set(work.publications.map(item => item.platform)).size} 个平台</span>
            </span>
          </button>
          <Button size="icon-sm" variant="ghost" title={activeWorkId === work.id ? "取消锁定" : "锁定为当前发布项目"}
            aria-pressed={activeWorkId === work.id}
            aria-label={`${activeWorkId === work.id ? "取消锁定" : "锁定"} ${work.content.title || "未命名视频"}`}
            className="absolute right-2 top-2 bg-white/95 shadow-sm hover:bg-white" onClick={() => void toggleLock(work)}><LockKeyhole /></Button>
        </div>)}</div>
      </div>}
  </div>
}

function PlatformsPage({ selected, onChange }: { selected: string[]; onChange: (platforms: string[]) => void }) {
  const { setOperationError } = useApp()
  return <div className="flex h-full min-h-0 flex-col">
    <SectionHead title="平台" subtitle={`已选择 ${selected.length} 个平台`} />
    <div className="tool-scroll min-h-0 flex-1 px-5 py-4" tabIndex={0}>
      <div className="max-w-3xl divide-y divide-border border-y border-border bg-white">{Object.entries(CREATOR_PAGES).map(([id, page]) => {
        const checked = selected.includes(id)
        return <div key={id} className="flex min-h-14 items-center gap-3 px-3 py-2">
          <Checkbox id={`platform-${id}`} checked={checked} onCheckedChange={value => onChange(value === true ? [...selected, id] : selected.filter(item => item !== id))} />
          <label htmlFor={`platform-${id}`} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"><PlatformMark platform={id} />
            <span className="min-w-0"><span className="block text-sm font-medium">{platformLabel(id)}</span>
              <span className="block text-xs text-muted-foreground">{id === "douyin" ? "扩展自动填写，确认后计入已发布" : `${page.label} · 发布后手动确认`}</span></span></label>
          <Button size="sm" variant="outline" onClick={() => void openUrl(page.url).catch(error => setOperationError(`无法打开${platformLabel(id)}${page.label}：${String(error)}`))}>
            <ExternalLink />打开{page.label}</Button>
        </div>
      })}</div>
    </div>
  </div>
}

function TasksPage({ focusedTaskId }: { focusedTaskId: string }) {
  const { tasks, verifyPublished, cancelTask, setOperationError } = useApp()
  const [selectedId, setSelectedId] = useState(focusedTaskId)
  const [filter, setFilter] = useState("all")
  const visible = tasks.filter(task => filter === "all" || task.status === filter)
  const selected = tasks.find(task => task.id === selectedId) || visible[0]
  const confirm = async (task: TaskRecord) => {
    try { await verifyPublished(task.id) } catch (error) { setOperationError(String(error)) }
  }
  return <div className="flex h-full min-h-0 flex-col">
    <SectionHead title="任务" subtitle={`${tasks.length} 条本机记录`} right={<Select value={filter} onValueChange={setFilter}><SelectTrigger className="w-36 bg-white" size="sm"><SelectValue /></SelectTrigger><SelectContent>
      <SelectItem value="all">全部状态</SelectItem><SelectItem value="queued">等待扩展</SelectItem><SelectItem value="running">填写中</SelectItem><SelectItem value="prepared">待平台发布</SelectItem><SelectItem value="success">已发布</SelectItem><SelectItem value="failed">失败</SelectItem><SelectItem value="interrupted">需核对</SelectItem>
    </SelectContent></Select>} />
    {!tasks.length ? <Empty icon={History} title="暂无发布任务" /> : <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,38%)_1fr]">
      <div className="tool-scroll min-h-0 border-r border-border bg-white" tabIndex={0}>{visible.map(task => <button type="button" key={task.id} onClick={() => setSelectedId(task.id)}
        className={`flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left hover:bg-accent ${selected?.id === task.id ? "bg-accent" : ""}`}><PlatformMark platform={task.platform} />
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{platformLabel(task.platform)} · {task.workTitle || task.action}</span><span className="text-xs text-muted-foreground">{new Date(task.startedAt).toLocaleString()}</span></span><StatusTag status={task.status} /></button>)}</div>
      {selected && <div className="flex min-h-0 flex-col"><div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0"><p className="truncate font-medium">{platformLabel(selected.platform)} · {selected.workTitle || selected.action}</p><p className="text-xs text-muted-foreground">{selected.message || "等待状态"}</p></div>
        <div className="flex shrink-0 gap-2">{!!UPLOAD_PAGES[selected.platform] && ["prepared", "running", "failed", "interrupted"].includes(selected.status) && <Button size="sm" onClick={() => void confirm(selected)}><Check />检验已发布</Button>}
          {["queued", "running", "interrupted"].includes(selected.status) && <Button size="sm" variant="outline" onClick={() => void cancelTask(selected.id).catch(error => setOperationError(String(error)))}><X />停止传输</Button>}
          <Button size="icon-sm" variant="outline" title={`打开${platformLabel(selected.platform)}后台`} onClick={() => void openUrl(CREATOR_PAGES[selected.platform].url)}><ExternalLink /></Button></div>
      </div><pre className="tool-scroll min-h-0 flex-1 whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5" tabIndex={0}>{selected.lines.join("\n") || "暂无日志"}</pre></div>}
    </div>}
  </div>
}

function ExtensionPage() {
  const { bridge, reload, setOperationError } = useApp()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    if (!bridge) return
    try { await navigator.clipboard.writeText(bridge.extensionPath); setCopied(true); window.setTimeout(() => setCopied(false), 2000) }
    catch (error) { setOperationError(`无法复制扩展目录：${String(error)}`) }
  }
  const pair = () => {
    if (bridge) void openUrl(bridge.pairUrl).catch(error => setOperationError(`无法打开扩展连接页：${String(error)}`))
  }
  return <div className="flex h-full min-h-0 flex-col"><SectionHead title="浏览器扩展" subtitle="适配 Chrome / Edge 中的抖音、百家号和大鱼号" />
    <div className="tool-scroll min-h-0 flex-1 px-5 py-5" tabIndex={0}><div className="max-w-2xl space-y-5">
      <section className="space-y-3"><h2 className="text-sm font-semibold">安装扩展</h2>
        <ol className="list-inside list-decimal space-y-2 text-sm text-foreground"><li>在默认浏览器地址栏打开 <code className="rounded bg-muted px-1">chrome://extensions</code>（Edge 用 <code className="rounded bg-muted px-1">edge://extensions</code>）。</li>
          <li>开启开发者模式，点击“加载已解压的扩展程序”。</li><li>选择下方目录，并在安装后点一次“连接扩展”。</li></ol>
        <div className="flex items-center gap-2 rounded-md border border-border bg-white p-2"><code className="min-w-0 flex-1 break-all text-xs">{bridge?.extensionPath || "正在准备扩展目录"}</code>
          <Button size="sm" variant="outline" disabled={!bridge} onClick={() => void copy()}><Copy />{copied ? "已复制" : "复制路径"}</Button></div>
        <Button size="sm" disabled={!bridge} onClick={pair}><Puzzle />连接扩展</Button>
      </section>
      <section className="space-y-2 border-t border-border pt-4"><h2 className="text-sm font-semibold">浏览器会话</h2>
        <p className="text-sm text-muted-foreground">登录只发生在你自己的默认浏览器。软件和扩展不保存 Cookie 或密码。扩展连接一次后，在对应平台页面点击扩展图标，可选择作品补齐剩余资料。</p>
        <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void openUrl(UPLOAD_PAGES.douyin).catch(error => setOperationError(String(error)))}><ExternalLink />打开抖音发布页</Button>
          <Button size="sm" variant="outline" onClick={() => void openUrl(UPLOAD_PAGES.baijiahao).catch(error => setOperationError(String(error)))}><ExternalLink />打开百家号</Button>
          <Button size="sm" variant="outline" onClick={() => void openUrl(UPLOAD_PAGES.dayu).catch(error => setOperationError(String(error)))}><ExternalLink />打开大鱼号</Button>
          <Button size="sm" variant="ghost" onClick={() => void reload()}><RefreshCw />刷新连接</Button></div>
      </section>
    </div></div>
  </div>
}

function SettingsDialog({ open: isOpen, onOpenChange, openFaults }: { open: boolean; onOpenChange: (value: boolean) => void; openFaults: () => void }) {
  const { bridge, reload, storageError } = useApp()
  return <Dialog open={isOpen} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>设置</DialogTitle><DialogDescription>浏览器桥接只监听本机回环地址。</DialogDescription></DialogHeader>
    <div className="space-y-3"><div className="rounded-md border border-border bg-muted p-3 text-xs"><p className="font-medium">{bridge ? "本机桥接已就绪" : "本机桥接不可用"}</p>
      {bridge && <p className="mt-1 text-muted-foreground">127.0.0.1:{bridge.port}</p>}</div>{storageError && <p className="text-xs text-destructive">{storageError}</p>}
      <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); openFaults() }}><CircleAlert />软件故障日志</Button></div>
    <DialogFooter><Button variant="outline" onClick={() => void reload()}><RefreshCw />重新检测</Button><Button onClick={() => onOpenChange(false)}>完成</Button></DialogFooter>
  </DialogContent></Dialog>
}

function AboutDialog({ open: isOpen, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  return <Dialog open={isOpen} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>关于作者</DialogTitle><DialogDescription>视频发布台</DialogDescription></DialogHeader>
    <div className="flex items-center gap-4"><img src={authorAvatar} className="size-16 rounded-md object-cover" alt="Hoshimi星尘头像" /><div><p className="font-semibold">Hoshimi星尘</p><p className="text-xs text-muted-foreground">B站 UID 10075923</p></div></div>
    <p className="text-xs leading-5 text-muted-foreground">当前通过浏览器扩展适配抖音发布页。发布操作由你在平台页面完成。</p>
    <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void openUrl("https://space.bilibili.com/10075923")}>打开 B站主页</Button><Button variant="outline" size="sm" onClick={() => void openUrl("https://github.com/ytton/video-poster")}>项目 GitHub</Button></div>
  </DialogContent></Dialog>
}

function savedPlatforms(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem("selected-publish-platforms") || '["douyin"]')
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && id in CREATOR_PAGES))] : ["douyin"]
  } catch { return ["douyin"] }
}

function Shell() {
  const { bridge, loading, tasks, works, activeWorkId, activateWork, updateWorkPlatforms, operationError, setOperationError, storageError } = useApp()
  const [page, setPage] = useState<Page>("works")
  const [reuseWorkId, setReuseWorkId] = useState("")
  const [editorKey, setEditorKey] = useState("new")
  const [selectedPlatforms, setSelectedPlatforms] = useState(savedPlatforms)
  const [platformsForEditor, setPlatformsForEditor] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [faultOpen, setFaultOpen] = useState(false)
  const faults = useSyncExternalStore(subscribeFaults, getFaults)
  useEffect(() => { if (faults.length) setFaultOpen(true) }, [faults.length])
  const changePlatforms = (platforms: string[]) => {
    localStorage.setItem("selected-publish-platforms", JSON.stringify(platforms))
    setSelectedPlatforms(platforms)
    const targetId = platformsForEditor ? reuseWorkId : activeWorkId
    const target = works.find(work => work.id === targetId)
    if (target) void updateWorkPlatforms(target.id, platforms)
      .then(work => targetId === activeWorkId ? activateWork(work, platforms.includes("douyin")) : undefined)
      .catch(error => setOperationError(`无法更新当前发布项目：${String(error)}`))
  }
  const pending = tasks.filter(task => task.status === "running" || task.status === "queued").length
  return <TooltipProvider><div className="flex h-full flex-col"><TitleBar onSettings={() => setSettingsOpen(true)} />
    <div className="flex min-h-0 flex-1"><aside className="flex w-48 shrink-0 flex-col border-r border-border bg-[#eef2f3] p-2">
      <nav className="space-y-1">{mainPages.map(item => <button key={item.id} type="button" onClick={() => {
        if (item.id === "publish" && page !== "platforms") { setReuseWorkId(""); setEditorKey("new"); setSelectedPlatforms(savedPlatforms()) }
        if (item.id === "platforms" && page !== "platforms") {
          setPlatformsForEditor(page === "publish")
          if (page !== "publish") {
            setReuseWorkId("")
            setSelectedPlatforms(works.find(work => work.id === activeWorkId)?.content.platforms || savedPlatforms())
          }
        }
        setPage(item.id)
      }}
        className={`flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-sm ${page === item.id ? "bg-white font-semibold text-primary shadow-sm" : "text-foreground hover:bg-white/70"}`}><item.icon className="size-4" />
        {item.id === "publish" && reuseWorkId && (page === "publish" || page === "platforms" && platformsForEditor) ? "编辑作品" : item.label}
        {item.id === "tasks" && pending > 0 && <span className="ml-auto rounded bg-primary px-1.5 text-[10px] text-white">{pending}</span>}</button>)}</nav>
      <div className="mt-auto space-y-2 px-2 pb-2"><div className="rounded-md border border-border bg-white p-2"><div className="flex items-center gap-2 text-xs font-medium">
        <span className={`size-1.5 rounded-full ${bridge ? "bg-emerald-600" : "bg-amber-600"}`} />{loading ? "连接中" : bridge ? "浏览器桥接就绪" : "桥接不可用"}</div>
        <p className="mt-1 text-xs text-muted-foreground">3 个平台适配 · {pending} 项进行中</p></div><button onClick={() => setAboutOpen(true)} className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs text-muted-foreground hover:bg-white"><CircleHelp className="size-4" />关于作者</button></div>
    </aside><main className="min-w-0 flex-1">
      {(page === "publish" || page === "platforms") && <div className={page === "publish" ? "h-full" : "hidden"}>
        <PublishPage key={editorKey} initialWork={works.find(work => work.id === reuseWorkId)} selectedPlatforms={selectedPlatforms}
          openPlatforms={() => { setPlatformsForEditor(true); setPage("platforms") }} onPublished={id => setReuseWorkId(id)} /></div>}
      {page === "works" ? <WorksPage selectedPlatforms={selectedPlatforms} onNew={() => { setReuseWorkId(""); setEditorKey("new"); setSelectedPlatforms(savedPlatforms()); setPage("publish") }}
        onReuse={id => { setReuseWorkId(id); setEditorKey(id); setSelectedPlatforms(works.find(work => work.id === id)?.content.platforms || savedPlatforms()); setPage("publish") }} />
        : page === "platforms" ? <PlatformsPage selected={selectedPlatforms} onChange={changePlatforms} />
        : page === "tasks" ? <TasksPage focusedTaskId="" /> : page === "extension" ? <ExtensionPage /> : null}</main></div>
    {(operationError || storageError) && <div className="flex shrink-0 items-center gap-2 border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-destructive"><CircleAlert className="size-4" /><span className="min-w-0 flex-1 truncate">{operationError || storageError}</span><button title="关闭提示" onClick={() => setOperationError("")}><X className="size-4" /></button></div>}
    <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} openFaults={() => setFaultOpen(true)} /><AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} /><FaultDialog open={faultOpen} onOpenChange={setFaultOpen} />
  </div></TooltipProvider>
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, _info: ErrorInfo) { reportFault("frontend", error) }
  render() {
    if (this.state.failed) return <div className="flex h-full flex-col items-center justify-center gap-3 text-sm"><CircleAlert className="size-8 text-destructive" /><p>界面发生故障</p><Button onClick={() => this.setState({ failed: false })}>重试界面</Button></div>
    return this.props.children
  }
}

export default function App() { return <AppProvider><ErrorBoundary><Shell /></ErrorBoundary></AppProvider> }
