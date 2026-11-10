import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

export const inDesktop = isTauri()

export interface BridgeInfo {
  extensionPath: string
  port: number
  pairUrl: string
  extensionVersion: string | null
}

export interface BrowserTaskInput {
  id: string
  platform: string
  filePath: string
  title: string
  description: string
  tags: string[]
  declaration: string
  thumbnailPortrait: string
  thumbnailLandscape: string
  initialStatus?: string
}

export interface BrowserTaskStatus {
  taskId: string
  status: "opened" | "uploading" | "filling" | "prepared" | "verified" | "check-failed" | "failed"
  message: string
  evidence?: { recordId: string; recordUrl: string; title: string }
}

export async function bridgeInfo(): Promise<BridgeInfo> {
  if (!inDesktop) throw new Error("请在桌面程序中连接浏览器扩展")
  return invoke("bridge_info")
}

export async function createBrowserTask(input: BrowserTaskInput): Promise<string> {
  return invoke("create_browser_task", { input })
}

export async function setActiveBrowserTask(taskId: string | null): Promise<void> {
  return invoke("set_active_browser_task", { taskId })
}

export async function cancelBrowserTask(taskId: string): Promise<void> {
  return invoke("cancel_browser_task", { taskId })
}

export async function onBrowserTaskStatus(handler: (payload: BrowserTaskStatus) => void): Promise<UnlistenFn> {
  return listen<BrowserTaskStatus>("browser-task-status", event => handler(event.payload))
}

export async function onNativeFault(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>("native-fault", event => handler(event.payload))
}

export async function prepareVideoPreview(path: string): Promise<string> {
  return inDesktop ? invoke<string>("prepare_video_preview", { path }) : path
}

export async function hashVideoFile(path: string): Promise<{ sha256: string; bytes: number; filePath: string }> {
  if (!inDesktop) throw new Error("请在桌面程序中识别视频文件")
  return invoke("hash_video_file", { path })
}

export async function prepareCoverPreview(path: string): Promise<string> {
  return inDesktop ? invoke<string>("prepare_cover_preview", { path }) : path
}

export async function saveCoverFrame(orientation: "landscape" | "portrait", blob: Blob): Promise<string> {
  if (!inDesktop) throw new Error("请在桌面程序中截取封面")
  return invoke<string>("save_cover_frame", { orientation, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) })
}
