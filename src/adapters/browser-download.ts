import type { ReproducibleArtifact } from "../core/artifacts";

export function downloadArtifact(artifact: ReproducibleArtifact): void {
  downloadBlob(artifact.filename, new Blob([artifact.content], { type: `${artifact.mimeType};charset=utf-8` }));
}

export function downloadTextFile(filename: string, content: string, mimeType = "text/plain"): void {
  downloadBlob(filename, new Blob([content], { type: `${mimeType};charset=utf-8` }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
