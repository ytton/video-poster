import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { addWorkPublication, getOrCreateWork, loadAllTasks, loadAllWorks, saveTask } from "./db"
import { redact, reportFault } from "./faults"
import { bridgeInfo, cancelBrowserTask, createBrowserTask, hashVideoFile, inDesktop, onBrowserTaskStatus, onNativeFault, type BridgeInfo, type BrowserTaskInput } from "./native"
import type { FormValues, TaskRecord, WorkContent, WorkRecord } from "./types"

const LOCAL_ROOT = "local-browser"

interface AppModel {
  bridge: BridgeInfo | null
  tasks: TaskRecord[]
  works: WorkRecord[]
  loading: boolean
  storageError: string
  operationError: string
  setOperationError: (message: string) => void
  reload: () => Promise<void>
  prepareWork: (filePath: string, content: WorkContent, expectedHash?: string) => Promise<WorkRecord>
  createTask: (work: WorkRecord, input: Omit<BrowserTaskInput, "id">) => Promise<string>
  confirmPublished: (id: string) => Promise<void>
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
      const restored = storedTasks.map(task => firstLoadRef.current && task.status === "running"
        ? { ...task, status: "interrupted" as const, finishedAt: new Date().toISOString(), message: "桌面程序已重启，可在原发布页用扩展继续" }
        : task)
      if (nextBridge) {
        for (const task of restored) {
          if (task.repoRoot !== LOCAL_ROOT || !task.publishValues || ["success", "cancelled"].includes(task.status)) continue
          const values = task.publishValues
          try {
            await createBrowserTask({
              id: task.id, filePath: String(values.file || ""), title: String(values.title || ""),
              description: String(values.desc || ""),
              tags: String(values.tags || "").split(/[,，]/).filter(Boolean),
              declaration: String(values.declaration || ""),
              thumbnailPortrait: String(values.thumbnail_portrait || ""),
              thumbnailLandscape: String(values.thumbnail_landscape || ""),
              initialStatus: task.status === "interrupted" ? "failed" : task.status,
            })
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

  const createTask = async (work: WorkRecord, input: Omit<BrowserTaskInput, "id">): Promise<string> => {
    if (!bridge) throw new Error("浏览器桥接未就绪，请重新打开软件")
    const id = crypto.randomUUID()
    const values: FormValues = {
      file: input.filePath, title: input.title, desc: input.description, tags: input.tags.join(","),
      thumbnail_portrait: input.thumbnailPortrait, thumbnail_landscape: input.thumbnailLandscape,
      declaration: input.declaration,
    }
    const task: TaskRecord = {
      id, repoRoot: LOCAL_ROOT, platform: "douyin", action: "upload-video", workId: work.id,
      workTitle: input.title, publishValues: values, prepareOnly: true,
      status: "queued", startedAt: new Date().toISOString(), lines: [],
      message: "等待浏览器扩展连接",
    }
    taskRef.current = [task, ...taskRef.current].slice(0, 200)
    setTasks(taskRef.current)
    await saveTask(task)
    try {
      const url = await createBrowserTask({ id, ...input })
      try {
        await openUrl(url)
        updateTask(id, { message: "作品已准备好，请在抖音页面点击扩展图标自动补齐" })
      } catch (error) {
        updateTask(id, { message: `作品已准备好，请手动打开抖音创作者中心：${String(error)}` })
      }
      return id
    } catch (error) {
      updateTask(id, { status: "failed", finishedAt: new Date().toISOString(), message: String(error) })
      throw error
    }
  }

  const confirmPublished = async (id: string): Promise<void> => {
    const task = taskRef.current.find(item => item.id === id)
    if (!task || task.status !== "prepared" || !task.workId || !task.publishValues) throw new Error("只有已填好的任务可以确认发布")
    const publishedAt = new Date().toISOString()
    const work = await addWorkPublication(task.workId, {
      taskId: task.id, platform: task.platform, accountName: "浏览器账号", publishedAt, values: task.publishValues,
    })
    setWorks(previous => [work, ...previous.filter(item => item.id !== work.id)])
    updateTask(id, { status: "success", finishedAt: publishedAt, message: "已由用户确认在抖音发布" })
    await cancelBrowserTask(id)
  }

  const cancelTask = async (id: string): Promise<void> => {
    const task = taskRef.current.find(item => item.id === id)
    if (!task || !["queued", "running", "failed", "interrupted"].includes(task.status)) return
    await cancelBrowserTask(id)
    updateTask(id, { status: "cancelled", finishedAt: new Date().toISOString(), message: "已停止向浏览器提供本机文件；浏览器中已开始的上传需手动停止" })
  }

  return <AppContext.Provider value={{
    bridge, tasks, works, loading, storageError, operationError, setOperationError,
    reload, prepareWork, createTask, confirmPublished, cancelTask,
  }}>{children}</AppContext.Provider>
}
