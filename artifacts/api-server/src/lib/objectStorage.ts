import { Storage, File } from "@google-cloud/storage";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(
    file: File,
    cacheTtlSec: number = 3600,
    rangeHeader?: string,
  ): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";
    const totalSize = metadata.size ? Number(metadata.size) : undefined;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
      // Advertise range support so browsers/video players can seek and
      // resume large media downloads instead of aborting the connection.
      "Accept-Ranges": "bytes",
    };

    // Honour a single byte-range request (e.g. an inline <video> player or a
    // resumed download). Multi-range requests are not supported — we fall
    // back to serving the whole object.
    const range = totalSize !== undefined ? parseByteRange(rangeHeader, totalSize) : undefined;
    if (range) {
      const { start, end } = range;
      const nodeStream = file.createReadStream({ start, end });
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;
      headers["Content-Range"] = `bytes ${start}-${end}/${totalSize}`;
      headers["Content-Length"] = String(end - start + 1);
      return new Response(webStream, { status: 206, headers });
    }

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    if (totalSize !== undefined) {
      headers["Content-Length"] = String(totalSize);
    }
    return new Response(webStream, { headers });
  }

  // Return a short-lived signed URL the browser can hit DIRECTLY against
  // Google Cloud Storage. Large files (e.g. ~200MB client video uploads)
  // must not be streamed through the app: on Autoscale deployments the proxy
  // chokes on big streamed response bodies and the browser connection aborts
  // mid-download. A redirect to GCS sidesteps the app entirely and gives the
  // browser native HTTP Range / resume support.
  //
  // We bake an `attachment` Content-Disposition plus the friendly filename
  // onto the object's metadata before signing, because the Replit signing
  // sidecar does not accept a response-content-disposition override and GCS
  // rejects unsigned query params (SignatureDoesNotMatch).
  //
  // The disposition is deliberately STABLE per object (always `attachment`
  // with the same filename): every caller of these download endpoints links to
  // it as a plain anchor, so a download is always the desired behaviour. A
  // stable value means concurrent admin + client requests for the same object
  // converge on identical metadata, so there is no read-time race over what
  // Content-Disposition a previously-signed URL will serve.
  async getSignedDownloadUrl(
    file: File,
    opts: { filename: string; ttlSec?: number },
  ): Promise<string> {
    const safeName = opts.filename.replace(/[^\w.\- ]+/g, "_") || "file";
    const contentDisposition = `attachment; filename="${safeName}"`;
    // Only write metadata when it actually differs to avoid a needless
    // round-trip (and object churn) on every download.
    const [metadata] = await file.getMetadata();
    if (metadata.contentDisposition !== contentDisposition) {
      await file.setMetadata({ contentDisposition });
    }
    return signObjectURL({
      bucketName: file.bucket.name,
      objectName: file.name,
      method: "GET",
      ttlSec: opts.ttlSec ?? 900,
    });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    const bucket = objectStorageClient.bucket(bucketName);
    const objectFile = bucket.file(objectName);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

// Parse a single HTTP byte-range request header against the known object
// size. Returns null when the header is absent, malformed, a multi-range
// request, or not satisfiable — callers then serve the full object.
function parseByteRange(
  rangeHeader: string | undefined,
  totalSize: number,
): { start: number; end: number } | null {
  if (!rangeHeader || totalSize <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;
  if (rawStart === "") {
    // Suffix range: last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(totalSize - suffix, 0);
    end = totalSize - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? totalSize - 1 : Number(rawEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (end > totalSize - 1) end = totalSize - 1;
  }

  if (start > end || start < 0) return null;
  return { start, end };
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const json = (await response.json()) as { signed_url: string };
  return json.signed_url;
}
