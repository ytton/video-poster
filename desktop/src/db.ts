import { openDB, type DBSchema } from "idb"
import type { AccountRecord, TaskRecord, WorkContent, WorkPublication, WorkRecord } from "./types"

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
  works: {
    key: string
    value: WorkRecord
    indexes: { "by-root": string }
  }
}

const database = openDB<SauDB>("sau-desktop", 2, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      const accounts = db.createObjectStore("accounts", { keyPath: "id" })
      accounts.createIndex("by-root", "repoRoot")
      const tasks = db.createObjectStore("tasks", { keyPath: "id" })
      tasks.createIndex("by-root", "repoRoot")
    }
    if (oldVersion < 2) {
      const works = db.createObjectStore("works", { keyPath: "id" })
      works.createIndex("by-root", "repoRoot")
    }
  },
})

export async function loadAccounts(repoRoot: string): Promise<AccountRecord[]> {
  return (await database).getAllFromIndex("accounts", "by-root", repoRoot)
}

export async function saveAccount(account: AccountRecord): Promise<void> {
  await (await database).put("accounts", account)
}

export async function saveAccountOrder(accounts: AccountRecord[]): Promise<void> {
  const transaction = (await database).transaction("accounts", "readwrite")
  await Promise.all(accounts.map(account => transaction.store.put(account)))
  await transaction.done
}

export async function deleteAccount(id: string): Promise<void> {
  await (await database).delete("accounts", id)
}

export async function loadTasks(repoRoot: string): Promise<TaskRecord[]> {
  const tasks = await (await database).getAllFromIndex("tasks", "by-root", repoRoot)
  return tasks.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 200)
}

export async function loadAllTasks(): Promise<TaskRecord[]> {
  return (await (await database).getAll("tasks"))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 200)
}

export async function saveTask(task: TaskRecord): Promise<void> {
  await (await database).put("tasks", task)
}

export async function loadWorks(repoRoot: string): Promise<WorkRecord[]> {
  const works = await (await database).getAllFromIndex("works", "by-root", repoRoot)
  return works.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function loadAllWorks(): Promise<WorkRecord[]> {
  return (await (await database).getAll("works"))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getOrCreateWork(repoRoot: string, sha256: string, bytes: number, filePath: string, content: WorkContent): Promise<WorkRecord> {
  const id = `${repoRoot}|${sha256}`
  const transaction = (await database).transaction("works", "readwrite")
  const existing = (await transaction.store.getAll()).find(item => item.sha256 === sha256)
  const now = new Date().toISOString()
  const work: WorkRecord = existing
    ? { ...existing, filePath, content, updatedAt: now }
    : { id, repoRoot, sha256, bytes, filePath, content, createdAt: now, updatedAt: now, publications: [] }
  await transaction.store.put(work)
  await transaction.done
  return work
}

export async function addWorkPublication(workId: string, publication: WorkPublication): Promise<WorkRecord> {
  const transaction = (await database).transaction("works", "readwrite")
  const work = await transaction.store.get(workId)
  if (!work) throw new Error("找不到作品记录")
  if (work.publications.some(item => item.taskId === publication.taskId)) {
    await transaction.done
    return work
  }
  const updated = { ...work, publications: [...work.publications, publication], updatedAt: publication.publishedAt }
  await transaction.store.put(updated)
  await transaction.done
  return updated
}
