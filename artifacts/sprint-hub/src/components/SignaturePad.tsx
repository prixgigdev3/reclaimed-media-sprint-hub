import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface SignatureResult {
  method: "drawn" | "typed";
  value: string; // dataUrl for drawn, string for typed
}

export function SignaturePad({
  onChange,
  defaultName,
  height = 160,
}: {
  onChange: (r: SignatureResult | null) => void;
  defaultName?: string;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [typed, setTyped] = useState(defaultName ?? "");
  const [tab, setTab] = useState<"draw" | "type">("draw");

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = height * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, [height]);

  const pos = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: React.PointerEvent) => {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setHasInk(true);
  };
  const onUp = () => {
    drawing.current = false;
    if (hasInk) {
      const url = canvasRef.current!.toDataURL("image/png");
      onChange({ method: "drawn", value: url });
    }
  };

  const clear = () => {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
    if (tab === "draw") onChange(null);
  };

  return (
    <div className="space-y-2">
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const t = v as "draw" | "type";
          setTab(t);
          if (t === "type" && typed.trim()) onChange({ method: "typed", value: typed.trim() });
          else if (t === "draw") {
            if (hasInk) onChange({ method: "drawn", value: canvasRef.current!.toDataURL("image/png") });
            else onChange(null);
          }
        }}
      >
        <TabsList>
          <TabsTrigger value="draw">Draw</TabsTrigger>
          <TabsTrigger value="type">Type</TabsTrigger>
        </TabsList>
        <TabsContent value="draw">
          <div className="border border-border rounded-md bg-white">
            <canvas
              ref={canvasRef}
              className="w-full touch-none cursor-crosshair"
              style={{ height }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={onUp}
            />
          </div>
          <div className="flex justify-end mt-2">
            <Button type="button" variant="ghost" size="sm" onClick={clear}>Clear</Button>
          </div>
        </TabsContent>
        <TabsContent value="type">
          <Input
            placeholder="Type your full name"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              if (e.target.value.trim()) onChange({ method: "typed", value: e.target.value.trim() });
              else onChange(null);
            }}
          />
          {typed && (
            <div
              className="mt-3 p-4 border border-border rounded-md bg-white text-3xl text-slate-800"
              style={{ fontFamily: "'Brush Script MT','Lucida Handwriting','Segoe Script',cursive" }}
            >
              {typed}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
