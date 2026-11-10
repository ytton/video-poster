import assert from "node:assert/strict"
import test from "node:test"
import "fake-indexeddb/auto"
import { openDB } from "idb"
import { isConfirmedPublication } from "../src/works.ts"

const content = {
  title: "第一版标题", description: "简介", tags: "A,B", thumbnailLandscape: "wide.jpg",
  thumbnailPortrait: "tall.jpg", origin: "original", mark: "ai", schedule: "",
}

test("version 1 records survive the works database upgrade", async () => {
  const old = await openDB("sau-desktop", 1, {
    upgrade(db) {
      const accounts = db.createObjectStore("accounts", { keyPath: "id" })
      accounts.createIndex("by-root", "repoRoot")
      const tasks = db.createObjectStore("tasks", { keyPath: "id" })
      tasks.createIndex("by-root", "repoRoot")
    },
  })
  await old.put("tasks", { id: "old-task", repoRoot: "repo", status: "success" })
  old.close()

  const { getOrCreateWork, loadWorks, addWorkPublication, saveWorkPlatforms } = await import("../src/db.ts")
  const upgraded = await openDB("sau-desktop", 2)
  assert.equal((await upgraded.get("tasks", "old-task")).status, "success")
  upgraded.close()

  const first = await getOrCreateWork("repo", "sha", 123, "first.mp4", content)
  const second = await getOrCreateWork("repo", "sha", 123, "moved.mp4", { ...content, title: "第二版标题" })
  assert.equal(first.id, second.id)
  assert.equal(second.content.title, "第二版标题")
  assert.equal(second.filePath, "moved.mp4")
  const publication = { taskId: "published-task", platform: "douyin", accountName: "主账号", publishedAt: "2026-11-07T00:00:00Z", values: { title: "平台标题", desc: "平台简介" } }
  await addWorkPublication(first.id, publication)
  await addWorkPublication(first.id, publication)
  const works = await loadWorks("repo")
  assert.equal(works.length, 1)
  assert.deepEqual(works[0].publications, [publication])

  const reused = await getOrCreateWork("local-browser", "sha", 123, "new-location.mp4", content)
  assert.equal(reused.id, first.id)
  assert.deepEqual(reused.publications, [publication])
  await saveWorkPlatforms(reused.id, ["douyin", "bilibili"])
  assert.deepEqual((await loadWorks("repo"))[0].content.platforms, ["douyin", "bilibili"])
})

test("only a successful video publishing task counts as a publication", () => {
  const task = { action: "upload-video", workId: "repo|sha", publishValues: { title: "标题" }, prepareOnly: false }
  assert.equal(isConfirmedPublication(task, "success"), true)
  for (const status of ["prepared", "failed", "cancelled", "interrupted", "running"]) {
    assert.equal(isConfirmedPublication(task, status), false)
  }
  assert.equal(isConfirmedPublication({ ...task, prepareOnly: true }, "success"), false)
  assert.equal(isConfirmedPublication({ ...task, action: "check" }, "success"), false)
})
