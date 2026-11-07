import { useMemo } from "react"
import { open, save } from "@tauri-apps/plugin-dialog"
import { FolderOpen, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { fieldLabel } from "../platforms"
import type { CliOption, FieldValue, FormValues } from "../types"

interface Props {
  options: CliOption[]
  values: FormValues
  onChange: (name: string, value: FieldValue) => void
  omit?: string[]
  accountNames?: string[]
}

function FileField({ option, value, onChange }: { option: CliOption; value: FieldValue; onChange: (value: FieldValue) => void }) {
  const values = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : []
  const choose = async () => {
    const result = option.name === "output" || option.name === "result"
      ? await save({ title: `选择${fieldLabel(option.name)}位置` })
      : await open({ multiple: option.kind === "files", directory: false, title: `选择${fieldLabel(option.name)}` })
    if (result == null) return
    const picked = Array.isArray(result) ? result : [result]
    onChange(option.kind === "files" ? [...values, ...picked] : picked[0])
  }
  return <div className="flex min-w-0 items-center gap-2">
    {option.kind === "files" ? <div className="flex min-w-0 flex-1 flex-wrap gap-1 rounded-md border border-input bg-white px-2 py-1 min-h-9">
      {values.length === 0 && <span className="text-muted-foreground self-center">未选择图片</span>}
      {values.map((item, index) => <span key={`${item}-${index}`} className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
        <span className="truncate">{item.split(/[\\/]/).pop()}</span>
        <button title="移除" type="button" onClick={() => onChange(values.filter((_, i) => i !== index))}><X className="size-3" /></button>
      </span>)}
    </div> : <Input className="min-w-0 flex-1 bg-white" value={typeof value === "string" ? value : ""} onChange={event => onChange(event.target.value)} placeholder="选择文件或输入绝对路径" />}
    <Button type="button" variant="outline" size="icon-sm" title="浏览文件" onClick={() => void choose()}><FolderOpen /></Button>
  </div>
}

export function CommandFields({ options, values, onChange, omit = [], accountNames = [] }: Props) {
  const visible = useMemo(() => options.filter(option => !omit.includes(option.name) && option.name !== "headless"), [options, omit])
  return <div className="grid grid-cols-1 gap-x-4 gap-y-3 lg:grid-cols-2">
    {visible.map(option => {
      const value = values[option.name] ?? (option.kind === "files" ? [] : option.kind === "boolean" ? false : "")
      const label = fieldLabel(option.name)
      if (option.kind === "boolean") return <label key={option.name} className="flex min-h-9 items-center gap-2 text-sm">
        <Checkbox checked={value === true} onCheckedChange={checked => onChange(option.name, checked === true)} />
        <span>{label}</span>
      </label>
      return <label key={option.name} className={`flex min-w-0 flex-col gap-1.5 ${option.name === "note" || option.kind === "files" ? "lg:col-span-2" : ""}`}>
        <span className="text-xs font-medium text-foreground">{label}{option.required && <span className="text-destructive"> *</span>}</span>
        {option.name === "account" && accountNames.length > 0 ?
          <Select value={typeof value === "string" ? value : ""} onValueChange={next => onChange(option.name, next)}>
            <SelectTrigger className="w-full bg-white"><SelectValue placeholder="选择账号" /></SelectTrigger>
            <SelectContent>{accountNames.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
          </Select>
          : option.kind === "choice" ?
          <Select value={typeof value === "string" ? value : ""} onValueChange={next => onChange(option.name, next)}>
            <SelectTrigger className="w-full bg-white"><SelectValue placeholder="请选择" /></SelectTrigger>
            <SelectContent>{option.choices.map(choice => <SelectItem key={choice} value={choice}>{choice}</SelectItem>)}</SelectContent>
          </Select>
          : option.kind === "file" || option.kind === "files" ?
          <FileField option={option} value={value} onChange={next => onChange(option.name, next)} />
          : option.name === "note" ? <Textarea value={typeof value === "string" ? value : ""} onChange={event => onChange(option.name, event.target.value)} rows={3} className="bg-white" />
          : option.kind === "schedule" ? <Input type="datetime-local" value={typeof value === "string" ? value : ""} onChange={event => onChange(option.name, event.target.value)} className="bg-white" />
          : <Input type={option.kind === "number" ? "number" : "text"} value={typeof value === "string" ? value : ""} onChange={event => onChange(option.name, event.target.value)} placeholder={option.help} className="bg-white" />}
      </label>
    })}
  </div>
}

export function AddFieldButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <Button variant="outline" size="sm" onClick={onClick}><Plus />{children}</Button>
}
