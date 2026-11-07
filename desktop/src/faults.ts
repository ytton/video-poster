export interface FaultRecord {
  id: string
  occurredAt: string
  source: "frontend" | "native"
  message: string
  details: string
  count: number
}

const faults: FaultRecord[] = []
const listeners = new Set<() => void>()
let snapshot: FaultRecord[] = []

export function redact(text: string): string {
  return text.replace(/(authorization|cookie|token|password|secret|api[_-]?key)(\s*[=:]\s*)([^\s,;]+)/gi, "$1$2[已隐藏]")
}

export function reportFault(source: FaultRecord["source"], error: unknown): void {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  const details = error instanceof Error ? error.stack || raw : raw
  const message = redact(raw).slice(0, 500)
  const previous = faults.find(item => item.source === source && item.message === message)
  if (previous) {
    previous.count += 1
    previous.occurredAt = new Date().toISOString()
  } else {
    faults.unshift({ id: crypto.randomUUID(), occurredAt: new Date().toISOString(), source, message, details: redact(details).slice(0, 10000), count: 1 })
    faults.splice(30)
  }
  snapshot = faults.map(item => ({ ...item }))
  listeners.forEach(listener => listener())
}

export function subscribeFaults(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getFaults(): FaultRecord[] {
  return snapshot
}

export function installFaultHandlers(): void {
  window.addEventListener("error", event => reportFault("frontend", event.error || event.message))
  window.addEventListener("unhandledrejection", event => reportFault("frontend", event.reason))
}
