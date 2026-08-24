import { useEffect, useState } from "react";
import { useGetMe, useListAdminClients, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Eye, Loader2 } from "lucide-react";

const LAST_PREVIEW_KEY = "reclaimedmedia.lastPreviewClientId";

export function PreviewModeSwitch() {
  const { data: me } = useGetMe();
  const { data: clients } = useListAdminClients({});
  const qc = useQueryClient();
  const impersonating = !!(me as unknown as { impersonating?: boolean })?.impersonating;
  const currentClientId = impersonating ? me?.client?.id ?? null : null;

  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Initialize the picker: prefer current impersonation, then last-used, then first client.
  useEffect(() => {
    if (selectedId !== null) return;
    if (currentClientId) {
      setSelectedId(currentClientId);
      return;
    }
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(LAST_PREVIEW_KEY) : null;
    const storedId = stored ? parseInt(stored, 10) : NaN;
    const list = clients ?? [];
    if (Number.isFinite(storedId) && list.some((c) => c.id === storedId)) {
      setSelectedId(storedId);
    } else if (list.length > 0) {
      setSelectedId(list[0].id);
    }
  }, [clients, currentClientId, selectedId]);

  // Only super_admin / admin should see this control.
  const role = me?.role;
  if (role !== "super_admin" && role !== "admin") return null;

  const onToggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (next) {
        const id = selectedId ?? clients?.[0]?.id ?? null;
        if (!id) return;
        await api(`/admin/clients/${id}/impersonate`, { method: "POST" });
        try {
          window.localStorage.setItem(LAST_PREVIEW_KEY, String(id));
        } catch {
          /* ignore */
        }
        await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        // Navigate into the client portal so the toggle's effect is immediately visible.
        window.location.href = "/";
      } else {
        await api("/admin/exit-impersonate", { method: "POST" });
        await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
        window.location.href = "/admin";
      }
    } finally {
      setBusy(false);
    }
  };

  const onPick = (val: string) => {
    const id = parseInt(val, 10);
    if (!Number.isFinite(id)) return;
    setSelectedId(id);
    try {
      window.localStorage.setItem(LAST_PREVIEW_KEY, String(id));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-muted/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="preview-as-client-switch" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer">
          <Eye className="w-3.5 h-3.5" />
          Preview as client
        </label>
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
          <Switch
            id="preview-as-client-switch"
            checked={impersonating}
            disabled={busy || !selectedId}
            onCheckedChange={onToggle}
            aria-label="Toggle preview as client"
          />
        </div>
      </div>
      <Select
        value={selectedId ? String(selectedId) : ""}
        onValueChange={onPick}
        disabled={impersonating || busy}
      >
        <SelectTrigger className="h-8 text-xs bg-background">
          <SelectValue placeholder="Choose a client…" />
        </SelectTrigger>
        <SelectContent>
          {(clients ?? []).map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.firstName} {c.lastName} — {c.businessName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {impersonating && me?.client && (
        <p className="text-[11px] text-amber-700 leading-snug">
          Viewing as <strong>{me.client.firstName} {me.client.lastName}</strong>. Toggle off to return to admin.
        </p>
      )}
    </div>
  );
}
