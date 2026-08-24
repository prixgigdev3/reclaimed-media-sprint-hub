import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { FileText, ExternalLink, Download, Folder, ChevronRight, Home } from "lucide-react";
import { BRAND_NAME } from "@/lib/brand";

interface Doc {
  id: number;
  parentId: number | null;
  title: string;
  description: string;
  kind: "folder" | "file" | "link";
  linkUrl: string | null;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}

interface FolderPayload {
  folder: Doc | null;
  ancestors: Doc[];
  items: Doc[];
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ClientDocuments() {
  const [folderId, setFolderId] = useState<number | null>(null);
  const { data, isLoading } = useQuery<FolderPayload>({
    queryKey: ["client-documents", folderId],
    queryFn: () => api(`/me/documents${folderId ? `?parentId=${folderId}` : ""}`),
  });

  const items = data?.items ?? [];
  const ancestors = data?.ancestors ?? [];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-secondary">Documents</h1>
        <p className="text-muted-foreground mt-1">
          Resources, research, and links shared with you by your {BRAND_NAME} team.
        </p>
      </div>

      <div className="flex items-center gap-1 text-sm text-muted-foreground flex-wrap">
        <button
          onClick={() => setFolderId(null)}
          className="flex items-center gap-1 hover:text-secondary"
          data-testid="docs-breadcrumb-root"
        >
          <Home className="w-3.5 h-3.5" /> All documents
        </button>
        {ancestors.map((a) => (
          <span key={a.id} className="flex items-center gap-1">
            <ChevronRight className="w-3.5 h-3.5" />
            <button
              onClick={() => setFolderId(a.id)}
              className={`hover:text-secondary ${a.id === folderId ? "text-secondary font-medium" : ""}`}
            >
              {a.title}
            </button>
          </span>
        ))}
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {folderId ? "This folder is empty." : "No documents have been shared with you yet."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((d) => (
            <Card key={d.id}>
              <CardContent className="py-4 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`mt-0.5 w-9 h-9 rounded-md grid place-items-center shrink-0 ${d.kind === "folder" ? "bg-warning/15 text-warning" : "bg-primary/10 text-primary"}`}>
                    {d.kind === "folder" ? <Folder className="w-4 h-4" /> : d.kind === "link" ? <ExternalLink className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0">
                    {d.kind === "folder" ? (
                      <button
                        onClick={() => setFolderId(d.id)}
                        className="font-medium text-secondary truncate hover:text-primary text-left"
                      >
                        {d.title}
                      </button>
                    ) : (
                      <div className="font-medium text-secondary truncate">{d.title}</div>
                    )}
                    {d.description && (
                      <div className="text-sm text-muted-foreground mt-0.5">{d.description}</div>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">
                      Added {new Date(d.createdAt).toLocaleDateString()}
                      {d.kind === "file" && d.originalFilename && (
                        <> · {d.originalFilename}{d.sizeBytes ? ` (${formatSize(d.sizeBytes)})` : ""}</>
                      )}
                    </div>
                  </div>
                </div>
                <div className="shrink-0">
                  {d.kind === "folder" ? (
                    <Button size="sm" variant="outline" onClick={() => setFolderId(d.id)}>
                      Open
                    </Button>
                  ) : d.kind === "link" && d.linkUrl ? (
                    <a href={d.linkUrl} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline">
                        <ExternalLink className="w-3 h-3 mr-2" /> Open
                      </Button>
                    </a>
                  ) : (
                    <a href={`/api/me/documents/${d.id}/download`}>
                      <Button size="sm" variant="outline">
                        <Download className="w-3 h-3 mr-2" /> Download
                      </Button>
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
