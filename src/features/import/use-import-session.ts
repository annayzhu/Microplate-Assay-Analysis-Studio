import { useState } from "react";
import type { AssayModuleId, DetectionMode, PlateImportBatch } from "../../core/types";

export type ImportMode = "instrument" | "paste" | "template";
export type ImportTarget = "append" | "replace";

export function useImportSession() {
  const [importMode, setImportMode] = useState<ImportMode>("instrument");
  const [selectedModuleId, setSelectedModuleId] = useState<AssayModuleId>("cell-viability");
  const [moduleSelectionTouched, setModuleSelectionTouched] = useState(false);
  const [pendingBatch, setPendingBatch] = useState<PlateImportBatch | null>(null);
  const [pendingModuleIds, setPendingModuleIds] = useState<AssayModuleId[]>([]);
  const [pendingIncludedPlates, setPendingIncludedPlates] = useState<Set<number>>(new Set());
  const [pendingConflictConfirmed, setPendingConflictConfirmed] = useState(false);
  const [pendingImportTarget, setPendingImportTarget] = useState<ImportTarget>("replace");
  const [manualText, setManualText] = useState("");
  const [manualDetectionMode, setManualDetectionMode] = useState<DetectionMode>("absorbance");
  const [manualSignalUnit, setManualSignalUnit] = useState("OD");
  const [manualWavelength, setManualWavelength] = useState("450");
  const [manualExcitation, setManualExcitation] = useState("");
  const [manualEmission, setManualEmission] = useState("");
  const [readingTemplateId, setReadingTemplateId] = useState("96");
  const [readingTemplatePlateCount, setReadingTemplatePlateCount] = useState(1);
  const [loading, setLoading] = useState(false);

  return {
    importMode, setImportMode,
    selectedModuleId, setSelectedModuleId,
    moduleSelectionTouched, setModuleSelectionTouched,
    pendingBatch, setPendingBatch,
    pendingModuleIds, setPendingModuleIds,
    pendingIncludedPlates, setPendingIncludedPlates,
    pendingConflictConfirmed, setPendingConflictConfirmed,
    pendingImportTarget, setPendingImportTarget,
    manualText, setManualText,
    manualDetectionMode, setManualDetectionMode,
    manualSignalUnit, setManualSignalUnit,
    manualWavelength, setManualWavelength,
    manualExcitation, setManualExcitation,
    manualEmission, setManualEmission,
    readingTemplateId, setReadingTemplateId,
    readingTemplatePlateCount, setReadingTemplatePlateCount,
    loading, setLoading,
  };
}
