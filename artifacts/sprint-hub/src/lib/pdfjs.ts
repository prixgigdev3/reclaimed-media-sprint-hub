import * as pdfjs from "pdfjs-dist";
// pdfjs v5 ships an .mjs worker
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
