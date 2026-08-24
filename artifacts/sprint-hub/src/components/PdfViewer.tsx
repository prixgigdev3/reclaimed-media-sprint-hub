import { useEffect, useRef, useState } from "react";
import { pdfjs } from "@/lib/pdfjs";

export interface RenderedPage {
  pageNumber: number;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
}

export function PdfPage({
  pdfUrl,
  pageNumber,
  scale = 1.4,
  onRendered,
  overlay,
}: {
  pdfUrl: string;
  pageNumber: number;
  scale?: number;
  onRendered?: (info: { width: number; height: number; pageNumber: number }) => void;
  overlay?: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loadingTask = pdfjs.getDocument({ url: pdfUrl, withCredentials: true });
      const pdf = await loadingTask.promise;
      if (cancelled) return;
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      if (cancelled) return;
      setSize({ w: viewport.width, h: viewport.height });
      onRendered?.({ width: viewport.width, height: viewport.height, pageNumber });
    })().catch((e) => console.error("pdf render", e));
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, pageNumber, scale]);

  return (
    <div
      ref={containerRef}
      className="relative inline-block bg-white shadow border border-border"
      style={{ width: size?.w, height: size?.h }}
    >
      <canvas ref={canvasRef} className="block" />
      {size && <div className="absolute inset-0">{overlay}</div>}
    </div>
  );
}
