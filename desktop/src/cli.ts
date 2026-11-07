import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type { CliNode, RuntimeInfo, TaskFinishedEvent, TaskLineEvent } from "./types"

export const inDesktop = isTauri()

export async function runtimeInfo(repoDir: string): Promise<RuntimeInfo> {
  if (!inDesktop) {
    return { ready: false, root: repoDir, cliPath: "", message: "请在桌面程序中连接 CLI" }
  }
  return invoke<RuntimeInfo>("runtime_info", { repoDir: repoDir || null })
}

export async function cliSchema(repoDir: string): Promise<CliNode[]> {
  return invoke<CliNode[]>("cli_schema", { repoDir: repoDir || null })
}

export async function detectedAccounts(repoDir: string): Promise<{ platform: string; name: string }[]> {
  return invoke("list_accounts", { repoDir: repoDir || null })
}

export async function removeSession(repoDir: string, platform: string, account: string): Promise<void> {
  return invoke("remove_session", { repoDir: repoDir || null, platform, account })
}

export async function startCli(repoDir: string, taskId: string, args: string[]): Promise<void> {
  return invoke("start_cli", { repoDir: repoDir || null, taskId, args })
}

export async function openBilibiliLogin(repoDir: string, taskId: string, account: string): Promise<void> {
  return invoke("open_bilibili_login", { repoDir: repoDir || null, taskId, account })
}

export async function cancelCli(taskId: string): Promise<void> {
  return invoke("cancel_cli", { taskId })
}

export async function onCliLine(handler: (payload: TaskLineEvent) => void): Promise<UnlistenFn> {
  return listen<TaskLineEvent>("cli-line", event => handler(event.payload))
}

export async function onCliFinished(handler: (payload: TaskFinishedEvent) => void): Promise<UnlistenFn> {
  return listen<TaskFinishedEvent>("cli-finished", event => handler(event.payload))
}

export async function onNativeFault(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>("native-fault", event => handler(event.payload))
}
