import { Component, useEffect, useMemo, useState, useSyncExternalStore, type ErrorInfo, type ReactNode } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { openUrl } from "@tauri-apps/plugin-opener"
import { ArrowRight, Check, CircleAlert, CircleHelp, FolderOpen, History, Link2, Plus, RefreshCw, Send, Terminal, Trash2, Upload, Users, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppProvider, useApp } from "./state"
import { platformLabel, PLATFORM_COLORS } from "./platforms"
import { buildArgs, findAction } from "./args"
import { CommandFields } from "./components/CommandFields"
import { VideoDropzone } from "./components/VideoDropzone"
import { PublishPreview } from "./components/PublishPreview"
import { FaultDialog } from "./components/FaultDialog"
import { TitleBar } from "./components/TitleBar"
import { getFaults, reportFault, subscribeFaults } from "./faults"
import type { AccountRecord, FieldValue, FormValues } from "./types"
import authorAvatar from "./assets/author.jpg"

type Page = "publish" | "accounts" | "tasks" | "tools"
const mainPages: { id: Page; label: string; icon: typeof Send }[] = [
  { id: "publish", label: "发布", icon: Send },
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
  }
  const labels: Record<string, string> = {
    valid: "有效", invalid: "已失效", checking: "检查中", "logging-in": "登录中", unknown: "未检查", error: "检查失败",
    success: "成功", failed: "失败", running: "运行中", queued: "排队中", cancelled: "已取消", interrupted: "需核对",
  }
  return <Badge variant="outline" className={`font-normal ${styles[status] || "border-gray-200 text-gray-600"}`}>{labels[status] || status}</Badge>
}

function SectionHead({ title, right, subtitle }: { title: string; right?: ReactNode; subtitle?: string }) {
  return <div className="flex min-h-10 shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-3">
    <div className="min-w-0"><h1 className="text-base font-semibold">{title}</h1>{subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}</div>
    <div className="flex shrink-0 items-center gap-2">{right}</div>
  </div>
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

function AccountsPage() {
  const { accounts, statuses, schema, runtime, checkAll, checkAccount, loginAccount, unbindAccount, setOperationError } = useApp()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [search, setSearch] = useState("")
  const filtered = accounts.filter(account => `${platformLabel(account.platform)} ${account.name}`.toLowerCase().includes(search.toLowerCase()))
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
        : <div className="divide-y divide-border border-y border-border bg-white">{filtered.map(account => {
          const canCheck = !!findAction(schema, account.platform, "check")
          return <div key={account.id} className="flex min-h-16 items-center gap-3 px-3 py-2">
            <PlatformMark platform={account.platform} size="md" />
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-medium">{account.name}</span><StatusTag status={statuses[account.id] || "unknown"} /></div><p className="text-xs text-muted-foreground">{platformLabel(account.platform)}</p></div>
            <Button size="sm" variant="outline" disabled={!canCheck} onClick={() => checkAccount(account)}><RefreshCw />检查</Button>
            <Button size="sm" variant="outline" onClick={() => void loginAccount(account).catch(error => setOperationError(String(error)))}><Link2 />重新登录</Button>
            <Button size="icon-sm" variant="ghost" title="解除绑定" onClick={() => void confirmUnbind(account)}><Trash2 /></Button>
          </div>
        })}</div>}
    </div>
    <AccountDialog open={dialogOpen} onOpenChange={setDialogOpen} />
  </div>
}

function PublishPage({ openTasks }: { openTasks: () => void }) {
  const { accounts, schema, statuses, runtime, enqueue, setOperationError } = useApp()
  const publishable = accounts.filter(account => !!findAction(schema, account.platform, "upload-video"))
  const [selected, setSelected] = useState<string[]>([])
  const [file, setFile] = useState("")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState("")
  const [schedule, setSchedule] = useState("")
  const [extras, setExtras] = useState<Record<string, FormValues>>({})
  const [formError, setFormError] = useState("")
  const selectedAccounts = publishable.filter(account => selected.includes(account.id))
  const previewPlatforms = [...new Set((selectedAccounts.length ? selectedAccounts : publishable).map(account => account.platform))]
  const submit = () => {
    setFormError("")
    if (!file.trim() || !title.trim() || selectedAccounts.length === 0) {
      setFormError("请选择视频、填写标题并勾选至少一个账号")
      return
    }
    try {
      const commands = selectedAccounts.map(account => {
        const node = findAction(schema, account.platform, "upload-video")!
        const values: FormValues = { account: account.name, file, title, desc: description, tags, ...extras[account.id] }
        if (schedule && node.options.some(option => option.name === "schedule")) values.schedule = schedule
        try { return { account, args: buildArgs(account.platform, node, values) } }
        catch (error) { throw new Error(`${platformLabel(account.platform)}：${String(error)}`) }
      })
      commands.forEach(({ account, args }) => enqueue(account.platform, "upload-video", args, account.name))
      openTasks()
    } catch (error) {
      setFormError(String(error))
      setOperationError(String(error))
    }
  }
  const common = ["account", "file", "title", "desc", "tags", "schedule", "headless"]
  return <div className="flex h-full min-h-0 flex-col">
    <SectionHead title="发布视频" subtitle="选择视频和账号，逐个平台提交" right={<Button size="sm" onClick={submit} disabled={!runtime?.ready || !publishable.length}><Upload />加入发布队列</Button>} />
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(270px,320px)]">
    <div className="tool-scroll min-h-0 px-5 py-4" tabIndex={0}>
      <div className="space-y-5">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">视频与文案</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-1.5 lg:col-span-2"><span className="text-xs font-medium">视频文件 <span className="text-destructive">*</span></span><VideoDropzone value={file} onChange={setFile} onError={setFormError} /></div>
            <label className="flex flex-col gap-1.5 lg:col-span-2"><span className="text-xs font-medium">标题 <span className="text-destructive">*</span></span><Input className="bg-white" value={title} onChange={event => setTitle(event.target.value)} placeholder="视频标题" /></label>
            <label className="flex flex-col gap-1.5 lg:col-span-2"><span className="text-xs font-medium">简介</span><Textarea className="min-h-20 bg-white" value={description} onChange={event => setDescription(event.target.value)} placeholder="视频简介" /></label>
            <label className="flex flex-col gap-1.5"><span className="text-xs font-medium">话题标签</span><Input className="bg-white" value={tags} onChange={event => setTags(event.target.value)} placeholder="用英文逗号分隔" /></label>
            <label className="flex flex-col gap-1.5"><span className="text-xs font-medium">定时发布</span><Input className="bg-white" type="datetime-local" value={schedule} onChange={event => setSchedule(event.target.value)} /></label>
          </div>
        </section>
        <section className="space-y-3 border-t border-border pt-4">
          <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">发布账号 <span className="font-normal text-muted-foreground">({selectedAccounts.length})</span></h2>{publishable.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelected(selected.length === publishable.length ? [] : publishable.map(account => account.id))}>{selected.length === publishable.length ? "清空" : "全选"}</Button>}</div>
          {!publishable.length ? <div className="rounded-md border border-dashed border-border bg-white p-6"><Empty icon={Users} title="还没有可发布的账号" detail="先到账号页绑定平台账号" /></div> :
          <div className="divide-y divide-border border-y border-border bg-white">{publishable.map(account => {
            const checked = selected.includes(account.id)
            const node = findAction(schema, account.platform, "upload-video")!
            const options = node.options.filter(option => !common.includes(option.name))
            return <div key={account.id} className="px-3 py-2">
              <label className="flex min-h-9 items-center gap-3"><Checkbox checked={checked} onCheckedChange={value => setSelected(previous => value ? [...previous, account.id] : previous.filter(id => id !== account.id))} /><PlatformMark platform={account.platform} /><span className="min-w-0 flex-1 truncate font-medium">{platformLabel(account.platform)} · {account.name}</span><StatusTag status={statuses[account.id] || "unknown"} /></label>
              {checked && options.length > 0 && <div className="ml-10 border-l border-border py-2 pl-4"><CommandFields options={options} values={extras[account.id] || {}} onChange={(name, value) => setExtras(previous => ({ ...previous, [account.id]: { ...previous[account.id], [name]: value } }))} /></div>}
            </div>
          })}</div>}
        </section>
        {schedule && selectedAccounts.some(account => !findAction(schema, account.platform, "upload-video")?.options.some(option => option.name === "schedule")) && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">部分已选平台没有定时参数，将立即发布。</p>}
        {formError && <p className="rounded bg-red-50 p-2 text-xs text-destructive">{formError}</p>}
      </div>
    </div>
    <PublishPreview platforms={previewPlatforms.length ? previewPlatforms : schema.filter(node => node.actions.some(action => action.name === "upload-video")).map(node => node.name)}
      file={file} title={title} description={description} tags={tags}
      accountName={platform => selectedAccounts.find(account => account.platform === platform)?.name || publishable.find(account => account.platform === platform)?.name || ""} />
    </div>
  </div>
}

function TasksPage() {
  const { tasks, cancelTask, setOperationError } = useApp()
  const [selectedId, setSelectedId] = useState("")
  const [filter, setFilter] = useState("all")
  const visible = tasks.filter(task => filter === "all" || task.status === filter)
  const selected = tasks.find(task => task.id === selectedId) || visible[0]
  return <div className="flex h-full min-h-0 flex-col">
    <SectionHead title="任务" subtitle={`${tasks.length} 条记录`} right={<Select value={filter} onValueChange={setFilter}><SelectTrigger className="w-32 bg-white" size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="running">运行中</SelectItem><SelectItem value="queued">排队中</SelectItem><SelectItem value="success">成功</SelectItem><SelectItem value="failed">失败</SelectItem><SelectItem value="interrupted">需核对</SelectItem></SelectContent></Select>} />
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
        runAction(platform, selectedAction.name, values)
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
  const { runtime, loading, accounts, tasks, operationError, setOperationError, storageError } = useApp()
  const [page, setPage] = useState<Page>("publish")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [faultOpen, setFaultOpen] = useState(false)
  const faults = useSyncExternalStore(subscribeFaults, getFaults)
  useEffect(() => { if (faults.length) setFaultOpen(true) }, [faults.length])
  const pending = tasks.filter(task => task.status === "running" || task.status === "queued").length
  const content = useMemo(() => {
    if (page === "publish") return <PublishPage openTasks={() => setPage("tasks")} />
    if (page === "accounts") return <AccountsPage />
    if (page === "tasks") return <TasksPage />
    return <ToolsPage openTasks={() => setPage("tasks")} />
  }, [page])
  return <TooltipProvider><div className="flex h-full flex-col">
    <TitleBar onSettings={() => setSettingsOpen(true)} />
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-[#eef2f3] p-2">
        <nav className="space-y-1">{mainPages.map(item => <button key={item.id} type="button" onClick={() => setPage(item.id)} className={`flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-sm ${page === item.id ? "bg-white font-semibold text-primary shadow-sm" : "text-foreground hover:bg-white/70"}`}><item.icon className="size-4" />{item.label}{item.id === "tasks" && pending > 0 && <span className="ml-auto rounded bg-primary px-1.5 text-[10px] text-white">{pending}</span>}</button>)}</nav>
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
