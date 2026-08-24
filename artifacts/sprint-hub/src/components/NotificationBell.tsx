import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Bell, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";

type Audience = "client" | "admin";

interface Item {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

interface Payload { unread: number; items: Item[] }

const POLL_MS = 30_000;

export function NotificationBell({ audience }: { audience: Audience }) {
  const base = audience === "admin" ? "/admin/notifications" : "/me/notifications";
  const [data, setData] = useState<Payload>({ unread: 0, items: [] });
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);

  const load = async () => {
    try {
      const d = await api<Payload>(base);
      setData(d);
    } catch {
      /* keep prior state */
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience]);

  const markRead = async (id: number) => {
    setData((d) => ({
      unread: Math.max(0, d.unread - (d.items.find((i) => i.id === id && !i.readAt) ? 1 : 0)),
      items: d.items.map((i) => i.id === id ? { ...i, readAt: new Date().toISOString() } : i),
    }));
    try { await api(`${base}/${id}/read`, { method: "POST" }); } catch { /* ignore */ }
  };

  const markAll = async () => {
    setData((d) => ({ unread: 0, items: d.items.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })) }));
    try { await api(`${base}/read-all`, { method: "POST" }); } catch { /* ignore */ }
  };

  const onItemClick = async (item: Item) => {
    if (!item.readAt) await markRead(item.id);
    setOpen(false);
    if (item.link) setLocation(item.link);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="w-5 h-5" />
          {data.unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center px-1">
              {data.unread > 9 ? "9+" : data.unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="text-sm font-medium">Notifications</div>
          {data.unread > 0 && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => void markAll()}>
              <Check className="w-3 h-3 mr-1" /> Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-[60vh]">
          {data.items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">You're all caught up.</div>
          ) : (
            <div className="divide-y">
              {data.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => void onItemClick(item)}
                  className={`w-full text-left px-3 py-2.5 hover:bg-muted/40 transition-colors ${!item.readAt ? "bg-primary/5" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    {!item.readAt && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{item.title}</div>
                      {item.body && (
                        <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5 whitespace-pre-wrap">{item.body}</div>
                      )}
                      <div className="text-[10px] text-muted-foreground mt-1">
                        {new Date(item.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
