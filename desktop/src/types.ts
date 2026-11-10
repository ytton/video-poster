export interface AccountRecord {
  id: string
  repoRoot: string
  platform: string
  name: string
  createdAt: string
  order?: number
}

export type TaskStatus = "queued" | "running" | "prepared" | "verified" | "success" | "failed" | "cancelled" | "interrupted"

export interface WorkContent {
  title: string
  description: string
  tags: string
  platforms?: string[]
  thumbnailLandscape: string
  thumbnailPortrait: string
  origin: string
  mark: string
  schedule: string
}

export interface WorkPublication {
  taskId: string
  platform: string
  accountName: string
  publishedAt: string
  values: FormValues
  evidence?: { recordId: string; recordUrl: string; title: string }
}

export interface WorkRecord {
  id: string
  repoRoot: string
  sha256: string
  bytes: number
  filePath: string
  content: WorkContent
  createdAt: string
  updatedAt: string
  publications: WorkPublication[]
}

export interface TaskRecord {
  id: string
  repoRoot: string
  platform: string
  action: string
  accountName?: string
  workTitle?: string
  workId?: string
  publishValues?: FormValues
  prepareOnly?: boolean
  status: TaskStatus
  startedAt: string
  finishedAt?: string
  exitCode?: number | null
  lines: string[]
  message?: string
  evidence?: { recordId: string; recordUrl: string; title: string }
}

export type FieldValue = string | boolean | string[]
export type FormValues = Record<string, FieldValue>
