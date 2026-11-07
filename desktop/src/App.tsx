import { Component, useEffect, useMemo, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from "react"
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { open } from "@tauri-apps/plugin-dialog"
import { convertFileSrc } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { ArrowRight, Check, ChevronDown, CircleAlert, CircleHelp, Clapperboard, ExternalLink, FolderOpen, History, Link2, Plus, RefreshCw, Send, Terminal, Trash2, Upload, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppProvider, useApp } from "./state"
import { inDesktop, prepareCoverPreview, prepareVideoPreview } from "./cli"
import { CREATOR_PAGES, fieldLabel, platformLabel, PLATFORM_COLORS } from "./platforms"
import { buildArgs, findAction } from "./args"
import { preferredCover, publishValues, SHARED_OPTIONS, type ContentMark, type Origin, type PublishOverrides } from "./publish"
import { CommandFields } from "./components/CommandFields"
import { VideoDropzone } from "./components/VideoDropzone"
import { CoverDropzone } from "./components/CoverDropzone"
import { VideoFramePicker } from "./components/VideoFramePicker"
import { PublishPreview } from "./components/PublishPreview"
import { FaultDialog } from "./components/FaultDialog"
import { TitleBar } from "./components/TitleBar"
import { getFaults, reportFault, subscribeFaults } from "./faults"
import type { AccountRecord, FieldValue, FormValues, WorkRecord } from "./types"
import authorAvatar from "./assets/author.jpg"

type Page = "publish" | "works" | "accounts" | "tasks" | "tools"
const mainPages: { id: Page; label: string; icon: typeof Send }[] = [
  { id: "publish", label: "发布", icon: Send },
  { id: "works", label: "作品管理", icon: Clapperboard },
  { id: "accounts", label: "账号", icon: Users },
  { id: "tasks", label: "任务", icon: History },
  { id: "tools", label: "全部命令", icon: Terminal },
]

function PlatformMark({ platform, size = "sm" }: { platform: string; size?: "sm" | "md" }) {
  const label = platformLabel(platform)
  return <span className={`inline-grid shrink-0 place-items-center rounded-md font-semibold text-white ${size === "md" ? "size-8 text-sm" : "size-7 text-xs"}`} style={{ backgroundColor: PLATFORM_COLORS[platform] || "#5b6870" }} aria-hidden="true">{label.slice(0, 1)}</span>
}

function StatusTag({ status }: { status: string }) {
  const styles: Record<string, string> = {
    valid: "border-emerald-200 bg-emerald-50 text-emerald-800", invalid: "border-amber-200 bg-amber-50 text-amber-800",
    checking: "border-sky-200 bg-sky-50 text-sky-800", "logging-in": "border-sky-200 bg-sky-50 text-sky-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800", failed: "border-red-200 bg-red-50 text-red-800",
    running: "border-sky-200 bg-sky-50 text-sky-800", queued: "border-gray-200 bg-gray-50 text-gray-700",
    cancelled: "border-gray-200 bg-gray-50 text-gray-700", interrupted: "border-amber-200 bg-amber-50 text-amber-800",
    prepared: "border-amber-200 bg-amber-50 text-amber-800",
  }
  const labels: Record<string, string> = {
    valid: "有效", invalid: "已失效", checking: "检查中", "logging-in": "登录中", unknown: "未检查", error: "检查失败",
    success: "成功", failed: "失败", running: "运行中", queued: "排队中", cancelled: "已取消", interrupted: "需核对", prepared: "待核对",
  }
  return <Badge variant="outline" className={`font-normal ${styles[status] || "border-gray-200 text-gray-600"}`}>{labels[status] || status}</Badge>
}

function SectionHead({ title, right, subtitle }: { title: string; right?: ReactNode; subtitle?: string }) {
  return <div className="flex min-h-10 shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-3">
    <div className="min-w-0"><h1 className="text-base font-semibold">{title}</h1>{subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}</div>
    <div className="flex shrink-0 items-center gap-2">{right}</div>
  </div>
}

function WorkCover({ path, label, ratio }: { path: string; label: string; ratio: "3/4" | "4/3" }) {
  const [url, setUrl] = useState("")
  useEffect(() => {
    let active = true
    setUrl("")
    if (path && inDesktop) void prepareCoverPreview(path).then(prepared => {
      if (active) setUrl(convertFileSrc(prepared))
    }).catch(() => {})
    return () => { active = false }
  }, [path])
  return <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><div style={{ aspectRatio: ratio }} className="mt-1 grid h-28 place-items-center overflow-hidden rounded border border-border bg-muted text-xs text-muted-foreground">
    {url ? <img src={url} alt={`${label}封面`} className="h-full w-full object-cover" /> : path ? "图片不可用" : "未设置"}
  </div></div>
}

function Empty({ icon: Icon, title, detail }: { icon: typeof Users; title: string; detail?: string }) {
  return <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
    <Icon className="size-7 opacity-50" strokeWidth={1.5} /><p className="font-medium text-foreground">{title}</p>{detail && <p className="text-xs">{detail}</p>}
  </div>
}

function AccountDialog({ open: isOpen, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  const { schema, addAccount, loginAccount, setOperationError } = useApp()
  const available = schema.filter(node => node.actions.some(action => action.name === "login"))
  const [platform, setPlatform] = useState("douyin")
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const submit = async () => {
    setError("")
    try {
      const account = await addAccount(platform, name)
      onOpenChange(false)
      setName("")
      await loginAccount(account)
    } catch (problem) {
      setError(String(problem))
      setOperationError(String(problem))
    }
  }
  return <Dialog open={isOpen} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle>绑定账号</DialogTitle><DialogDescription>选择平台并设置本地别名，然后在打开的浏览器中完成登录。</DialogDescription></DialogHeader>
    <div className="space-y-3">
      <label className="block text-xs font-medium">平台
        <Select value={platform} onValueChange={setPlatform}><SelectTrigger className="mt-1.5 w-full"><SelectValue /></SelectTrigger><SelectContent>{available.map(node => <SelectItem key={node.name} value={node.name}>{platformLabel(node.name)}</SelectItem>)}</SelectContent></Select>
      </label>
      <label className="block text-xs font-medium">账号别名
        <Input autoFocus className="mt-1.5" value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void submit() }} placeholder="例如：主账号" />
      </label>
      {platform === "bilibili" && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">B站登录会打开独立终端显示二维码，请保持终端窗口直到登录结束。</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button onClick={() => void submit()}><Link2 />开始绑定</Button></DialogFooter>
  </DialogContent></Dialog>
}

function SortableAccountRow({ account, status, canCheck, onUnbind }: { account: AccountRecord; status: string; canCheck: boolean; onUnbind: (account: AccountRecord) => void }) {
  const { checkAccount, loginAccount, setOperationError } = useApp()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: account.id })
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
    className={`relative flex min-h-16 items-center gap-3 px-3 py-2 ${isDragging ? "z-10 bg-accent shadow-sm" : "bg-white"}`}>
    <div ref={setActivatorNodeRef} {...attributes} {...listeners} title="拖动调整账号顺序"
      className="flex min-w-0 flex-1 cursor-grab touch-none items-center gap-3 rounded-sm active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <PlatformMark platform={account.platform} size="md" />
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-medium">{account.name}</span><StatusTag status={status} /></div><p className="text-xs text-muted-foreground">{platformLabel(account.platform)}</p></div>
    </div>
    <Button size="sm" variant="outline" disabled={!canCheck} onClick={() => checkAccount(account)}><RefreshCw />检查</Button>
    <Button size="sm" variant="outline" onClick={() => void loginAccount(account).catch(error => setOperationError(String(error)))}><Link2 />重新登录</Button>
    {CREATOR_PAGES[account.platform] && <Button size="icon-sm" variant="ghost" title={`打开${platformLabel(account.platform)}${CREATOR_PAGES[account.platform].label}`} aria-label={`打开${platformLabel(account.platform)}${CREATOR_PAGES[account.platform].label}`}
      onClick={() => void openUrl(CREATOR_PAGES[account.platform].url).catch(error => setOperationError(String(error)))}><ExternalLink /></Button>}
    <Button size="icon-sm" variant="ghost" title="解除绑定" onClick={() => onUnbind(account)}><Trash2 /></Button>
  </div>
}

function AccountsPage() {
  const { accounts, statuses, schema, runtime, checkAll, unbindAccount, reorderAccounts, setOperationError } = useApp()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [search, setSearch] = useState("")
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const filtered = accounts.filter(account => `${platformLabel(account.platform)} ${account.name}`.toLowerCase().includes(search.toLowerCase()))
  const moveAccount = (sourceId: string, targetId: string) => {
    void reorderAccounts(sourceId, targetId).catch(error => setOperationError(`调整账号顺序失败：${String(error)}`))
  }
  const confirmUnbind = async (account: AccountRecord) => {
    if (!window.confirm(`解除 ${platformLabel(account.platform)} · ${account.name} 的本地绑定？这会删除保存的登录会话。`)) return
    try { await unbindAccount(account) } catch (error) { setOperationError(String(error)) }
  }
  return <div className="flex h-full min-h-0 flex-col">
    <SectionHead title="账号" subtitle={`${accounts.length} 个本地账号`} right={<>
      <Button variant="outline" size="sm" disabled={!accounts.length} onClick={checkAll}><RefreshCw />检查全部</Button>
      <Button size="sm" disabled={!runtime?.ready} onClick={() => setDialogOpen(true)}><Plus />绑定账号</Button>
    </>} />
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3"><Input className="max-w-xs bg-white" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索平台或账号" /></div>
    <div className="tool-scroll min-h-0 flex-1 px-5 py-3" tabIndex={0}>
      {!filtered.length ? <Empty icon={Users} title={accounts.length ? "没有匹配的账号" : "还没有绑定账号"} detail={accounts.length ? undefined : "点击右上角开始绑定"} />
        : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active, over }: DragEndEvent) => {
          if (over && active.id !== over.id) moveAccount(String(active.id), String(over.id))
        }}>
          <SortableContext items={filtered.map(account => account.id)} strategy={verticalListSortingStrategy}>
            <div className="divide-y divide-border border-y border-border bg-white">{filtered.map(account => <SortableAccountRow key={account.id} account={account}
              status={statuses[account.id] || "unknown"} canCheck={!!findAction(schema, account.platform, "check")} onUnbind={account => { void confirmUnbind(account) }} />)}</div>
          </SortableContext>
        </DndContext>}
    </div>
    <AccountDialog open={dialogOpen} onOpenChange={setDialogOpen} />
  </div>
}

function PublishPage({ openTasks, initialWork }: { openTasks: () => void; initialWork?: WorkRecord }) {
  const { accounts, schema, statuses, runtime, enqueue, prepareWork, setOperationError } = useApp()
  const publishedPlatforms = new Set(initialWork?.publications.map(item => item.platform) || [])
  const publishable = accounts.filter(account => !!findAction(schema, account.platform, "upload-video") && !publishedPlatforms.has(account.platform))
  const [selected, setSelected] = useState<string[]>([])
  const [file, setFile] = useState("")
  const [title, setTitle] = useState(initialWork?.content.title || "")
  const [description, setDescription] = useState(initialWork?.content.description || "")
  const [tags, setTags] = useState(initialWork?.content.tags || "")
  const [thumbnailLandscape, setThumbnailLandscape] = useState("")
  const [thumbnailPortrait, setThumbnailPortrait] = useState("")
  const [videoLandscape, setVideoLandscape] = useState(false)
  const [framePickerOpen, setFramePickerOpen] = useState(false)
  const [framePickerOrientation, setFramePickerOrientation] = useState<"portrait" | "landscape">("portrait")
  const [origin, setOrigin] = useState<Origin>(initialWork?.content.origin === "reprint" || initialWork?.content.origin === "转载" ? "reprint" : "original")
  const [mark, setMark] = useState<ContentMark>(["none", "ai", "fiction", "marketing", "opinion", "minors"].includes(initialWork?.content.mark || "") ? initialWork!.content.mark as ContentMark : "none")
  const [schedule, setSchedule] = useState("")
  const [prepareOnly, setPrepareOnly] = useState(false)
  const [extras, setExtras] = useState<Record<string, FormValues>>({})
  const [overrides, setOverrides] = useState<Record<string, PublishOverrides>>({})
  const [expandedExtras, setExpandedExtras] = useState<string[]>([])
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)
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
      if (!initialWork) {
        setThumbnailLandscape("")
        setThumbnailPortrait("")
      }
      setVideoLandscape(false)
      setFramePickerOpen(false)
    }
    setFile(path)
  }
  const openFramePicker = (orientation: "portrait" | "landscape") => {
    setFramePickerOrientation(orientation)
    setFramePickerOpen(true)
  }
  const selectedAccounts = publishable.filter(account => selected.includes(account.id))
  const previewPlatforms = [...new Set((selectedAccounts.length ? selectedAccounts : publishable).map(account => account.platform))]
  const thumbnail = preferredCover(thumbnailLandscape, thumbnailPortrait, videoLandscape)
  const coverRequired = selectedAccounts.some(account => account.platform === "weibo" || findAction(schema, account.platform, "upload-video")?.options.some(option => option.name === "thumbnail" && option.required))
  const unsupportedCover = thumbnail ? selectedAccounts.filter(account => !findAction(schema, account.platform, "upload-video")?.options.some(option => option.name === "thumbnail")) : []
  const unsupportedPrepare = prepareOnly ? selectedAccounts.filter(account => {
    const options = findAction(schema, account.platform, "upload-video")?.options || []
    return !options.some(option => option.name === "prepare_only" || option.name === "draft")
  }) : []
  const unsupportedOrigin = selectedAccounts.filter(account => (overrides[account.id]?.origin ?? origin) === "reprint" && !["douyin", "dayu", "zhihu", "weibo"].includes(account.platform))
  const unsupportedMark = selectedAccounts.filter(account => {
    const selectedMark = overrides[account.id]?.mark ?? mark
    return selectedMark !== "" && selectedMark !== "none" && !(account.platform === "dayu" || account.platform === "zhihu" || account.platform === "douyin" && ["ai", "opinion"].includes(selectedMark) || account.platform === "weibo" && selectedMark === "ai")
  })
  const unsupportedTags = tags ? selectedAccounts.filter(account => !findAction(schema, account.platform, "upload-video")?.options.some(option => option.name === "tags")) : []
  const submit = async () => {
    setFormError("")
    if (!file.trim() || !title.trim() || selectedAccounts.length === 0) {
      setFormError("请选择视频、填写标题并勾选至少一个账号")
      return
    }
    if (coverRequired && !thumbnail.trim()) {
      setFormError("已选平台需要封面图片，请先选择封面")
      return
    }
    if (unsupportedPrepare.length > 0) {
      setFormError(`${unsupportedPrepare.map(account => platformLabel(account.platform)).join("、")} 没有可停在发布前的网页流程，本次未加入队列。`)
      return
    }
    setSubmitting(true)
    try {
      const commands = selectedAccounts.map(account => {
        const node = findAction(schema, account.platform, "upload-video")!
        try {
          const values = publishValues(account.platform, node, {
            account: account.name, file, title, desc: description, tags, thumbnail,
            thumbnailLandscape, thumbnailPortrait, schedule, prepareOnly, origin, mark,
          }, extras[account.id] || {}, overrides[account.id])
          return { account, args: buildArgs(account.platform, node, values), values }
        }
        catch (error) { throw new Error(`${platformLabel(account.platform)}：${String(error)}`) }
      })
      const work = await prepareWork(file, {
        title, description, tags, thumbnailLandscape, thumbnailPortrait, origin, mark, schedule,
      }, initialWork?.sha256)
      commands.forEach(({ account, args, values }) => enqueue(account.platform, "upload-video", args, account.name, { id: work.id, values }))
      openTasks()
    } catch (error) {
      setFormError(String(error))
      setOperationError(String(error))
    } finally {
      setSubmitting(false)
    }
  }
  return <div className="flex h-full min-h-0 flex-col">
    <SectionHead title={initialWork ? "补发作品" : "发布视频"} subtitle={initialWork ? `作品 SHA-256：${initialWork.sha256.slice(0, 12)}…` : "选择视频和账号，逐个平台提交"} right={<Button size="sm" onClick={() => void submit()} disabled={!runtime?.ready || !publishable.length || submitting}><Upload />{submitting ? "正在识别视频" : prepareOnly ? "加入准备队列" : "加入发布队列"}</Button>} />
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(270px,320px)]">
    <div className="tool-scroll min-h-0 px-5 py-4" tabIndex={0}>
      <div className="space-y-5">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">视频与文案</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-1.5 lg:col-span-2"><span className="text-xs font-medium">视频文件 <span className="text-destructive">*</span></span><VideoDropzone value={file} onChange={changeVideo} onError={setFormError} /></div>
            <label className="flex flex-col gap-1.5 lg:col-span-2"><span className="text-xs font-medium">标题 <span className="text-destructive">*</span></span><Input className="bg-white" value={title} onChange={event => setTitle(event.target.value)} placeholder="视频标题" /></label>
            <label className="flex flex-col gap-1.5 lg:col-span-2"><span className="text-xs font-medium">简介</span><Textarea className="min-h-20 bg-white" value={description} onChange={event => setDescription(event.target.value)} placeholder="视频简介" /></label>
            <label className="flex flex-col gap-1.5 lg:col-span-2"><span className="text-xs font-medium">话题标签</span><Input className="bg-white" value={tags} onChange={event => setTags(event.target.value)} placeholder="用中文或英文逗号分隔" /></label>
          </div>
        </section>
        <section className="space-y-3 border-t border-border pt-4">
          <h2 className="text-sm font-semibold">发布设置</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2 lg:col-span-2">
              <span className="text-xs font-medium">封面图片{coverRequired && <span className="text-destructive"> *</span>}</span>
              <div className="flex min-w-0 items-start gap-3">
                <CoverDropzone label="竖版" ratio="3:4" videoPath={file} value={thumbnailPortrait} onChange={setThumbnailPortrait} onOpenPicker={() => openFramePicker("portrait")} onError={setFormError} />
                <CoverDropzone label="横版" ratio="4:3" videoPath={file} value={thumbnailLandscape} onChange={setThumbnailLandscape} onOpenPicker={() => openFramePicker("landscape")} onError={setFormError} />
              </div>
            </div>
            <label className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-medium">版权归属{selectedAccounts.some(account => account.platform === "zhihu") && <span className="text-destructive"> *</span>}</span>
              <Select value={origin || "unset"} onValueChange={value => setOrigin(value === "unset" ? "" : value as Origin)}><SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unset">未设置</SelectItem><SelectItem value="original">原创</SelectItem><SelectItem value="reprint">转载</SelectItem></SelectContent></Select>
            </label>
            <label className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-medium">内容标记{selectedAccounts.some(account => ["dayu", "zhihu"].includes(account.platform)) && origin !== "reprint" && <span className="text-destructive"> *</span>}</span>
              <Select value={mark || "unset"} onValueChange={value => setMark(value === "unset" ? "" : value as ContentMark)}><SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unset">未设置</SelectItem><SelectItem value="none">无需标注</SelectItem><SelectItem value="ai">AI 生成</SelectItem><SelectItem value="fiction">虚构演绎</SelectItem><SelectItem value="marketing">营销信息</SelectItem><SelectItem value="opinion">个人观点</SelectItem><SelectItem value="minors">不适宜未成年人</SelectItem></SelectContent></Select>
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 lg:col-span-2"><span className="text-xs font-medium">定时发布</span><Input className="bg-white" type="datetime-local" value={schedule} onChange={event => setSchedule(event.target.value)} /></label>
            <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-white px-3 py-2 lg:col-span-2"><span className="min-w-0"><span className="block text-xs font-medium">只上传到平台，不点发布</span><span className="block text-xs text-muted-foreground">网页平台填好后停在发布前；视频号保存草稿；B站暂不支持</span></span><Switch checked={prepareOnly} onCheckedChange={setPrepareOnly} aria-label="只上传到平台，不点发布" /></label>
          </div>
        </section>
        <section className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">发布账号 <span className="font-normal text-muted-foreground">({selectedAccounts.length})</span></h2>{publishable.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected(selected.length === publishable.length ? [] : publishable.map(account => account.id))}>{selected.length === publishable.length ? "清空" : "全选"}</Button>}</div>
          {!publishable.length ? <div className="rounded-md border border-dashed border-border bg-white p-6"><Empty icon={Users} title="还没有可发布的账号" detail="先到账号页绑定平台账号" /></div> :
          <div className="divide-y divide-border border-y border-border bg-white">{publishable.map(account => {
            const checked = selected.includes(account.id)
            const node = findAction(schema, account.platform, "upload-video")!
            const options = node.options.filter(option => !SHARED_OPTIONS.has(option.name) && option.name !== "show_options")
            const accountOverride = overrides[account.id] || {}
            const sourceUrlRequired = account.platform === "dayu" && (accountOverride.origin ?? origin) === "reprint"
            const categoryRequired = account.platform === "zhihu"
            const extraRequired = (name: string) => sourceUrlRequired && name === "source_url" || categoryRequired && name === "category"
            const requiredOptions = options.filter(option => option.required || extraRequired(option.name))
              .map(option => extraRequired(option.name) ? { ...option, required: true } : option)
            const optionalOptions = options.filter(option => !option.required && !extraRequired(option.name))
            const expanded = expandedExtras.includes(account.id)
            const declarationOverride = ["douyin", "dayu", "zhihu"].includes(account.platform)
            const updateOverride = (patch: PublishOverrides) => setOverrides(previous => ({ ...previous, [account.id]: { ...previous[account.id], ...patch } }))
            return <div key={account.id} className="px-3 py-2">
              <label className="flex min-h-9 items-center gap-3"><Checkbox checked={checked} onCheckedChange={value => setSelected(previous => value ? [...previous, account.id] : previous.filter(id => id !== account.id))} /><PlatformMark platform={account.platform} /><span className="min-w-0 flex-1 truncate font-medium">{platformLabel(account.platform)} · {account.name}</span><StatusTag status={statuses[account.id] || "unknown"} /></label>
              {checked && (options.length > 0 || declarationOverride || account.platform === "weibo") && <div className="ml-10 space-y-2 border-l border-border py-2 pl-4">
                {requiredOptions.length > 0 && <CommandFields options={requiredOptions} values={extras[account.id] || {}} onChange={(name, value) => setExtras(previous => ({ ...previous, [account.id]: { ...previous[account.id], [name]: value } }))} />}
                {account.platform === "weibo" && <label className="flex items-center gap-2 text-xs text-foreground"><Checkbox checked={accountOverride.confirmWeibo === true} onCheckedChange={value => updateOverride({ confirmWeibo: value === true })} />确认此视频符合微博当前固定的“二创 / 含 AI 生成内容”声明</label>}
                {(optionalOptions.length > 0 || declarationOverride) && <><Button type="button" variant="ghost" size="sm" className="text-muted-foreground" aria-expanded={expanded}
                  onClick={() => setExpandedExtras(previous => expanded ? previous.filter(id => id !== account.id) : [...previous, account.id])}>
                  <ChevronDown className={`transition-transform ${expanded ? "rotate-180" : ""}`} />平台专属设置
                </Button>
                  {expanded && <div className="space-y-3">
                    {declarationOverride && <div className="grid gap-3 lg:grid-cols-2">
                      <label className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-medium">版权归属覆盖</span><Select value={accountOverride.origin === undefined ? "inherit" : accountOverride.origin || "unset"} onValueChange={value => updateOverride({ origin: value === "inherit" ? undefined : value === "unset" ? "" : value as Origin })}><SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">跟随通用设置</SelectItem><SelectItem value="unset">不设置</SelectItem><SelectItem value="original">原创</SelectItem><SelectItem value="reprint">转载</SelectItem></SelectContent></Select></label>
                      <label className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-medium">内容标记覆盖</span><Select value={accountOverride.mark === undefined ? "inherit" : accountOverride.mark || "unset"} onValueChange={value => updateOverride({ mark: value === "inherit" ? undefined : value === "unset" ? "" : value as ContentMark })}><SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">跟随通用设置</SelectItem><SelectItem value="unset">不设置</SelectItem><SelectItem value="none">无需标注</SelectItem><SelectItem value="ai">AI 生成</SelectItem><SelectItem value="fiction">虚构演绎</SelectItem><SelectItem value="marketing">营销信息</SelectItem><SelectItem value="opinion">个人观点</SelectItem><SelectItem value="minors">不适宜未成年人</SelectItem></SelectContent></Select></label>
                    </div>}
                    {optionalOptions.length > 0 && <CommandFields options={optionalOptions} values={extras[account.id] || {}} onChange={(name, value) => setExtras(previous => ({ ...previous, [account.id]: { ...previous[account.id], [name]: value } }))} />}
                  </div>}</>}
              </div>}
            </div>
          })}</div>}
        </section>
        {schedule && selectedAccounts.some(account => !findAction(schema, account.platform, "upload-video")?.options.some(option => option.name === "schedule")) && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">部分已选平台没有定时参数，将立即发布。</p>}
        {unsupportedCover && unsupportedCover.length > 0 && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{unsupportedCover.map(account => platformLabel(account.platform)).join("、")} 当前 CLI 不支持自定义封面。</p>}
        {unsupportedTags && unsupportedTags.length > 0 && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{unsupportedTags.map(account => platformLabel(account.platform)).join("、")} 当前 CLI 不支持话题标签。</p>}
        {unsupportedOrigin.length > 0 && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{unsupportedOrigin.map(account => platformLabel(account.platform)).join("、")} 当前 CLI 不支持所选版权归属标记。</p>}
        {unsupportedMark.length > 0 && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{unsupportedMark.map(account => platformLabel(account.platform)).join("、")} 暂无法自动填写所选内容标记；正常发布仍可用，但该声明不会随视频提交，请在平台后台核对。</p>}
        {unsupportedPrepare.length > 0 && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{unsupportedPrepare.map(account => platformLabel(account.platform)).join("、")} 没有可停在发布前的网页流程，开启时不会入队。</p>}
        {formError && <p className="rounded bg-red-50 p-2 text-xs text-destructive">{formError}</p>}
      </div>
    </div>
    <PublishPreview platforms={previewPlatforms.length ? previewPlatforms : schema.filter(node => node.actions.some(action => action.name === "upload-video")).map(node => node.name)}
      file={file} title={title} description={description} tags={tags} onVideoOrientationChange={setVideoLandscape}
      coverForPlatform={(platform, orientation) => {
        const options = findAction(schema, platform, "upload-video")?.options || []
        const has = (name: string) => options.some(option => option.name === name)
        if (has("thumbnail_landscape") && has("thumbnail_portrait")) return orientation === "landscape" ? thumbnailLandscape : thumbnailPortrait
        return has("thumbnail") ? thumbnail : null
      }}
      accountName={platform => selectedAccounts.find(account => account.platform === platform)?.name || publishable.find(account => account.platform === platform)?.name || ""} />
    </div>
    <VideoFramePicker open={framePickerOpen} onOpenChange={setFramePickerOpen} initialOrientation={framePickerOrientation} file={file} title={title}
      account={selectedAccounts[0]?.name || ""}
      onCaptured={covers => { setThumbnailPortrait(covers.portrait); setThumbnailLandscape(covers.landscape) }} onError={setFormError} />
  </div>
}

function WorksPage({ openTask, onRepublish }: { openTask: (id: string) => void; onRepublish: (id: string) => void }) {
  const { works, tasks, accounts, schema, setOperationError } = useApp()
  const [query, setQuery] = useState("")
  const [platform, setPlatform] = useState("all")
  const [selectedId, setSelectedId] = useState("")
  const platforms = [...new Set(works.flatMap(work => work.publications.map(item => item.platform)))].sort((a, b) => platformLabel(a).localeCompare(platformLabel(b)))
  const visible = works.filter(work => (platform === "all" || work.publications.some(item => item.platform === platform))
    && `${work.content.title} ${work.filePath} ${work.publications.map(item => `${platformLabel(item.platform)} ${item.accountName}`).join(" ")}`.toLowerCase().includes(query.toLowerCase()))
  const selected = visible.find(work => work.id === selectedId) || visible[0]
  const publishedPlatforms = new Set(selected?.publications.map(item => item.platform) || [])
  const canRepublish = accounts.some(account => !publishedPlatforms.has(account.platform) && !!findAction(schema, account.platform, "upload-video"))
  return <div className="flex h-full min-h-0 flex-col">
    <SectionHead title="作品管理" subtitle={`${works.length} 部视频 · 按文件 SHA-256 归档`} />
    <div className="flex shrink-0 gap-2 border-b border-border px-5 py-3">
      <Input className="min-w-0 max-w-md flex-1 bg-white" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索作品、文件或已发布平台" aria-label="搜索作品" />
      <Select value={platform} onValueChange={setPlatform}><SelectTrigger className="w-36 bg-white" aria-label="筛选已发布平台"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部平台</SelectItem>{platforms.map(item => <SelectItem key={item} value={item}>{platformLabel(item)}</SelectItem>)}</SelectContent></Select>
    </div>
    {!visible.length ? <Empty icon={Clapperboard} title={works.length ? "没有匹配的作品" : "暂无作品"} detail={works.length ? undefined : "从发布页加入视频后会在这里归档"} />
      : <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,32%)_minmax(0,1fr)]">
        <div className="tool-scroll min-h-0 border-r border-border bg-white" tabIndex={0}>{visible.map(work => {
          const count = new Set(work.publications.map(item => item.platform)).size
          return <button key={work.id} type="button" onClick={() => setSelectedId(work.id)} className={`flex min-h-20 w-full items-start gap-3 border-b border-border px-4 py-3 text-left hover:bg-accent ${selected?.id === work.id ? "bg-accent" : ""}`}>
            <Clapperboard className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium" title={work.content.title}>{work.content.title || "未命名视频"}</span><span className="mt-1 block truncate text-xs text-muted-foreground" title={work.filePath}>{work.filePath.split(/[\\/]/).pop()}</span><span className="mt-1 block text-xs text-muted-foreground">{count ? `已发布 ${count} 个平台` : "尚无成功发布"} · {new Date(work.createdAt).toLocaleDateString()}</span></span>
          </button>
        })}</div>
        {selected && <div className="tool-scroll min-h-0 px-6 py-5" tabIndex={0}>
          <div className="flex items-start justify-between gap-4 border-b border-border pb-4"><div className="min-w-0"><h2 className="break-words text-lg font-semibold">{selected.content.title || "未命名视频"}</h2><p className="mt-1 break-all text-xs text-muted-foreground">{selected.filePath}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">SHA-256 {selected.sha256}</p></div><Button size="sm" disabled={!canRepublish} onClick={() => onRepublish(selected.id)}><Upload />补发其他平台</Button></div>
          <div className="grid gap-x-5 gap-y-3 border-b border-border py-4 text-sm sm:grid-cols-2">
            <div><p className="text-xs text-muted-foreground">简介</p><p className="mt-1 whitespace-pre-wrap break-words">{selected.content.description || "未填写"}</p></div>
            <div><p className="text-xs text-muted-foreground">话题标签</p><p className="mt-1 break-words">{selected.content.tags || "未填写"}</p></div>
            <div><p className="text-xs text-muted-foreground">版权归属 / 内容标记</p><p className="mt-1">{selected.content.origin === "original" ? "原创" : selected.content.origin === "reprint" ? "转载" : selected.content.origin || "未设置"} / {({ none: "无需标注", ai: "AI 生成", fiction: "虚构演绎", marketing: "营销信息", opinion: "个人观点", minors: "不适宜未成年人" } as Record<string, string>)[selected.content.mark] || selected.content.mark || "未设置"}</p>{selected.content.schedule && <p className="mt-2 text-xs text-muted-foreground">原定时：{selected.content.schedule.replace("T", " ")}</p>}</div>
            <div className="flex gap-3"><WorkCover path={selected.content.thumbnailPortrait} label="竖版封面" ratio="3/4" /><WorkCover path={selected.content.thumbnailLandscape} label="横版封面" ratio="4/3" /></div>
          </div>
          <div className="py-4"><h3 className="text-sm font-semibold">已成功发布的平台 ({publishedPlatforms.size})</h3>
            {!selected.publications.length ? <p className="mt-3 text-xs text-muted-foreground">暂无成功发布记录。准备完成、失败或中断的任务不会计入。</p>
              : <div className="mt-3 divide-y divide-border border-y border-border bg-white">{[...selected.publications].reverse().map(item => {
                const creator = CREATOR_PAGES[item.platform]
                return <div key={item.taskId} className="py-3"><div className="flex items-center gap-3"><PlatformMark platform={item.platform} /><div className="min-w-0 flex-1"><p className="font-medium">{platformLabel(item.platform)} · {item.accountName}</p><p className="text-xs text-muted-foreground">{new Date(item.publishedAt).toLocaleString()}</p></div><StatusTag status="success" />{tasks.some(task => task.id === item.taskId) && <Button size="sm" variant="ghost" onClick={() => openTask(item.taskId)}>任务</Button>}{creator && <Button size="icon-sm" variant="ghost" title={`打开${platformLabel(item.platform)}${creator.label}`} aria-label={`打开${platformLabel(item.platform)}${creator.label}`} onClick={() => void openUrl(creator.url).catch(error => setOperationError(String(error)))}><ExternalLink /></Button>}</div>
                  <details className="ml-10 mt-2 text-xs"><summary className="cursor-pointer text-primary">查看当次提交内容</summary><div className="mt-2 grid gap-2 sm:grid-cols-2">{Object.entries(item.values).filter(([name, value]) => !["account", "file", "prepare_only", "draft"].includes(name) && value !== "" && value !== false).map(([name, value]) => <div key={name} className="min-w-0"><span className="text-muted-foreground">{fieldLabel(name)}：</span><span className="break-all">{Array.isArray(value) ? value.join("、") : String(value)}</span></div>)}</div></details>
                </div>
              })}</div>}
          </div>
        </div>}
      </div>}
  </div>
}

function TasksPage({ focusedTaskId = "" }: { focusedTaskId?: string }) {
  const { tasks, cancelTask, setOperationError } = useApp()
  const [selectedId, setSelectedId] = useState(focusedTaskId)
  const [filter, setFilter] = useState("all")
  const visible = tasks.filter(task => filter === "all" || task.status === filter)
  const selected = tasks.find(task => task.id === selectedId) || visible[0]
  return <div className="flex h-full min-h-0 flex-col">
    <SectionHead title="任务" subtitle={`${tasks.length} 条记录`} right={<Select value={filter} onValueChange={setFilter}><SelectTrigger className="w-32 bg-white" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="running">运行中</SelectItem><SelectItem value="queued">排队中</SelectItem><SelectItem value="prepared">待核对</SelectItem><SelectItem value="success">成功</SelectItem><SelectItem value="failed">失败</SelectItem><SelectItem value="interrupted">需核对</SelectItem></SelectContent></Select>} />
    {!tasks.length ? <Empty icon={History} title="暂无发布任务" /> : <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,38%)_1fr]">
      <div className="tool-scroll min-h-0 border-r border-border bg-white" tabIndex={0}>{visible.map(task => <button type="button" key={task.id} className={`flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left hover:bg-accent ${selected?.id === task.id ? "bg-accent" : ""}`} onClick={() => setSelectedId(task.id)}>
        <PlatformMark platform={task.platform} /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{platformLabel(task.platform)} · {task.accountName || task.action}</span><span className="text-xs text-muted-foreground">{new Date(task.startedAt).toLocaleString()} · {task.action}</span></span><StatusTag status={task.status} />
      </button>)}</div>
      <div className="flex min-h-0 flex-col"><div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3"><div><p className="font-medium">{selected && `${platformLabel(selected.platform)} · ${selected.action}`}</p><p className="text-xs text-muted-foreground">{selected?.message || "任务输出"}</p></div>{selected && (selected.status === "running" || selected.status === "queued") && <Button variant="outline" size="sm" onClick={() => void cancelTask(selected.id).catch(error => setOperationError(String(error)))}><X />取消</Button>}</div>
        <pre className="tool-scroll min-h-0 flex-1 whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5" tabIndex={0}>{selected?.lines.join("\n") || "暂无输出"}</pre>
      </div>
    </div>}
  </div>
}

function ToolsPage({ openTasks }: { openTasks: () => void }) {
  const { schema, accounts, runAction, addAccount, loginAccount, setOperationError } = useApp()
  const [platform, setPlatform] = useState("douyin")
  const [action, setAction] = useState("check")
  const [values, setValues] = useState<FormValues>({})
  const [error, setError] = useState("")
  const node = schema.find(item => item.name === platform)
  const selectedAction = node?.actions.find(item => item.name === action) || node?.actions[0]
  const accountNames = accounts.filter(account => account.platform === platform).map(account => account.name)
  const pickPlatform = (name: string) => { setPlatform(name); setAction(schema.find(item => item.name === name)?.actions[0]?.name || ""); setValues({}); setError("") }
  const pickAction = (name: string) => { setAction(name); setValues({}); setError("") }
  const submit = async () => {
    if (!selectedAction) return
    try {
      if (platform === "bilibili" && selectedAction.name === "login") {
        const account = await addAccount(platform, String(values.account || ""))
        await loginAccount(account)
      } else {
        await runAction(platform, selectedAction.name, values)
      }
      openTasks(); setError("")
    }
    catch (problem) { setError(String(problem)); setOperationError(String(problem)) }
  }
  return <div className="flex h-full min-h-0 flex-col">
    <SectionHead title="全部命令" subtitle="直接使用当前安装的 CLI 功能" right={<Button size="sm" disabled={!selectedAction} onClick={() => void submit()}><ArrowRight />执行命令</Button>} />
    <div className="tool-scroll min-h-0 flex-1 px-5 py-4" tabIndex={0}><div className="mx-auto max-w-5xl space-y-4">
      <div className="grid gap-3 lg:grid-cols-2"><label className="space-y-1.5 text-xs font-medium">平台<Select value={platform} onValueChange={pickPlatform}><SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger><SelectContent>{schema.map(item => <SelectItem key={item.name} value={item.name}>{platformLabel(item.name)}</SelectItem>)}</SelectContent></Select></label>
        <label className="space-y-1.5 text-xs font-medium">操作<Select value={selectedAction?.name || ""} onValueChange={pickAction}><SelectTrigger className="w-full bg-white"><SelectValue /></SelectTrigger><SelectContent>{node?.actions.map(item => <SelectItem key={item.name} value={item.name}>{item.name}</SelectItem>)}</SelectContent></Select></label></div>
      {selectedAction && <section className="border-t border-border pt-4"><CommandFields options={selectedAction.options} values={values} onChange={(name: string, value: FieldValue) => setValues(previous => ({ ...previous, [name]: value }))} accountNames={accountNames} />
        {platform === "bilibili" && action === "login" && <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-900">B站登录会打开独立的交互式终端。</p>}</section>}
      {error && <p className="rounded bg-red-50 p-2 text-xs text-destructive">{error}</p>}
    </div></div>
  </div>
}

function SettingsDialog({ open: isOpen, onOpenChange, openFaults }: { open: boolean; onOpenChange: (value: boolean) => void; openFaults: () => void }) {
  const { runtime, repoDir, changeRepoDir, reload, storageError } = useApp()
  const [path, setPath] = useState(repoDir || runtime?.root || "")
  useEffect(() => { if (isOpen) setPath(repoDir || runtime?.root || "") }, [isOpen, repoDir, runtime?.root])
  const choose = async () => { const result = await open({ directory: true, multiple: false, title: "选择 social-auto-upload 项目目录" }); if (typeof result === "string") setPath(result) }
  return <Dialog open={isOpen} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-xl">
    <DialogHeader><DialogTitle>设置</DialogTitle><DialogDescription>选择 CLI 安装目录并查看运行状态。</DialogDescription></DialogHeader>
    <div className="space-y-4"><label className="block text-xs font-medium">项目目录<div className="mt-1.5 flex gap-2"><Input className="min-w-0 flex-1" value={path} onChange={event => setPath(event.target.value)} /><Button variant="outline" size="icon" title="浏览目录" onClick={() => void choose()}><FolderOpen /></Button></div></label>
      <div className="rounded-md border border-border bg-muted p-3 text-xs"><p className="font-medium">{runtime?.ready ? "CLI 已就绪" : "CLI 不可用"}</p><p className="mt-1 break-all text-muted-foreground">{runtime?.message}</p>{runtime?.cliPath && <p className="mt-1 break-all text-muted-foreground">{runtime.cliPath}</p>}</div>
      {storageError && <p className="rounded bg-red-50 p-2 text-xs text-destructive">{storageError}</p>}
      <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); openFaults() }}><CircleAlert />软件故障日志</Button>
    </div>
    <DialogFooter><Button variant="outline" onClick={() => { void reload() }}><RefreshCw />重新检测</Button><Button onClick={() => { changeRepoDir(path); onOpenChange(false) }}><Check />保存</Button></DialogFooter>
  </DialogContent></Dialog>
}

function AboutDialog({ open: isOpen, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  return <Dialog open={isOpen} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle>关于作者</DialogTitle><DialogDescription>视频发布台</DialogDescription></DialogHeader>
    <div className="flex items-center gap-4"><img src={authorAvatar} className="size-16 rounded-md object-cover" alt="Hoshimi星尘头像" /><div><p className="font-semibold">Hoshimi星尘</p><p className="text-xs text-muted-foreground">B站 UID 10075923</p></div></div>
    <p className="text-xs leading-5 text-muted-foreground">底层发布能力来自开源项目 social-auto-upload。本应用在本机调用已安装的 CLI。</p>
    <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => void openUrl("https://space.bilibili.com/10075923")}>打开 B站主页</Button><Button variant="outline" size="sm" onClick={() => void openUrl("https://github.com/ytton/video-poster")}>项目 GitHub</Button><Button variant="outline" size="sm" onClick={() => void openUrl("https://github.com/dreammis/social-auto-upload")}>上游项目</Button></div>
  </DialogContent></Dialog>
}

function Shell() {
  const { runtime, loading, accounts, tasks, works, operationError, setOperationError, storageError } = useApp()
  const [page, setPage] = useState<Page>("publish")
  const [republishWorkId, setRepublishWorkId] = useState("")
  const [focusedTaskId, setFocusedTaskId] = useState("")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [faultOpen, setFaultOpen] = useState(false)
  const faults = useSyncExternalStore(subscribeFaults, getFaults)
  useEffect(() => { if (faults.length) setFaultOpen(true) }, [faults.length])
  const pending = tasks.filter(task => task.status === "running" || task.status === "queued").length
  const content = useMemo(() => {
    if (page === "publish") return <PublishPage key={republishWorkId || "new"} initialWork={works.find(work => work.id === republishWorkId)} openTasks={() => setPage("tasks")} />
    if (page === "works") return <WorksPage openTask={id => { setFocusedTaskId(id); setPage("tasks") }} onRepublish={id => { setRepublishWorkId(id); setPage("publish") }} />
    if (page === "accounts") return <AccountsPage />
    if (page === "tasks") return <TasksPage focusedTaskId={focusedTaskId} />
    return <ToolsPage openTasks={() => setPage("tasks")} />
  }, [page, focusedTaskId, republishWorkId, works])
  return <TooltipProvider><div className="flex h-full flex-col">
    <TitleBar onSettings={() => setSettingsOpen(true)} />
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-[#eef2f3] p-2">
        <nav className="space-y-1">{mainPages.map(item => <button key={item.id} type="button" onClick={() => { if (item.id === "publish") setRepublishWorkId(""); setPage(item.id) }} className={`flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-sm ${page === item.id ? "bg-white font-semibold text-primary shadow-sm" : "text-foreground hover:bg-white/70"}`}><item.icon className="size-4" />{item.label}{item.id === "tasks" && pending > 0 && <span className="ml-auto rounded bg-primary px-1.5 text-[10px] text-white">{pending}</span>}</button>)}</nav>
        <div className="mt-auto space-y-2 px-2 pb-2"><div className="rounded-md border border-border bg-white p-2"><div className="flex items-center gap-2 text-xs font-medium">{runtime?.ready ? <span className="size-1.5 rounded-full bg-emerald-600" /> : <span className="size-1.5 rounded-full bg-amber-600" />}{loading ? "连接中" : runtime?.ready ? "CLI 已连接" : "CLI 未连接"}</div><p className="mt-1 text-xs text-muted-foreground">{accounts.length} 个账号 · {pending} 项进行中</p></div><button onClick={() => setAboutOpen(true)} className="flex h-8 w-full items-center gap-2 rounded px-2 text-xs text-muted-foreground hover:bg-white"><CircleHelp className="size-4" />关于作者</button></div>
      </aside>
      <main className="min-w-0 flex-1">{content}</main>
    </div>
    {(operationError || storageError) && <div className="flex shrink-0 items-center gap-2 border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-destructive"><CircleAlert className="size-4" /><span className="min-w-0 flex-1 truncate">{operationError || storageError}</span><button title="关闭提示" onClick={() => setOperationError("")}><X className="size-4" /></button></div>}
    <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} openFaults={() => setFaultOpen(true)} />
    <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    <FaultDialog open={faultOpen} onOpenChange={setFaultOpen} />
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
