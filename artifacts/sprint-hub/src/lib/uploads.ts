import { api } from "./api";

export interface UploadResult {
  objectPath: string;
  name: string;
  size: number;
  contentType: string;
}

/**
 * Two-step upload: ask the server for a presigned URL, then PUT the file
 * directly to object storage. Returns the canonical /objects/... path that
 * the server can later reference (e.g. in episode_assets / client_uploads).
 */
export async function uploadFile(file: File): Promise<UploadResult> {
  const { uploadURL, objectPath } = await api<{ uploadURL: string; objectPath: string }>(
    "/storage/uploads/request-url",
    {
      method: "POST",
      json: {
        name: file.name,
        size: file.size,
        contentType: file.type || "application/octet-stream",
      },
    },
  );
  const put = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!put.ok) {
    throw new Error(`Upload failed (${put.status})`);
  }
  return {
    objectPath,
    name: file.name,
    size: file.size,
    contentType: file.type || "application/octet-stream",
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
