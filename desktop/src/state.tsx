import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { addWorkPublication, getOrCreateWork, loadAllTasks, loadAllWorks, saveTask, saveWorkPlatforms } from "./db"
import { redact, reportFault } from "./faults"
import { CREATOR_PAGES, UPLOAD_PAGES } from "./platforms"
import { bridgeInfo, cancelBrowserTask, createBrowserTask, hashVideoFile, inDesktop, onBrowserTaskStatus, onNativeFault, setActiveBrowserTask, type BridgeInfo, type BrowserTaskInput } from "./native"
import type { FormValues, TaskRecord, WorkContent, WorkRecord } from "./types"

const LOCAL_ROOT = "local-browser"

interface AppModel {
  bridge: BridgeInfo | null
  tasks: TaskRecord[]
  works: WorkRecord[]
  activeWorkId: string
  loading: boolean
  storageError: string
  operationError: string
  setOperationError: (message: string) => void
  reload: () => Promise<void>
  prepareWork: (filePath: string, content: WorkContent, expectedHash?: string) => Promise<WorkRecord>
  createTask: (work: WorkRecord, input: Omit<BrowserTaskInput, "id">, openBrowser?: boolean) => Promise<string>
  resumeTask: (id: string) => Promise<void>
  refreshTask: (id: string, input: Omit<BrowserTaskInput, "id">) => Promise<void>
  startManualPlatform: (work: WorkRecord, platform: string) => Promise<void>
  activateWork: (work: WorkRecord, includeDouyin: boolean) => Promise<void>
  deactivateWork: () => Promise<void>
  updateWorkPlatforms: (workId: string, platforms: string[]) => Promise<WorkRecord>
  verifyPublished: (id: string) => Promise<void>
  cancelTask: (id: string) => Promise<void>
}

const AppContext = createContext<AppModel | null>(null)

export function useApp(): AppModel {
  const context = useContext(AppContext)
  if (!context) throw new Error("AppProvider missing")
  return context
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [bridge, setBridge] = useState<BridgeInfo | null>(null)
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [works, setWorks] = useState<WorkRecord[]>([])
  const [activeWorkId, setActiveWorkId] = useState(() => localStorage.getItem("active-publish-work") || "")
  const [loading, setLoading] = useState(true)
  const [storageError, setStorageError] = useState("")
  const [operationError, setOperationError] = useState("")
  const taskRef = useRef<TaskRecord[]>([])
  const firstLoadRef = useRef(true)

  const updateTask = useCallback((id: string, patch: Partial<TaskRecord>) => {
    const next = taskRef.current.map(task => task.id === id ? { ...task, ...patch } : task)
    taskRef.current = next
    setTasks(next)
    const changed = next.find(task => task.id === id)
    if (changed) void saveTask(changed).catch(error => setStorageError(`任务记录未保存：${String(error)}`))
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [nextBridge, storedTasks, storedWorks] = await Promise.all([
        inDesktop ? bridgeInfo() : Promise.resolve(null), loadAllTasks(), loadAllWorks(),
      ])
      setBridge(nextBridge)
      const restored = storedTasks.map(task => firstLoadRef.current && task.status === "running" && task.action === "upload-video"
        ? { ...task, status: "interrupted" as const, finishedAt: new Date().toISOString(), message: "桌面程序已重启，可在原发布页用扩展继续" }
        : task)
      const registeredTaskIds = new Set<string>()
      if (nextBridge) {
        for (const task of restored) {
          if (task.repoRoot !== LOCAL_ROOT || !UPLOAD_PAGES[task.platform] || !task.publishValues || ["success", "cancelled"].includes(task.status)) continue
          const values = task.publishValues
          try {
            await createBrowserTask({
              id: task.id, filePath: String(values.file || ""), title: String(values.title || ""),
              platform: task.platform,
              description: String(values.desc || ""),
              tags: String(values.tags || "").split(/[,，]/).filter(Boolean),
              declaration: String(values.declaration || ""),
              thumbnailPortrait: String(values.thumbnail_portrait || ""),
              thumbnailLandscape: String(values.thumbnail_landscape || ""),
              initialStatus: task.status === "interrupted" ? "failed" : task.status,
            })
            registeredTaskIds.add(task.id)
          } catch (error) {
            task.status = "interrupted"
            task.message = `原文件不可用，无法在扩展中继续：${String(error)}`
          }
        }
      }
      taskRef.current = restored
      firstLoadRef.current = false
      setTasks(restored)
      setWorks(storedWorks)
      const lockedId = localStorage.getItem("active-publish-work")
      const activeTask = restored.find(task => task.workId === lockedId && registeredTaskIds.has(task.id)
        && !["success", "cancelled"].includes(task.status))
      if (nextBridge) await setActiveBrowserTask(activeTask?.id || null)
      if (lockedId && !storedWorks.some(work => work.id === lockedId)) {
        localStorage.removeItem("active-publish-work")
        setActiveWorkId("")
      }
      await Promise.all(restored.filter(task => task.status === "interrupted").map(saveTask))
    } catch (error) {
      setOperationError(`读取本机记录失败：${String(error)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    if (!inDesktop) return
    let active = true
    let listeners: (() => void)[] = []
    void Promise.all([
      onBrowserTaskStatus(payload => {
        const task = taskRef.current.find(item => item.id === payload.taskId)
        if (!task || task.status === "cancelled" || task.status === "success") return
        if (payload.status === "verified" && payload.evidence && task.workId && task.publishValues) {
          const evidence = payload.evidence
          void (async () => {
            const publishedAt = new Date().toISOString()
            const work = await addWorkPublication(task.workId!, {
              taskId: task.id, platform: task.platform, accountName: "浏览器账号", publishedAt,
              values: task.publishValues!, evidence,
            })
            setWorks(previous => [work, ...previous.filter(item => item.id !== work.id)])
            updateTask(task.id, { status: "success", evidence, finishedAt: publishedAt,
              message: `已检验发布记录：${evidence.recordId}` })
            await cancelBrowserTask(task.id)
          })().catch(error => setOperationError(`保存发布记录失败：${String(error)}`))
          return
        }
        if (payload.status === "check-failed") {
          updateTask(task.id, { message: redact(payload.message),
            lines: [...task.lines, `${new Date().toLocaleTimeString()} 检验未通过: ${redact(payload.message)}`].slice(-100) })
          setOperationError(`检验${task.platform}发布记录失败：${redact(payload.message)}`)
          return
        }
        const status = payload.status === "prepared" ? "prepared" : payload.status === "failed" ? "failed" : "running"
        updateTask(payload.taskId, {
          status,
          message: redact(payload.message),
          lines: [...task.lines, `${new Date().toLocaleTimeString()} ${payload.status}: ${redact(payload.message)}`].slice(-100),
          finishedAt: status === "prepared" || status === "failed" ? new Date().toISOString() : undefined,
        })
      }),
      onNativeFault(message => reportFault("native", new Error(message))),
    ]).then(results => { if (active) listeners = results; else results.forEach(stop => stop()) })
      .catch(error => reportFault("frontend", error))
    return () => { active = false; listeners.forEach(stop => stop()) }
  }, [updateTask])

  const prepareWork = async (filePath: string, content: WorkContent, expectedHash?: string): Promise<WorkRecord> => {
    const digest = await hashVideoFile(filePath)
    if (expectedHash && expectedHash !== digest.sha256) throw new Error("视频文件内容已改变，请选择原作品文件后再试")
    const work = await getOrCreateWork(LOCAL_ROOT, digest.sha256, digest.bytes, digest.filePath, content)
    setWorks(previous => [work, ...previous.filter(item => item.id !== work.id)])
    return work
  }

  const createTask = async (work: WorkRecord, input: Omit<BrowserTaskInput, "id">, launchBrowser = true): Promise<string> => {
    if (!bridge) throw new Error("浏览器桥接未就绪，请重新打开软件")
    const id = crypto.randomUUID()
    const values: FormValues = {
      file: input.filePath, title: input.title, desc: input.description, tags: input.tags.join(","),
      thumbnail_portrait: input.thumbnailPortrait, thumbnail_landscape: input.thumbnailLandscape,
      declaration: input.declaration,
    }
    const task: TaskRecord = {
      id, repoRoot: LOCAL_ROOT, platform: input.platform, action: "upload-video", workId: work.id,
      workTitle: input.title, publishValues: values, prepareOnly: true,
      status: "queued", startedAt: new Date().toISOString(), lines: [],
      message: "等待浏览器扩展连接",
    }
    taskRef.current = [task, ...taskRef.current].slice(0, 200)
    setTasks(taskRef.current)
    await saveTask(task)
    try {
      const url = await createBrowserTask({ id, ...input })
      await setActiveBrowserTask(id)
      localStorage.setItem("active-publish-work", work.id)
      setActiveWorkId(work.id)
      if (launchBrowser) {
        try {
          await openUrl(url)
          updateTask(id, { message: `作品已准备好，请在${input.platform}页面点击扩展图标自动补齐` })
        } catch (error) {
          updateTask(id, { message: `作品已准备好，请手动打开发布页：${String(error)}` })
        }
      } else {
        updateTask(id, { message: "作品已锁定，可在对应平台上传页用扩展自动填写" })
      }
      return id
    } catch (error) {
      updateTask(id, { status: "failed", finishedAt: new Date().toISOString(), message: String(error) })
      throw error
    }
  }

  const resumeTask = async (id: string): Promise<void> => {
    if (!bridge) throw new Error("浏览器桥接未就绪")
    const task = taskRef.current.find(item => item.id === id)
    if (!task || ["success", "cancelled"].includes(task.status)) throw new Error("找不到可继续的发布任务")
    await setActiveBrowserTask(id)
    const url = new URL(bridge.pairUrl)
    url.hash = new URLSearchParams({ token: new URLSearchParams(url.hash.slice(1)).get("token") || "", task: id }).toString()
    await openUrl(url.toString())
  }

  const refreshTask = async (id: string, input: Omit<BrowserTaskInput, "id">): Promise<void> => {
    const task = taskRef.current.find(item => item.id === id)
    if (!task || task.platform !== input.platform) throw new Error("找不到当前平台任务")
    const values: FormValues = { file: input.filePath, title: input.title, desc: input.description,
      tags: input.tags.join(","), thumbnail_portrait: input.thumbnailPortrait,
      thumbnail_landscape: input.thumbnailLandscape, declaration: input.declaration }
    if (JSON.stringify(task.publishValues) === JSON.stringify(values)) return
    await createBrowserTask({ id, ...input })
    updateTask(id, { publishValues: values, workTitle: input.title,
      message: "作品资料已更新；网页已有内容会保留，请在发布前核对" })
  }

  const startManualPlatform = async (work: WorkRecord, platform: string): Promise<void> => {
    const page = CREATOR_PAGES[platform]
    if (!page) throw new Error("未知发布平台")
    let task = taskRef.current.find(item => item.workId === work.id && item.platform === platform
      && item.action === "open-platform" && item.status !== "cancelled")
    if (!task) {
      task = { id: crypto.randomUUID(), repoRoot: LOCAL_ROOT, platform, action: "open-platform",
        workId: work.id, workTitle: work.content.title, status: "running", startedAt: new Date().toISOString(),
        lines: [], message: "已打开平台页面，尚未接入自动填写与发布记录检验" }
      taskRef.current = [task, ...taskRef.current].slice(0, 200)
      setTasks(taskRef.current)
      await saveTask(task)
    }
    await openUrl(page.url)
  }

  const activateWork = async (work: WorkRecord, _includeDouyin: boolean): Promise<void> => {
    const pending = taskRef.current.find(task => task.workId === work.id && !!UPLOAD_PAGES[task.platform]
      && !["success", "cancelled"].includes(task.status))
    if (bridge) await setActiveBrowserTask(pending?.id || null)
    localStorage.setItem("active-publish-work", work.id)
    setActiveWorkId(work.id)
  }

  const deactivateWork = async (): Promise<void> => {
    if (bridge) await setActiveBrowserTask(null)
    localStorage.removeItem("active-publish-work")
    setActiveWorkId("")
  }

  const updateWorkPlatforms = async (workId: string, platforms: string[]): Promise<WorkRecord> => {
    const work = await saveWorkPlatforms(workId, platforms)
    setWorks(previous => previous.map(item => item.id === work.id ? work : item))
    return work
  }

  const verifyPublished = async (id: string): Promise<void> => {
    if (!bridge) throw new Error("浏览器桥接未就绪")
    const task = taskRef.current.find(item => item.id === id)
    if (!task || !["prepared", "running", "failed", "interrupted"].includes(task.status)) throw new Error("请先去发布该平台")
    if (!UPLOAD_PAGES[task.platform]) throw new Error("该平台尚未接入发布记录检验，不能计为已发布")
    const url = new URL(bridge.pairUrl)
    url.hash = new URLSearchParams({ token: new URLSearchParams(url.hash.slice(1)).get("token") || "", verify: id }).toString()
    updateTask(id, { message: "正在浏览器中核对平台发布记录" })
    await openUrl(url.toString())
  }

  const cancelTask = async (id: string): Promise<void> => {
    const task = taskRef.current.find(item => item.id === id)
    if (!task || !["queued", "running", "failed", "interrupted"].includes(task.status)) return
    await cancelBrowserTask(id)
    updateTask(id, { status: "cancelled", finishedAt: new Date().toISOString(), message: "已停止向浏览器提供本机文件；浏览器中已开始的上传需手动停止" })
  }

  return <AppContext.Provider value={{
    bridge, tasks, works, activeWorkId, loading, storageError, operationError, setOperationError,
    reload, prepareWork, createTask, resumeTask, refreshTask, startManualPlatform, activateWork, deactivateWork, updateWorkPlatforms, verifyPublished, cancelTask,
  }}>{children}</AppContext.Provider>
}
