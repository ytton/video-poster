import { useSyncExternalStore } from "react"
import { ClipboardCopy, CircleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getFaults, subscribeFaults } from "../faults"

export function FaultDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const records = useSyncExternalStore(subscribeFaults, getFaults)
  const latest = records[0]
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[min(80vh,680px)] sm:max-w-2xl overflow-hidden grid grid-rows-[auto_1fr]">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2"><CircleAlert className="size-4 text-destructive" />软件故障日志</DialogTitle>
        <DialogDescription>{latest ? `${records.length} 类故障，最近一次发生于 ${new Date(latest.occurredAt).toLocaleString()}` : "暂无软件故障"}</DialogDescription>
      </DialogHeader>
      <div className="tool-scroll min-h-0 space-y-3 pr-1" tabIndex={0}>
        {records.map(item => <section key={item.id} className="rounded-md border border-border bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium break-words">{item.message}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.source === "native" ? "原生层" : "界面"} · {new Date(item.occurredAt).toLocaleString()} · {item.count} 次</p>
            </div>
            <Button variant="outline" size="icon-sm" title="复制诊断日志" onClick={() => void navigator.clipboard.writeText(item.details)}><ClipboardCopy /></Button>
          </div>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-xs">{item.details}</pre>
        </section>)}
      </div>
    </DialogContent>
  </Dialog>
}
