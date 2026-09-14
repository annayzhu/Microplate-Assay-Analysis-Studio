export type ReproducibleArtifact = {
  filename: string;
  mimeType: "text/csv" | "application/json";
  content: string;
};

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  return /[\",\n\r]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}

export function rowsToCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n");
}

export function artifactName(source: string, suffix: string): string {
  const stem = source.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${stem || "microplate"}-${suffix}`;
}
