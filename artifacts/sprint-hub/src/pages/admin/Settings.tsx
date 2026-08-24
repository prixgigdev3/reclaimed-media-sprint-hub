import { useGetAdminSettings, useUpdateAdminSettings, useRegenerateAdminApiKey, getGetAdminSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { BRAND_NAME } from "@/lib/brand";
import { Copy, Save, Eye, EyeOff, RefreshCw } from "lucide-react";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export function AdminSettings() {
  const queryClient = useQueryClient();
  const { data: me } = useGetMe();
  const isSuperAdmin = me?.role === "super_admin";
  const isViewer = me?.role === "viewer";

  const { data: settings, isLoading } = useGetAdminSettings();
  const [showApiKey, setShowApiKey] = useState(false);

  const updateMutation = useUpdateAdminSettings({
    mutation: {
      onSuccess: () => {
        toast.success("Settings updated");
        queryClient.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
      }
    }
  });

  const regenMutation = useRegenerateAdminApiKey({
    mutation: {
      onSuccess: () => {
        toast.success("API Key regenerated");
        queryClient.invalidateQueries({ queryKey: getGetAdminSettingsQueryKey() });
      }
    }
  });

  if (isLoading || !settings) return <Skeleton className="h-screen w-full" />;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if(isViewer) return;
    const fd = new FormData(e.currentTarget);
    updateMutation.mutate({
      data: {
        businessManagerId: fd.get("bmId") as string,
        notifyOnIcp: fd.get("notifyOnIcp") === "true",
        notifyIcpEmail: fd.get("notifyIcpEmail") as string,
        notifyOnFirstLogin: fd.get("notifyOnFirstLogin") === "true",
        notifyFirstLoginEmail: fd.get("notifyFirstLoginEmail") as string,
        notifyOnAllComplete: fd.get("notifyOnAllComplete") === "true",
        notifyAllCompleteEmail: fd.get("notifyAllCompleteEmail") as string,
        supportEmail: fd.get("supportEmail") as string,
      }
    });
  };

  return (
    <div className="max-w-4xl space-y-8 animate-in fade-in duration-500 pb-20">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-secondary">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure integrations and agency notifications.</p>
      </div>

      <Card className="border-border/50 shadow-sm">
        <CardHeader>
          <CardTitle>Integrations</CardTitle>
          <CardDescription>Connect {BRAND_NAME} Hub to external tools like GoHighLevel.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Webhook URL (Incoming)</Label>
            <div className="flex gap-2">
              <Input value={settings.webhookUrl} readOnly className="font-mono text-sm bg-muted/30" />
              <Button variant="outline" onClick={() => handleCopy(settings.webhookUrl)}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Send POST requests here from GHL to create clients automatically.</p>
          </div>

          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="flex gap-2">
              <Input 
                value={showApiKey ? settings.apiKey : `phk_${"•".repeat(24)}`} 
                readOnly 
                className="font-mono text-sm bg-muted/30" 
              />
              <Button variant="outline" onClick={() => setShowApiKey(!showApiKey)}>
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
              <Button variant="outline" onClick={() => handleCopy(settings.apiKey)}>
                <Copy className="w-4 h-4" />
              </Button>
              {isSuperAdmin && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive">
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Regenerate API Key?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will immediately invalidate the existing key. Any external tools (like GHL webhooks) using the old key will fail until updated.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => regenMutation.mutate()} className="bg-destructive text-destructive-foreground">
                        Regenerate
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit}>
        <Card className="border-border/50 shadow-sm">
          <CardHeader>
            <CardTitle>Agency Profile & Notifications</CardTitle>
            <CardDescription>Set defaults and where alerts should be routed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <div className="space-y-2 max-w-sm">
              <Label>Meta Business Manager ID</Label>
              <Input name="bmId" defaultValue={settings.businessManagerId} readOnly={isViewer} />
            </div>

            <div className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground border-b pb-2">Event Notifications</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                {/* ICP */}
                <div className="space-y-3 bg-muted/20 p-4 rounded-lg border border-border/50">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold text-secondary">ICP Submitted</Label>
                    <input type="hidden" name="notifyOnIcp" value={settings.notifyOnIcp ? "true" : "false"} />
                    <Switch defaultChecked={settings.notifyOnIcp} disabled={isViewer} onCheckedChange={(c) => {
                      const el = document.querySelector('input[name="notifyOnIcp"]') as HTMLInputElement;
                      if(el) el.value = c ? "true" : "false";
                    }}/>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Recipient Email</Label>
                    <Input name="notifyIcpEmail" defaultValue={settings.notifyIcpEmail} type="email" readOnly={isViewer} />
                  </div>
                </div>

                {/* First Login */}
                <div className="space-y-3 bg-muted/20 p-4 rounded-lg border border-border/50">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold text-secondary">Client First Login</Label>
                    <input type="hidden" name="notifyOnFirstLogin" value={settings.notifyOnFirstLogin ? "true" : "false"} />
                    <Switch defaultChecked={settings.notifyOnFirstLogin} disabled={isViewer} onCheckedChange={(c) => {
                      const el = document.querySelector('input[name="notifyOnFirstLogin"]') as HTMLInputElement;
                      if(el) el.value = c ? "true" : "false";
                    }}/>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Recipient Email</Label>
                    <Input name="notifyFirstLoginEmail" defaultValue={settings.notifyFirstLoginEmail} type="email" readOnly={isViewer} />
                  </div>
                </div>

                {/* Support Email */}
                <div className="space-y-3 bg-muted/20 p-4 rounded-lg border border-border/50 md:col-span-2">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold text-secondary">Client Support Inbox</Label>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Recipient Email (where /support form goes)</Label>
                    <Input name="supportEmail" defaultValue={settings.supportEmail} type="email" placeholder="support@reclaimedmedia.com" readOnly={isViewer} />
                  </div>
                </div>

                {/* All Complete */}
                <div className="space-y-3 bg-muted/20 p-4 rounded-lg border border-border/50">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold text-secondary">All Modules Complete</Label>
                    <input type="hidden" name="notifyOnAllComplete" value={settings.notifyOnAllComplete ? "true" : "false"} />
                    <Switch defaultChecked={settings.notifyOnAllComplete} disabled={isViewer} onCheckedChange={(c) => {
                      const el = document.querySelector('input[name="notifyOnAllComplete"]') as HTMLInputElement;
                      if(el) el.value = c ? "true" : "false";
                    }}/>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Recipient Email</Label>
                    <Input name="notifyAllCompleteEmail" defaultValue={settings.notifyAllCompleteEmail} type="email" readOnly={isViewer} />
                  </div>
                </div>
              </div>
            </div>

            {!isViewer && (
              <Button type="submit" size="lg" disabled={updateMutation.isPending}>
                <Save className="w-4 h-4 mr-2" /> Save Settings
              </Button>
            )}
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
