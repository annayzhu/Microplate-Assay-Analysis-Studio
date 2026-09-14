import { useState } from "react";
import type { WellRole } from "../../core/types";

export type DraftStatus = "idle" | "dirty" | "applied";
export type PlatePresentation = { zoom: number; zoomManuallyChanged: boolean };
export type BatchDraft = {
  role: "" | WellRole;
  sampleId: string;
  group: string;
  treatment: string;
  concentration: string;
  timepoint: string;
  biologicalReplicate: string;
  technicalReplicate: string;
  excluded: "true" | "false";
  notes: string;
};

export const emptyBatchDraft: BatchDraft = {
  role: "", sampleId: "", group: "", treatment: "", concentration: "", timepoint: "",
  biologicalReplicate: "", technicalReplicate: "", excluded: "false", notes: "",
};

export function useLayoutSession() {
  const [platePresentations, setPlatePresentations] = useState<PlatePresentation[]>([]);
  const [layoutTemplateId, setLayoutTemplateId] = useState("96");
  const [pendingLayoutFile, setPendingLayoutFile] = useState<{ name: string; text: string } | null>(null);
  const [layoutBiologicalMode, setLayoutBiologicalMode] = useState<"preserve" | "clear">("preserve");
  const [layoutMismatchConfirmed, setLayoutMismatchConfirmed] = useState(false);
  const [annotationPanelCollapsed, setAnnotationPanelCollapsed] = useState(false);
  const [batchDraft, setBatchDraft] = useState<BatchDraft>(emptyBatchDraft);
  const [draftStatus, setDraftStatus] = useState<DraftStatus>("idle");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [autoNumberTechnical, setAutoNumberTechnical] = useState(true);
  const [methodReviewOpen, setMethodReviewOpen] = useState(false);
  const [methodReviewDraft, setMethodReviewDraft] = useState("");

  return {
    platePresentations, setPlatePresentations,
    layoutTemplateId, setLayoutTemplateId,
    pendingLayoutFile, setPendingLayoutFile,
    layoutBiologicalMode, setLayoutBiologicalMode,
    layoutMismatchConfirmed, setLayoutMismatchConfirmed,
    annotationPanelCollapsed, setAnnotationPanelCollapsed,
    batchDraft, setBatchDraft,
    draftStatus, setDraftStatus,
    advancedOpen, setAdvancedOpen,
    autoNumberTechnical, setAutoNumberTechnical,
    methodReviewOpen, setMethodReviewOpen,
    methodReviewDraft, setMethodReviewDraft,
  };
}
