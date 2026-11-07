import { openDB, type DBSchema } from "idb"
import type { AccountRecord, TaskRecord } from "./types"

interface SauDB extends DBSchema {
  accounts: {
    key: string
    value: AccountRecord
    indexes: { "by-root": string }
  }
  tasks: {
    key: string
    value: TaskRecord
    indexes: { "by-root": string }
  }
}

const database = openDB<SauDB>("sau-desktop", 1, {
  upgrade(db) {
    const accounts = db.createObjectStore("accounts", { keyPath: "id" })
    accounts.createIndex("by-root", "repoRoot")
    const tasks = db.createObjectStore("tasks", { keyPath: "id" })
    tasks.createIndex("by-root", "repoRoot")
  },
})

export async function loadAccounts(repoRoot: string): Promise<AccountRecord[]> {
  return (await database).getAllFromIndex("accounts", "by-root", repoRoot)
}

export async function saveAccount(account: AccountRecord): Promise<void> {
  await (await database).put("accounts", account)
}

export async function deleteAccount(id: string): Promise<void> {
  await (await database).delete("accounts", id)
}

export async function loadTasks(repoRoot: string): Promise<TaskRecord[]> {
  const tasks = await (await database).getAllFromIndex("tasks", "by-root", repoRoot)
  return tasks.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 200)
}

export async function saveTask(task: TaskRecord): Promise<void> {
  await (await database).put("tasks", task)
}
