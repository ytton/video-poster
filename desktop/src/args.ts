import type { CliNode, CliOption, FormValues } from "./types"
import { fieldLabel } from "./platforms"

export function findAction(schema: CliNode[], platform: string, action: string): CliNode | undefined {
  return schema.find(node => node.name === platform)?.actions.find(node => node.name === action)
}

export function buildArgs(platform: string, action: CliNode, values: FormValues): string[] {
  const args = [platform, action.name]
  for (const option of action.options) {
    if (option.name === "headless") {
      if (option.flags.includes("--headed")) args.push("--headed")
      continue
    }
    const value = values[option.name]
    if (option.kind === "boolean") {
      if (value === true && option.flags[0]) args.push(option.flags[0])
      continue
    }
    const items = Array.isArray(value) ? value.filter(Boolean) : typeof value === "string" && value.trim() ? [value.trim()] : []
    if (option.required && items.length === 0) throw new Error(`请填写 ${fieldLabel(option.name)}`)
    if (items.length === 0) continue
    if (option.flags[0]) args.push(option.flags[0])
    args.push(...items.map(item => option.kind === "schedule" ? item.replace("T", " ") : item))
  }
  return args
}

export function uniqueOptions(options: CliOption[]): CliOption[] {
  const seen = new Set<string>()
  return options.filter(option => {
    if (seen.has(option.name)) return false
    seen.add(option.name)
    return true
  })
}
