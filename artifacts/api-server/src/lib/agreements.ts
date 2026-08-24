import { promisify } from "util";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import libreConvert from "libreoffice-convert";
import { ObjectStorageService } from "./objectStorage";
import { ObjectPermission } from "./objectAcl";
import type { AgreementField, AgreementFieldValue, AgreementPlaceholder } from "@workspace/db";
import { BRAND_NAME, BRAND_APP_NAME } from "./brand";
// Reclaimed Media wordmark used as the default header on builder-rendered PDFs
// when the template doesn't supply its own logo. esbuild's `base64` loader
// inlines the asset as a base64 string at build time so we don't have to ship
// the file alongside dist/. Decoded once at module load.
import defaultLogoBase64 from "../../assets/reclaimed_media_logo.png";
const defaultLogoBytes: Buffer = Buffer.from(defaultLogoBase64, "base64");

const convertAsync = promisify(libreConvert.convert);
const objectStorage = new ObjectStorageService();

export async function convertDocxToPdf(buffer: Buffer): Promise<Buffer> {
  const out = await convertAsync(buffer, ".pdf", undefined);
  return out as Buffer;
}

export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buffer);
  return doc.getPageCount();
}

export async function uploadPdfBuffer(buffer: Buffer, ownerId: string): Promise<string> {
  const uploadUrl = await objectStorage.getObjectEntityUploadURL();
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: new Uint8Array(buffer),
  });
  if (!putRes.ok) {
    throw new Error(`Upload failed: ${putRes.status} ${await putRes.text()}`);
  }
  const objectPath = await objectStorage.trySetObjectEntityAclPolicy(uploadUrl, {
    owner: ownerId,
    visibility: "private",
  });
  return objectPath;
}

export async function downloadPdf(objectPath: string): Promise<Buffer> {
  const file = await objectStorage.getObjectEntityFile(objectPath);
  const [bytes] = await file.download();
  return bytes;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i);
  if (!m) return null;
  return { mime: m[1].toLowerCase(), bytes: Buffer.from(m[2], "base64") };
}

/**
 * Render the field values onto the PDF and return the flattened bytes.
 * Coordinates are stored as fractions of page width/height in the field
 * (0..1 from top-left like CSS). pdf-lib uses bottom-left origin.
 */
export async function renderSignedPdf(
  templateBuffer: Buffer,
  fields: AgreementField[],
  values: AgreementFieldValue[],
): Promise<Buffer> {
  const pdf = await PDFDocument.load(templateBuffer);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cursive = await pdf.embedFont(StandardFonts.TimesRomanItalic);

  const valuesById = new Map(values.map((v) => [v.fieldId, v]));

  for (const field of fields) {
    const v = valuesById.get(field.id);
    if (!v || !v.value) continue;
    const pageIdx = field.page - 1;
    if (pageIdx < 0 || pageIdx >= pdf.getPageCount()) continue;
    const page = pdf.getPage(pageIdx);
    const { width: pw, height: ph } = page.getSize();

    // field.x/y/width/height are fractions 0..1 from top-left (frontend convention)
    const xPx = field.x * pw;
    const yTopPx = field.y * ph;
    const wPx = field.width * pw;
    const hPx = field.height * ph;
    const yBottom = ph - yTopPx - hPx; // pdf-lib bottom-left origin

    if ((field.type === "signature" || field.type === "initial") && v.signatureMethod === "drawn") {
      const img = dataUrlToBytes(v.value);
      if (img) {
        const embedded = img.mime === "image/png" ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes);
        const ratio = embedded.width / embedded.height;
        let drawW = wPx;
        let drawH = wPx / ratio;
        if (drawH > hPx) {
          drawH = hPx;
          drawW = hPx * ratio;
        }
        const dx = xPx + (wPx - drawW) / 2;
        const dy = ph - yTopPx - drawH - (hPx - drawH) / 2;
        page.drawImage(embedded, { x: dx, y: dy, width: drawW, height: drawH });
        continue;
      }
    }

    // typed text rendering
    const text = v.value;
    const isSig = field.type === "signature" || field.type === "initial";
    const font = isSig ? cursive : field.type === "name" ? helvB : helv;
    let size = isSig ? Math.min(hPx * 0.7, 28) : Math.min(hPx * 0.65, 14);
    if (size < 6) size = 6;
    let textW = font.widthOfTextAtSize(text, size);
    while (textW > wPx && size > 6) {
      size -= 1;
      textW = font.widthOfTextAtSize(text, size);
    }
    const tx = xPx + Math.max(0, (wPx - textW) / 2);
    const ty = yBottom + (hPx - size) / 2 + size * 0.1;
    page.drawText(text, { x: tx, y: ty, size, font, color: rgb(0.05, 0.1, 0.25) });
  }

  // Audit footer on last page
  const last = pdf.getPage(pdf.getPageCount() - 1);
  const stamp = `Signed via ${BRAND_APP_NAME} on ${new Date().toISOString()}`;
  last.drawText(stamp, { x: 24, y: 12, size: 8, font: helv, color: rgb(0.4, 0.4, 0.4) });

  const out = await pdf.save();
  return Buffer.from(out);
}

// =============== BUILDER (PLATFORM-AUTHORED) AGREEMENTS ===============

const TOKEN_RE = /\{\{\s*([a-zA-Z][\w]*)(?::([^}]+))?\s*\}\}/g;

/**
 * Extract placeholders from a builder body. Order is preserved (first occurrence
 * wins). System tokens like name/businessName/date are auto-typed; anything
 * declared as `{{text:Label}}` becomes a free-text input with that label, and
 * `{{initial:section}}` becomes an initial box. Unknown token names default to
 * a text input with the key as the label.
 *
 * `existing` lets the caller preserve admin-set role/defaultValue overrides
 * across body edits (we re-derive key/type/label from the body but keep
 * any matching admin-configured role and default).
 */
export function extractPlaceholders(
  body: string,
  existing: AgreementPlaceholder[] = [],
): AgreementPlaceholder[] {
  const existingByKey = new Map(existing.map((p) => [p.key, p]));
  const out: AgreementPlaceholder[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(body)) !== null) {
    const rawKey = m[1];
    const arg = m[2]?.trim();
    let key = rawKey;
    let type: AgreementPlaceholder["type"] = "text";
    let label = rawKey;
    if (rawKey === "name") {
      type = "name";
      label = "Full name";
    } else if (rawKey === "businessName") {
      type = "businessName";
      label = "Business name";
    } else if (rawKey === "date") {
      type = "date";
      label = "Date";
    } else if (rawKey === "initial") {
      type = "initial";
      key = arg ? `initial_${slug(arg)}` : "initial";
      label = arg ? `Initial — ${arg}` : "Initial";
    } else if (rawKey === "text") {
      // {{text:Label}} – key is derived from the label so distinct labels become distinct fields.
      type = "text";
      const lab = arg || "Field";
      key = `text_${slug(lab)}`;
      label = lab;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const prior = existingByKey.get(key);
    out.push({
      key,
      label,
      type,
      required: type !== "date",
      role: prior?.role ?? "client",
      ...(prior?.defaultValue ? { defaultValue: prior.defaultValue } : {}),
    });
  }
  return out;
}

/**
 * Apply admin-configured defaults onto a values map. Admin-role placeholders
 * always overwrite (the client can't change them); client-role defaults only
 * fill in when the client hasn't supplied anything.
 */
export function applyPlaceholderDefaults(
  placeholders: AgreementPlaceholder[],
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...values };
  for (const p of placeholders) {
    if (p.role === "admin") {
      if (p.defaultValue) out[p.key] = p.defaultValue;
      else if (!out[p.key]) out[p.key] = "";
    } else if (p.defaultValue && !out[p.key]) {
      out[p.key] = p.defaultValue;
    }
  }
  return out;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "field";
}

/** Split a body into segments, alternating literal text and placeholder refs. */
export type BodySegment =
  | { kind: "text"; text: string }
  | { kind: "placeholder"; key: string };

export function splitBody(body: string, placeholders: AgreementPlaceholder[]): BodySegment[] {
  // Build a key resolver that mirrors extractPlaceholders.
  const resolve = (rawKey: string, arg?: string): string | null => {
    if (rawKey === "name" || rawKey === "businessName" || rawKey === "date") return rawKey;
    if (rawKey === "initial") return arg ? `initial_${slug(arg)}` : "initial";
    if (rawKey === "text") return arg ? `text_${slug(arg)}` : null;
    return rawKey;
  };
  const keys = new Set(placeholders.map((p) => p.key));
  const out: BodySegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(body)) !== null) {
    if (m.index > last) out.push({ kind: "text", text: body.slice(last, m.index) });
    const key = resolve(m[1], m[2]?.trim());
    if (key && keys.has(key)) {
      out.push({ kind: "placeholder", key });
    } else {
      // Unknown token – render literally so the admin can spot the typo.
      out.push({ kind: "text", text: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ kind: "text", text: body.slice(last) });
  return out;
}

type RenderCtx = {
  pdf: PDFDocument;
  page: PDFPage;
  y: number;
  pageW: number;
  pageH: number;
  margin: number;
  helv: PDFFont;
  helvB: PDFFont;
  cursive: PDFFont;
};

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 56;
const BODY_SIZE = 11;
const LINE_GAP = 4;

function newPage(ctx: RenderCtx): RenderCtx {
  const page = ctx.pdf.addPage([PAGE_W, PAGE_H]);
  return { ...ctx, page, y: PAGE_H - MARGIN };
}

function ensureSpace(ctx: RenderCtx, h: number): RenderCtx {
  if (ctx.y - h < MARGIN) return newPage(ctx);
  return ctx;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line + w;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line.trim()) {
      lines.push(line.replace(/\s+$/, ""));
      line = w.replace(/^\s+/, "");
    } else {
      line = candidate;
    }
  }
  if (line.trim()) lines.push(line.replace(/\s+$/, ""));
  return lines.length > 0 ? lines : [""];
}

function drawWrappedLine(
  ctxIn: RenderCtx,
  text: string,
  opts: { font: PDFFont; size: number; color?: ReturnType<typeof rgb>; bold?: boolean },
): RenderCtx {
  let ctx = ctxIn;
  const maxW = ctx.pageW - ctx.margin * 2;
  const lines = wrapText(text, opts.font, opts.size, maxW);
  for (const line of lines) {
    ctx = ensureSpace(ctx, opts.size + LINE_GAP);
    ctx.page.drawText(line, {
      x: ctx.margin,
      y: ctx.y - opts.size,
      size: opts.size,
      font: opts.font,
      color: opts.color ?? rgb(0.1, 0.12, 0.16),
    });
    ctx = { ...ctx, y: ctx.y - opts.size - LINE_GAP };
  }
  return ctx;
}

// =============== INLINE RICH-TEXT LAYOUT ===============
//
// We support **bold** runs and inline images (drawn initials) inside body
// paragraphs. Build a list of "atoms" (word | space | image), measure each,
// then greedy-wrap into lines.

type Atom =
  | { kind: "word"; text: string; bold: boolean; w: number; h: number }
  | { kind: "space"; w: number; h: number }
  | { kind: "image"; img: PDFImage; w: number; h: number }
  | { kind: "blank"; w: number; h: number; underline: boolean };

const BOLD_RE = /\*\*([^*]+)\*\*/g;

/** Strip markdown bold markers (`**foo**` → `foo`) for plain-text contexts. */
export function stripMarkdown(s: string): string {
  return s.replace(BOLD_RE, "$1").replace(/\*([^*]+)\*/g, "$1");
}

function pushTextAtoms(
  atoms: Atom[],
  text: string,
  bold: boolean,
  font: PDFFont,
  fontB: PDFFont,
  size: number,
) {
  // Tokenize on whitespace, keep separators.
  const tokens = text.split(/(\s+)/);
  for (const tok of tokens) {
    if (!tok) continue;
    if (/^\s+$/.test(tok)) {
      const space = (bold ? fontB : font).widthOfTextAtSize(" ", size);
      atoms.push({ kind: "space", w: space, h: size });
    } else {
      const f = bold ? fontB : font;
      atoms.push({ kind: "word", text: tok, bold, w: f.widthOfTextAtSize(tok, size), h: size });
    }
  }
}

function pushBoldAwareText(
  atoms: Atom[],
  text: string,
  font: PDFFont,
  fontB: PDFFont,
  size: number,
) {
  let last = 0;
  let m: RegExpExecArray | null;
  BOLD_RE.lastIndex = 0;
  while ((m = BOLD_RE.exec(text)) !== null) {
    if (m.index > last) pushTextAtoms(atoms, text.slice(last, m.index), false, font, fontB, size);
    pushTextAtoms(atoms, m[1], true, font, fontB, size);
    last = m.index + m[0].length;
  }
  if (last < text.length) pushTextAtoms(atoms, text.slice(last), false, font, fontB, size);
}

async function buildParagraphAtoms(
  pdf: PDFDocument,
  text: string,
  placeholders: AgreementPlaceholder[],
  values: Record<string, string>,
  font: PDFFont,
  fontB: PDFFont,
  size: number,
): Promise<Atom[]> {
  // Two-stage substitution so bold markers (**…**) survive placeholder
  // boundaries:
  //
  //   1. Inline every plain-text placeholder value directly into the
  //      paragraph source. This is the critical fix — the previous
  //      implementation split the body on placeholders FIRST and then
  //      ran the bold tokenizer on each segment in isolation. Any bold
  //      span that contained a `{{date}}` / `{{name}}` / `{{businessName}}`
  //      token therefore lost its `**` pair (one half landed in segment N
  //      and the other in segment N+2) and the asterisks rendered as
  //      literal characters in the exported PDF.
  //
  //   2. Reserve sentinels only for the cases that can't be inlined as
  //      plain text — drawn-initial images (we have to embed binary into
  //      the page) and unfilled placeholders (need an underlined blank
  //      space). Those go through the segment loop below.
  const phByKey = new Map(placeholders.map((p) => [p.key, p]));
  type Special = { kind: "blank"; size: number } | { kind: "image"; img: PDFImage };
  const specials: Special[] = [];
  const SENTINEL = (i: number) => `\u2063SP${i}\u2063`; // invisible separators around an index
  const SENTINEL_RE = /\u2063SP(\d+)\u2063/g;

  const segs = splitBody(text, placeholders);
  let inlined = "";
  for (const seg of segs) {
    if (seg.kind === "text") {
      inlined += seg.text;
      continue;
    }
    const ph = phByKey.get(seg.key);
    const v = values[seg.key];
    if (!v) {
      const reserveSize = ph?.type === "initial" ? size * 2.4 : size * 7;
      specials.push({ kind: "blank", size: reserveSize });
      inlined += SENTINEL(specials.length - 1);
      continue;
    }
    if (v.startsWith("data:image/") && ph?.type === "initial") {
      const bytes = dataUrlToBytes(v);
      if (bytes) {
        try {
          const img =
            bytes.mime === "image/png"
              ? await pdf.embedPng(bytes.bytes)
              : await pdf.embedJpg(bytes.bytes);
          specials.push({ kind: "image", img });
          inlined += SENTINEL(specials.length - 1);
          continue;
        } catch {
          /* fall through to underlined blank */
        }
      }
      specials.push({ kind: "blank", size: size * 2.4 });
      inlined += SENTINEL(specials.length - 1);
      continue;
    }
    // Plain string value (name / businessName / date / text). Inline it as
    // text so any surrounding **bold** markers wrap it correctly.
    inlined += v;
  }

  // Now split the inlined source on the special-only sentinels and run the
  // bold tokenizer on the surrounding text. This is what makes bold spans
  // that originally contained placeholders render correctly in the PDF.
  const atoms: Atom[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  SENTINEL_RE.lastIndex = 0;
  while ((m = SENTINEL_RE.exec(inlined)) !== null) {
    if (m.index > last) {
      pushBoldAwareText(atoms, inlined.slice(last, m.index), font, fontB, size);
    }
    const sp = specials[parseInt(m[1], 10)];
    if (sp.kind === "image") {
      const h = size * 1.4;
      const w = (sp.img.width / sp.img.height) * h;
      atoms.push({ kind: "image", img: sp.img, w, h });
    } else {
      atoms.push({ kind: "blank", w: sp.size, h: size, underline: true });
    }
    last = m.index + m[0].length;
  }
  if (last < inlined.length) {
    pushBoldAwareText(atoms, inlined.slice(last), font, fontB, size);
  }
  return atoms;
}

function lineHeight(line: Atom[], baseSize: number): number {
  let h = baseSize;
  for (const a of line) if (a.h > h) h = a.h;
  return h;
}

function lineWidth(line: Atom[]): number {
  let w = 0;
  for (const a of line) w += a.w;
  return w;
}

function drawAtoms(
  ctxIn: RenderCtx,
  atoms: Atom[],
  size: number,
  color = rgb(0.1, 0.12, 0.16),
): RenderCtx {
  let ctx = ctxIn;
  const maxW = ctx.pageW - ctx.margin * 2;

  // Greedy-wrap into lines, dropping leading spaces.
  const lines: Atom[][] = [];
  let current: Atom[] = [];
  let curW = 0;
  for (const a of atoms) {
    if (a.kind === "space" && current.length === 0) continue; // drop leading space
    if (curW + a.w > maxW && current.length > 0) {
      lines.push(current);
      current = a.kind === "space" ? [] : [a];
      curW = a.kind === "space" ? 0 : a.w;
    } else {
      current.push(a);
      curW += a.w;
    }
  }
  if (current.length > 0) lines.push(current);

  for (const line of lines) {
    // Trim trailing spaces.
    while (line.length > 0 && line[line.length - 1].kind === "space") line.pop();
    const h = lineHeight(line, size);
    ctx = ensureSpace(ctx, h + LINE_GAP);
    let x = ctx.margin;
    const baselineY = ctx.y - h;
    for (const a of line) {
      if (a.kind === "word") {
        const f = a.bold ? ctx.helvB : ctx.helv;
        ctx.page.drawText(a.text, { x, y: baselineY + (h - a.h) * 0.2, size, font: f, color });
        x += a.w;
      } else if (a.kind === "space") {
        x += a.w;
      } else if (a.kind === "image") {
        ctx.page.drawImage(a.img, { x, y: baselineY - (a.h - size) * 0.2, width: a.w, height: a.h });
        x += a.w;
      } else {
        // blank
        if (a.underline) {
          ctx.page.drawLine({
            start: { x, y: baselineY + 1 },
            end: { x: x + a.w, y: baselineY + 1 },
            thickness: 0.6,
            color: rgb(0.55, 0.55, 0.6),
          });
        }
        x += a.w;
      }
    }
    ctx = { ...ctx, y: ctx.y - h - LINE_GAP };
  }
  return ctx;
}

export type AuditEvent = {
  kind: string;
  actorType: string;
  actorEmail: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export type BuilderRenderInput = {
  title: string;
  bodyMarkdown: string;
  placeholders: AgreementPlaceholder[];
  values: Record<string, string>;
  signatureDataUrl?: string | null;
  signatureMethod?: "drawn" | "typed" | null;
  signerName: string;
  signerEmail: string;
  signedAt: Date;
  events: AuditEvent[];
  logoPng?: Buffer | null;
};

export async function renderBuilderPdf(input: BuilderRenderInput): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cursive = await pdf.embedFont(StandardFonts.TimesRomanItalic);

  let ctx: RenderCtx = {
    pdf,
    page: pdf.addPage([PAGE_W, PAGE_H]),
    y: PAGE_H - MARGIN,
    pageW: PAGE_W,
    pageH: PAGE_H,
    margin: MARGIN,
    helv,
    helvB,
    cursive,
  };

  // Header logo. Use the admin-uploaded template logo when present, otherwise
  // fall back to the bundled Reclaimed Media wordmark so every signed PDF carries
  // brand identity (the user explicitly asked for the logo to appear at the
  // top of every exported agreement). Centered horizontally, with breathing
  // room before the title.
  const logoSource: Buffer | null =
    input.logoPng && input.logoPng.length > 4
      ? input.logoPng
      : defaultLogoBytes.length > 4
        ? defaultLogoBytes
        : null;
  if (logoSource) {
    try {
      const buf = logoSource;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
      const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      const img = isPng ? await pdf.embedPng(buf) : isJpg ? await pdf.embedJpg(buf) : null;
      if (img) {
        // Cap by both width and height so very wide wordmarks don't dominate
        // the page and very tall marks don't push the title off.
        const maxW = 180;
        const maxH = 56;
        const ratio = img.width / img.height;
        let w = maxW;
        let h = w / ratio;
        if (h > maxH) {
          h = maxH;
          w = h * ratio;
        }
        const x = (PAGE_W - w) / 2;
        const y = PAGE_H - MARGIN - h;
        ctx.page.drawImage(img, { x, y, width: w, height: h });
        // Push the writing cursor below the logo + a 24px gap before the title.
        ctx = { ...ctx, y: y - 24 };
      }
    } catch {
      /* ignore bad logo */
    }
  }

  // Title (always plain — no markdown in titles).
  ctx = drawWrappedLine(ctx, stripMarkdown(input.title), { font: helvB, size: 20 });
  ctx = { ...ctx, y: ctx.y - 6 };

  // Apply admin defaults so admin-role placeholders bake in correctly.
  const allValues = applyPlaceholderDefaults(input.placeholders, input.values);

  // Body — paragraph by paragraph using the rich atom renderer
  // (supports **bold** runs and inline drawn-initial images).
  for (const rawPara of input.bodyMarkdown.split(/\n\n+/)) {
    const para = rawPara.trim();
    if (!para) continue;
    if (para.startsWith("# ")) {
      ctx = { ...ctx, y: ctx.y - 8 };
      const atoms = await buildParagraphAtoms(pdf, para.slice(2), input.placeholders, allValues, helvB, helvB, 16);
      ctx = drawAtoms(ctx, atoms, 16);
      ctx = { ...ctx, y: ctx.y - 4 };
    } else if (para.startsWith("## ")) {
      ctx = { ...ctx, y: ctx.y - 6 };
      const atoms = await buildParagraphAtoms(pdf, para.slice(3), input.placeholders, allValues, helvB, helvB, 13);
      ctx = drawAtoms(ctx, atoms, 13);
      ctx = { ...ctx, y: ctx.y - 3 };
    } else if (para.startsWith("### ")) {
      // h3 / h4 used heavily by the default service agreement (e.g. `### 2.1
      // Action Deposit`). Without this branch they fell through to body
      // rendering and the literal `### ` prefix surfaced in the exported PDF.
      ctx = { ...ctx, y: ctx.y - 5 };
      const atoms = await buildParagraphAtoms(pdf, para.slice(4), input.placeholders, allValues, helvB, helvB, 12);
      ctx = drawAtoms(ctx, atoms, 12);
      ctx = { ...ctx, y: ctx.y - 2 };
    } else if (para.startsWith("#### ")) {
      ctx = { ...ctx, y: ctx.y - 4 };
      const atoms = await buildParagraphAtoms(pdf, para.slice(5), input.placeholders, allValues, helvB, helvB, 11);
      ctx = drawAtoms(ctx, atoms, 11);
      ctx = { ...ctx, y: ctx.y - 2 };
    } else if (/^[-*]\s/.test(para)) {
      for (const item of para.split(/\n/)) {
        const txt = item.replace(/^[-*]\s+/, "").trim();
        if (!txt) continue;
        const atoms = await buildParagraphAtoms(pdf, "  •  " + txt, input.placeholders, allValues, helv, helvB, BODY_SIZE);
        ctx = drawAtoms(ctx, atoms, BODY_SIZE);
      }
      ctx = { ...ctx, y: ctx.y - 4 };
    } else {
      // Collapse single newlines within a paragraph to spaces.
      const flat = para.replace(/\s*\n\s*/g, " ");
      const atoms = await buildParagraphAtoms(pdf, flat, input.placeholders, allValues, helv, helvB, BODY_SIZE);
      ctx = drawAtoms(ctx, atoms, BODY_SIZE);
      ctx = { ...ctx, y: ctx.y - 6 };
    }
  }

  // Signature block.
  ctx = ensureSpace(ctx, 140);
  ctx = { ...ctx, y: ctx.y - 16 };
  ctx = drawWrappedLine(ctx, "Signed by", { font: helvB, size: 11, color: rgb(0.35, 0.35, 0.4) });
  const sigBoxY = ctx.y - 70;
  ctx.page.drawRectangle({
    x: MARGIN,
    y: sigBoxY,
    width: 280,
    height: 70,
    borderColor: rgb(0.85, 0.85, 0.88),
    borderWidth: 1,
  });
  if (input.signatureDataUrl) {
    if (input.signatureMethod === "drawn") {
      const img = dataUrlToBytes(input.signatureDataUrl);
      if (img) {
        try {
          const embedded = img.mime === "image/png" ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes);
          const ratio = embedded.width / embedded.height;
          let w = 260;
          let h = w / ratio;
          if (h > 60) {
            h = 60;
            w = h * ratio;
          }
          ctx.page.drawImage(embedded, { x: MARGIN + (280 - w) / 2, y: sigBoxY + (70 - h) / 2, width: w, height: h });
        } catch {
          /* ignore embed failures */
        }
      }
    } else {
      ctx.page.drawText(input.signatureDataUrl, {
        x: MARGIN + 14,
        y: sigBoxY + 28,
        size: 22,
        font: cursive,
        color: rgb(0.05, 0.1, 0.25),
      });
    }
  }
  ctx = { ...ctx, y: sigBoxY - 14 };
  ctx = drawWrappedLine(ctx, `${input.signerName}  •  ${input.signerEmail}`, { font: helvB, size: 10 });
  ctx = drawWrappedLine(ctx, `Signed on ${input.signedAt.toUTCString()}`, {
    font: helv,
    size: 10,
    color: rgb(0.4, 0.42, 0.46),
  });

  // Audit trail page.
  ctx = newPage(ctx);
  ctx = drawWrappedLine(ctx, "Audit trail", { font: helvB, size: 18 });
  ctx = drawWrappedLine(ctx, `Document: ${input.title}`, { font: helv, size: 10, color: rgb(0.4, 0.42, 0.46) });
  ctx = drawWrappedLine(ctx, `Signer: ${input.signerName} <${input.signerEmail}>`, {
    font: helv,
    size: 10,
    color: rgb(0.4, 0.42, 0.46),
  });
  ctx = { ...ctx, y: ctx.y - 8 };

  if (input.events.length === 0) {
    ctx = drawWrappedLine(ctx, "No recorded events.", { font: helv, size: 10 });
  } else {
    // Newest first → render chronological (oldest first) for readability.
    const ordered = [...input.events].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const e of ordered) {
      const meta = e.metadata as { page?: number };
      const head =
        e.kind === "viewed"
          ? "Document viewed"
          : e.kind === "page_viewed"
            ? `Page ${meta?.page ?? "?"} viewed`
            : e.kind === "signed"
              ? "Signed"
              : e.kind === "assigned"
                ? "Assigned"
                : e.kind;
      ctx = drawWrappedLine(ctx, `• ${head} — ${e.createdAt.toUTCString()}`, { font: helvB, size: 10 });
      const detail = [
        e.actorEmail ? `by ${e.actorEmail}` : `by ${e.actorType}`,
        e.ip ? `IP ${e.ip}` : null,
        e.userAgent ? `UA ${trim(e.userAgent, 90)}` : null,
      ]
        .filter(Boolean)
        .join("   ");
      if (detail) ctx = drawWrappedLine(ctx, "   " + detail, { font: helv, size: 9, color: rgb(0.42, 0.45, 0.5) });
      ctx = { ...ctx, y: ctx.y - 2 };
    }
  }

  // Footer on every page.
  const totalPages = pdf.getPageCount();
  for (let i = 0; i < totalPages; i++) {
    const p = pdf.getPage(i);
    p.drawText(
      `${BRAND_APP_NAME}  •  ${input.title}  •  Page ${i + 1} of ${totalPages}`,
      { x: MARGIN, y: 24, size: 8, font: helv, color: rgb(0.55, 0.55, 0.6) },
    );
  }

  const out = await pdf.save();
  return Buffer.from(out);
}

function trim(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export const agreementsObjectStorage = objectStorage;
export const agreementObjectPermission = ObjectPermission;
