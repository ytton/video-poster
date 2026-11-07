export type OptionKind = "boolean" | "files" | "file" | "schedule" | "number" | "choice" | "text"

export interface CliOption {
  name: string
  flags: string[]
  kind: OptionKind
  required: boolean
  help: string
  choices: string[]
  multiple: boolean
}

export interface CliNode {
  name: string
  description: string
  actions: CliNode[]
  options: CliOption[]
}

export interface RuntimeInfo {
  ready: boolean
  root: string
  cliPath: string
  message: string
}

export interface AccountRecord {
  id: string
  repoRoot: string
  platform: string
  name: string
  createdAt: string
}

export type AccountStatus = "unknown" | "checking" | "valid" | "invalid" | "error" | "logging-in"
export type TaskStatus = "queued" | "running" | "success" | "failed" | "cancelled" | "interrupted"

export interface TaskRecord {
  id: string
  repoRoot: string
  platform: string
  action: string
  accountName?: string
  status: TaskStatus
  startedAt: string
  finishedAt?: string
  exitCode?: number | null
  lines: string[]
  message?: string
}

export interface TaskLineEvent {
  taskId: string
  stream: "stdout" | "stderr"
  text: string
}

export interface TaskFinishedEvent {
  taskId: string
  exitCode: number | null
  cancelled: boolean
  message: string
}

export type FieldValue = string | boolean | string[]
export type FormValues = Record<string, FieldValue>
