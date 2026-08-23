import { parseProjectArtifact } from "./artifacts";
import { detectedAssayModule } from "./assay-workflows";
import {
  parsePastedPlateReadings,
  parseReadingTemplateWorkbook,
  type ManualReadingMetadata,
} from "./instruments/manual-readings";
import { parseInstrumentData } from "./instruments/registry";
import type { PlateImportBatch } from "./types";

export type BinaryFileSource = { name: string; arrayBuffer: () => Promise<ArrayBuffer> };
export type TextFileSource = { name: string; text: () => Promise<string> };

export type PlateReadingImportRequest =
  | { kind: "instrument-file"; file: BinaryFileSource }
  | { kind: "manual-paste"; text: string; metadata: ManualReadingMetadata }
  | { kind: "reading-template"; file: BinaryFileSource; metadata: ManualReadingMetadata }
  | { kind: "project-file"; file: TextFileSource };

export async function importPlateReadings(request: PlateReadingImportRequest): Promise<PlateImportBatch> {
  if (request.kind === "manual-paste") return parsePastedPlateReadings(request.text, request.metadata);
  if (request.kind === "project-file") return parseProjectArtifact(await request.file.text(), request.file.name);
  if (request.kind === "reading-template") {
    return parseReadingTemplateWorkbook(await request.file.arrayBuffer(), request.file.name, request.metadata);
  }
  const plate = parseInstrumentData({ name: request.file.name, bytes: await request.file.arrayBuffer() });
  plate.metadata.detectedAssayModuleId = detectedAssayModule(plate);
  return {
    id: `instrument-file-${Date.now()}`,
    sourceKind: "instrument-file",
    sourceName: request.file.name,
    plates: [plate],
    warnings: plate.warnings,
  };
}
