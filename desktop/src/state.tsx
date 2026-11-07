import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { accountId } from "./platforms"
import { buildArgs, findAction } from "./args"
import { cancelCli, cliSchema, detectedAccounts, hashVideoFile, inDesktop, onCliFinished, onCliLine, onNativeFault, openBilibiliLogin, removeSession, runtimeInfo, startCli } from "./cli"
import { addWorkPublication, deleteAccount, getOrCreateWork, loadAccounts, loadTasks, loadWorks, saveAccount, saveAccountOrder, saveTask } from "./db"
import { redact, reportFault } from "./faults"
import { isConfirmedPublication } from "./works"
import type { AccountRecord, AccountStatus, CliNode, FormValues, RuntimeInfo, TaskRecord, WorkContent, WorkRecord } from "./types"

interface AppModel {
  runtime: RuntimeInfo | null
  repoDir: string
  schema: CliNode[]
  accounts: AccountRecord[]
  statuses: Record<string, AccountStatus>
  tasks: TaskRecord[]
  works: WorkRecord[]
  loading: boolean
  storageError: string
  operationError: string
  busy: boolean
  setOperationError: (message: string) => void
  changeRepoDir: (value: string) => void
  reload: () => Promise<void>
  addAccount: (platform: string, name: string) => Promise<AccountRecord>
  unbindAccount: (account: AccountRecord) => Promise<void>
  reorderAccounts: (sourceId: string, targetId: string) => Promise<void>
  loginAccount: (account: AccountRecord) => Promise<void>
  checkAccount: (account: AccountRecord) => void
  checkAll: () => void
  prepareWork: (filePath: string, content: WorkContent, expectedHash?: string) => Promise<WorkRecord>
  enqueue: (platform: string, action: string, args: string[], accountName?: string, work?: { id: string; values: FormValues }) => string
  runAction: (platform: string, action: string, values: FormValues) => Promise<string>
  cancelTask: (id: string) => Promise<void>
}

const AppContext = createContext<AppModel | null>(null)

export function useApp(): AppModel {
  const context = useContext(AppContext)
  if (!context) throw new Error("AppProvider missing")
  return context
}

interface QueuedCommand { taskId: string; repoDir: string; args: string[] }

const sortAccounts = (items: AccountRecord[]) => items.sort((a, b) =>
  (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
  || a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name))

export function AppProvider({ children }: { children: ReactNode }) {
  const [repoDir, setRepoDir] = useState(() => localStorage.getItem("sau-repo-dir") || "")
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  const [schema, setSchema] = useState<CliNode[]>([])
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [statuses, setStatuses] = useState<Record<string, AccountStatus>>({})
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [works, setWorks] = useState<WorkRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [storageError, setStorageError] = useState("")
  const [operationError, setOperationError] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)
  const taskRef = useRef<TaskRecord[]>([])
  const queueRef = useRef<QueuedCommand[]>([])
  const activeTaskId = useRef<string | null>(null)
  const pumpRef = useRef<() => void>(() => {})
  const enqueueRef = useRef<(platform: string, action: string, args: string[], accountName?: string) => string>(() => "")
  const refreshAccountsRef = useRef<() => Promise<void>>(async () => {})

  const updateTask = useCallback((id: string, patch: Partial<TaskRecord>) => {
    const next = taskRef.current.map(task => task.id === id ? { ...task, ...patch } : task)
    taskRef.current = next
    setTasks(next)
    const changed = next.find(task => task.id === id)
    if (changed && patch.status && patch.status !== "running") {
      void saveTask(changed).catch(error => setStorageError(`任务记录未保存：${String(error)}`))
    }
  }, [])

  const refreshAccounts = useCallback(async () => {
    if (!runtime?.ready) return
    const [saved, detected] = await Promise.all([loadAccounts(runtime.root), detectedAccounts(runtime.root)])
    const merged = new Map(saved.map(account => [account.id, account]))
    for (const item of detected) {
      const id = accountId(runtime.root, item.platform, item.name)
      if (!merged.has(id)) {
        const account = { id, repoRoot: runtime.root, platform: item.platform, name: item.name, createdAt: new Date().toISOString() }
        merged.set(id, account)
        await saveAccount(account)
      }
    }
    setAccounts(sortAccounts([...merged.values()]))
  }, [runtime])
  refreshAccountsRef.current = refreshAccounts

  useEffect(() => {
    let active = true
    setLoading(true)
    setOperationError("")
    void (async () => {
      try {
        const info = await runtimeInfo(repoDir)
        if (!active) return
        setRuntime(info)
        if (!info.ready) {
          setSchema([])
          setAccounts([])
          setTasks([])
          setWorks([])
          taskRef.current = []
          return
        }
        const [nextSchema, saved, detected, storedTasks, storedWorks] = await Promise.all([
          cliSchema(info.root), loadAccounts(info.root), detectedAccounts(info.root), loadTasks(info.root), loadWorks(info.root),
        ])
        if (!active) return
        setSchema(nextSchema)
        const merged = new Map(saved.map(account => [account.id, account]))
        for (const item of detected) {
          const id = accountId(info.root, item.platform, item.name)
          if (!merged.has(id)) {
            const account = { id, repoRoot: info.root, platform: item.platform, name: item.name, createdAt: new Date().toISOString() }
            merged.set(id, account)
            await saveAccount(account)
          }
        }
        setAccounts(sortAccounts([...merged.values()]))
        const restored = storedTasks.map(task => task.status === "running" || task.status === "queued"
          ? { ...task, status: "interrupted" as const, finishedAt: new Date().toISOString(), message: "程序已重新启动，发布结果请到平台核对" }
          : task)
        taskRef.current = restored
        setTasks(restored)
        setWorks(storedWorks)
        await Promise.all(restored.filter(task => task.status === "interrupted").map(saveTask))
      } catch (error) {
        if (active) setOperationError(`读取项目失败：${String(error)}`)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [repoDir, refreshKey])

  pumpRef.current = () => {
    if (activeTaskId.current || queueRef.current.length === 0) return
    const item = queueRef.current.shift()!
    activeTaskId.current = item.taskId
    updateTask(item.taskId, { status: "running" })
    void startCli(item.repoDir, item.taskId, item.args).catch(error => {
      updateTask(item.taskId, { status: "failed", finishedAt: new Date().toISOString(), message: String(error) })
      activeTaskId.current = null
      pumpRef.current()
    })
  }

  const prepareWork = async (filePath: string, content: WorkContent, expectedHash?: string): Promise<WorkRecord> => {
    if (!runtime?.ready) throw new Error("CLI 未就绪")
    const digest = await hashVideoFile(filePath)
    if (expectedHash && expectedHash !== digest.sha256) throw new Error("视频文件内容已改变，请选择原作品文件后再补发")
    const work = await getOrCreateWork(runtime.root, digest.sha256, digest.bytes, digest.filePath, content)
    setWorks(previous => [work, ...previous.filter(item => item.id !== work.id)])
    return work
  }

  const enqueue = (platform: string, action: string, args: string[], accountName?: string, work?: { id: string; values: FormValues }): string => {
    if (!runtime?.ready) throw new Error("请先连接可用的 CLI 项目")
    const id = crypto.randomUUID()
    const titleIndex = args.indexOf("--title")
    const workTitle = action.startsWith("upload-") && titleIndex >= 0 ? args[titleIndex + 1] : undefined
    const record: TaskRecord = {
      id, repoRoot: runtime.root, platform, action, accountName, workTitle,
      workId: work?.id, publishValues: work?.values,
      prepareOnly: args.includes("--prepare-only") || args.includes("--draft"),
      status: "queued", startedAt: new Date().toISOString(), lines: [],
    }
    taskRef.current = [record, ...taskRef.current].slice(0, 200)
    setTasks([...taskRef.current])
    void saveTask(record).catch(error => setStorageError(`任务记录未保存：${String(error)}`))
    queueRef.current.push({ taskId: id, repoDir: runtime.root, args })
    pumpRef.current()
    return id
  }
  enqueueRef.current = enqueue

  useEffect(() => {
    if (!inDesktop) return
    let active = true
    let unlisten: (() => void)[] = []
    void Promise.all([
      onCliLine(payload => {
        const task = taskRef.current.find(item => item.id === payload.taskId)
        if (!task) return
        if (payload.text.trim() === "SAU_PREPARED_FOR_REVIEW") {
          updateTask(payload.taskId, { message: "发布页已填好，正在等待浏览器中的人工检查" })
          if (activeTaskId.current === payload.taskId) {
            activeTaskId.current = null
            pumpRef.current()
          }
          return
        }
        updateTask(payload.taskId, { lines: [...task.lines, redact(payload.text)].slice(-150) })
      }),
      onCliFinished(payload => {
        const task = taskRef.current.find(item => item.id === payload.taskId)
        if (!task) return
        const status = payload.cancelled ? "cancelled" : payload.exitCode === 0 ? task.prepareOnly ? "prepared" : "success" : "failed"
        const message = status === "prepared" ? "内容已交给平台；是否发布请到平台后台核对" : payload.message
        updateTask(payload.taskId, { status, exitCode: payload.exitCode, message, finishedAt: new Date().toISOString() })
        if (isConfirmedPublication(task, status) && task.workId && task.publishValues) {
          void addWorkPublication(task.workId, {
            taskId: task.id, platform: task.platform, accountName: task.accountName || "",
            publishedAt: new Date().toISOString(), values: task.publishValues,
          }).then(work => setWorks(previous => [work, ...previous.filter(item => item.id !== work.id)]))
            .catch(error => setStorageError(`作品发布记录未保存：${String(error)}`))
        }
        if (task.action === "check" && task.accountName) {
          const id = accountId(task.repoRoot, task.platform, task.accountName)
          const answer = [...task.lines].reverse().find(line => line.trim() === "valid" || line.trim() === "invalid")?.trim()
          setStatuses(previous => ({ ...previous, [id]: answer === "valid" ? "valid" : answer === "invalid" ? "invalid" : "error" }))
        }
        if (task.action === "login" && task.accountName && status === "success") {
          void refreshAccountsRef.current().catch(error => setOperationError(String(error)))
          enqueueRef.current(task.platform, "check", [task.platform, "check", "--account", task.accountName], task.accountName)
        } else if (task.action === "login" && task.accountName) {
          const id = accountId(task.repoRoot, task.platform, task.accountName)
          setStatuses(previous => ({ ...previous, [id]: "error" }))
        }
        if (activeTaskId.current === payload.taskId) {
          activeTaskId.current = null
          pumpRef.current()
        }
      }),
      onNativeFault(message => reportFault("native", new Error(message))),
    ]).then(results => {
      if (active) unlisten = results
      else results.forEach(stop => stop())
    }).catch(error => reportFault("frontend", error))
    return () => { active = false; unlisten.forEach(stop => stop()) }
  }, [updateTask])

  const changeRepoDir = (value: string) => {
    if (taskRef.current.some(task => task.status === "running" || task.status === "queued")) {
      setOperationError("任务进行中，暂不能切换项目目录")
      return
    }
    localStorage.setItem("sau-repo-dir", value)
    setRepoDir(value)
    setStatuses({})
  }

  const addAccount = async (platform: string, name: string): Promise<AccountRecord> => {
    if (!runtime?.ready) throw new Error("CLI 未就绪")
    const trimmed = name.trim()
    if (!trimmed || /[\\/:*?"<>|]/.test(trimmed) || trimmed.includes("..")) throw new Error("账号别名不能为空，也不能包含路径符号")
    const id = accountId(runtime.root, platform, trimmed)
    const existing = accounts.find(account => account.id === id)
    if (existing) return existing
    const account = { id, repoRoot: runtime.root, platform, name: trimmed, createdAt: new Date().toISOString(),
      order: Math.max(-1, ...accounts.map((item, index) => item.order ?? index)) + 1 }
    await saveAccount(account)
    setAccounts(previous => sortAccounts([...previous, account]))
    return account
  }

  const reorderAccounts = async (sourceId: string, targetId: string): Promise<void> => {
    if (sourceId === targetId) return
    const source = accounts.findIndex(account => account.id === sourceId)
    const target = accounts.findIndex(account => account.id === targetId)
    if (source < 0 || target < 0) return
    const next = [...accounts]
    const [moved] = next.splice(source, 1)
    next.splice(target, 0, moved)
    const ordered = next.map((account, order) => ({ ...account, order }))
    setAccounts(ordered)
    try {
      await saveAccountOrder(ordered)
    } catch (error) {
      setAccounts(current => current === ordered ? accounts : current)
      throw error
    }
  }

  const unbindAccount = async (account: AccountRecord): Promise<void> => {
    await removeSession(runtime?.root || repoDir, account.platform, account.name)
    await deleteAccount(account.id)
    setAccounts(previous => previous.filter(item => item.id !== account.id))
    setStatuses(previous => { const next = { ...previous }; delete next[account.id]; return next })
  }

  const loginAccount = async (account: AccountRecord): Promise<void> => {
    if (!runtime?.ready) throw new Error("CLI 未就绪")
    setStatuses(previous => ({ ...previous, [account.id]: "logging-in" }))
    if (account.platform === "bilibili") {
      const id = crypto.randomUUID()
      const record: TaskRecord = { id, repoRoot: runtime.root, platform: "bilibili", action: "login", accountName: account.name, status: "running", startedAt: new Date().toISOString(), lines: ["已打开独立终端，请在终端扫码登录" ] }
      taskRef.current = [record, ...taskRef.current].slice(0, 200)
      setTasks([...taskRef.current])
      await saveTask(record)
      try { await openBilibiliLogin(runtime.root, id, account.name) }
      catch (error) { updateTask(id, { status: "failed", finishedAt: new Date().toISOString(), message: String(error) }); throw error }
      return
    }
    const action = findAction(schema, account.platform, "login")
    if (!action) throw new Error("该平台没有登录命令")
    enqueue(account.platform, "login", buildArgs(account.platform, action, { account: account.name }), account.name)
  }

  const checkAccount = (account: AccountRecord): void => {
    if (!findAction(schema, account.platform, "check")) return
    setStatuses(previous => ({ ...previous, [account.id]: "checking" }))
    enqueue(account.platform, "check", [account.platform, "check", "--account", account.name], account.name)
  }

  const checkAll = (): void => accounts.forEach(account => checkAccount(account))

  const runAction = async (platform: string, actionName: string, values: FormValues): Promise<string> => {
    const action = findAction(schema, platform, actionName)
    if (!action) throw new Error("CLI 动作不存在")
    const args = buildArgs(platform, action, values)
    let work: { id: string; values: FormValues } | undefined
    if (actionName === "upload-video" && typeof values.file === "string") {
      const content: WorkContent = {
        title: String(values.title || ""), description: String(values.desc || ""), tags: String(values.tags || ""),
        thumbnailLandscape: String(values.thumbnail_landscape || values.thumbnail || ""),
        thumbnailPortrait: String(values.thumbnail_portrait || values.thumbnail || ""),
        origin: String(values.originality || values.source || ""), mark: String(values.video_mark || values.declaration || ""),
        schedule: String(values.schedule || ""),
      }
      const record = await prepareWork(values.file, content)
      work = { id: record.id, values }
    }
    return enqueue(platform, actionName, args, typeof values.account === "string" ? values.account : undefined, work)
  }

  const cancelTask = async (id: string): Promise<void> => {
    const task = taskRef.current.find(item => item.id === id)
    if (!task) return
    if (task.status === "queued") {
      queueRef.current = queueRef.current.filter(item => item.taskId !== id)
      updateTask(id, { status: "cancelled", finishedAt: new Date().toISOString(), message: "已取消" })
      return
    }
    if (task.status === "running") await cancelCli(id)
  }

  const busy = tasks.some(task => task.status === "running" || task.status === "queued")
  const reload = async () => { setRefreshKey(value => value + 1) }

  return <AppContext.Provider value={{
    runtime, repoDir, schema, accounts, statuses, tasks, works, loading, storageError, operationError, busy,
    setOperationError, changeRepoDir, reload, addAccount, unbindAccount, reorderAccounts, loginAccount, prepareWork,
    checkAccount, checkAll, enqueue, runAction, cancelTask,
  }}>{children}</AppContext.Provider>
}
