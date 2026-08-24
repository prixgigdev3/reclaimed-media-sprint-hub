import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Eye, X } from "lucide-react";

export function ImpersonationBanner() {
  const { data: me } = useGetMe();
  const qc = useQueryClient();
  const impersonating = !!(me as unknown as { impersonating?: boolean })?.impersonating;
  if (!impersonating || !me?.client) return null;

  const exit = async () => {
    await api("/admin/exit-impersonate", { method: "POST" });
    await qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
    window.location.href = "/admin/clients";
  };

  return (
    <div className="bg-amber-100 border-b border-amber-300 text-amber-900 px-4 py-2 flex items-center justify-between gap-4 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Eye className="w-4 h-4 shrink-0" />
        <span className="truncate">
          Previewing as <strong>{me.client.firstName} {me.client.lastName}</strong> ({me.client.email})
        </span>
      </div>
      <Button size="sm" variant="outline" className="bg-white border-amber-400 text-amber-900 hover:bg-amber-50" onClick={exit}>
        <X className="w-3.5 h-3.5 mr-1" /> Exit preview
      </Button>
    </div>
  );
}
