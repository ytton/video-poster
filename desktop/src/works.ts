import type { TaskRecord, TaskStatus } from "./types"

export function isConfirmedPublication(task: TaskRecord, status: TaskStatus): boolean {
  return status === "success" && task.action === "upload-video" && !task.prepareOnly
    && !!task.workId && !!task.publishValues
}
