import type { ReportAttribute } from "../externalBuffs";
import type { SideId, TroopType } from "../types/combat";

export type ReportSourceSide = "left" | "right";
export type ReportTargetSide = "A" | "B";
export type SpecialBonusCompleteness = "complete" | "explicitZero" | "incomplete";
export type TroopResolutionSource = "battleReportApproximation" | "userOverride";
export type ReportPageType = "attributes" | "specialBonuses" | "troops" | "unknown";
export type OcrBox = readonly [readonly [number, number], readonly [number, number],
  readonly [number, number], readonly [number, number]];
export interface OcrLine {
  readonly text: string;
  readonly confidence: number;
  readonly box: OcrBox;
  readonly bbox?: { readonly x1: number; readonly y1: number;
    readonly x2: number; readonly y2: number };
}
export interface OcrImage {
  readonly imageId: string;
  readonly width: number;
  readonly height: number;
  readonly lines: readonly OcrLine[];
  /** Full-image contrast/scale pass, with boxes returned in original image coordinates. */
  readonly enhancedLines?: readonly OcrLine[];
  /** Per-card local crop OCR, all boxes mapped back into original image coordinates. */
  readonly troopCardReadings?: readonly TroopCardReading[];
}
export interface TroopCardReading {
  readonly cardId: string;
  readonly field: "fireCrystal" | "count";
  readonly bbox: { readonly x1: number; readonly y1: number;
    readonly x2: number; readonly y2: number };
  readonly passes: readonly { readonly variant: "original" | "gray" | "contrast";
    readonly lines: readonly OcrLine[] }[];
}
export interface RecognizedValue<T> {
  readonly value: T;
  readonly confidence: number;
  readonly box: OcrBox;
  readonly rawText?: string;
  readonly ocrConfidence?: number;
  readonly structuralConfidence?: number;
  readonly validationConfidence?: number;
  readonly finalConfidence?: number;
  readonly needsConfirmation?: boolean;
  readonly alternatives?: readonly T[];
  readonly legalCandidates?: readonly string[];
  readonly confirmed?: boolean;
}
export interface ResolvedBaseCompositionEntry {
  readonly level: number;
  readonly ratio: number;
  readonly count?: number;
}
export interface ResolvedTroopCompositionEntry {
  readonly baseTier: number;
  readonly fireCrystalLevel: number;
  readonly level: string;
  readonly ratio: number;
  readonly count?: number;
}
export interface ParsedTroopSetup {
  readonly portraitBBox?: { readonly x1: number; readonly y1: number;
    readonly x2: number; readonly y2: number };
  readonly troopSlotBBox?: { readonly x1: number; readonly y1: number;
    readonly x2: number; readonly y2: number };
  readonly cardBbox?: { readonly x1: number; readonly y1: number;
    readonly x2: number; readonly y2: number };
  readonly cardConfidence?: number;
  readonly level?: RecognizedValue<string>;
  readonly displayedTroopLevel?: RecognizedValue<number>;
  readonly displayedFireCrystalLevel?: RecognizedValue<number>;
  readonly resolvedBaseComposition?: readonly ResolvedBaseCompositionEntry[];
  readonly fireCrystal?: RecognizedValue<number>;
  readonly count?: RecognizedValue<number>;
  readonly resolvedTroopComposition?: readonly ResolvedTroopCompositionEntry[];
  readonly resolutionSource?: TroopResolutionSource;
}
export type SpecialBonusMatchType = "exact" | "alias" | "fuzzy";
export interface SpecialBonusRowQuality {
  readonly labelConfidence: number;
  readonly valueConfidence: number;
  readonly structuralConfidence: number;
  readonly finalConfidence: number;
  readonly isNearTopEdge: boolean;
  readonly isNearBottomEdge: boolean;
  readonly isPartiallyClipped: boolean;
}
export interface SpecialBonusSource extends SpecialBonusRowQuality {
  readonly imageId: string;
  readonly imageIndex: number;
  readonly rawText: string;
  readonly normalizedText: string;
  readonly bbox: { readonly x1: number; readonly y1: number;
    readonly x2: number; readonly y2: number };
  readonly matchType: SpecialBonusMatchType;
  readonly value: number;
}
export interface SpecialBonusCandidate {
  readonly amount: RecognizedValue<number>;
  readonly matchScore?: number;
  readonly matchType?: SpecialBonusMatchType;
  readonly rowQuality?: SpecialBonusRowQuality;
  readonly sources: readonly SpecialBonusSource[];
}
export interface ParsedSpecialBonus {
  readonly label: string;
  readonly canonicalLabel?: string;
  readonly matchConfidence?: number;
  readonly matchScore?: number;
  readonly matchType?: SpecialBonusMatchType;
  readonly rowQuality?: SpecialBonusRowQuality;
  readonly sources?: readonly SpecialBonusSource[];
  readonly candidates?: readonly SpecialBonusCandidate[];
  readonly conflict?: boolean;
  readonly conflictValues?: readonly number[];
  readonly category?: "additive" | "buff" | "debuff";
  readonly activeInThisBattle?: true;
  readonly attribute: ReportAttribute;
  readonly troop?: TroopType;
  readonly troopScope?: "all" | TroopType;
  /** @deprecated Old model-side tag; never used to route a historical report effect. */
  readonly sourceArmy?: SideId;
  readonly sourceRecognitionState?: SideId;
  readonly sourceReportSide?: ReportSourceSide;
  /** Percentage points; 15 means 15%. */
  readonly amount: RecognizedValue<number>;
  readonly scope: "general" | "garrison" | "rally";
  /** The report column identifies the owner of the effect, not its recipient. */
  readonly effectTarget?: "self" | "enemy";
}
export interface UnmatchedSpecialBonus {
  readonly rawText: string;
  readonly normalizedText: string;
  readonly possibleAttribute?: ReportAttribute;
  readonly amount?: RecognizedValue<number>;
  readonly conflict?: boolean;
  readonly nearestRegistryCandidates: readonly {
    readonly canonicalLabel: string;
    readonly confidence: number;
  }[];
}
export interface ParsedBattleReportSide {
  readonly sourceSide: ReportSourceSide;
  readonly troopSetup: Readonly<Partial<Record<TroopType, ParsedTroopSetup>>>;
  readonly attributes: Readonly<Partial<Record<TroopType,
    Readonly<Partial<Record<ReportAttribute, RecognizedValue<number>>>>>>>;
  readonly specialBonuses?: {
    readonly additive: readonly ParsedSpecialBonus[];
    readonly buffs: readonly ParsedSpecialBonus[];
    readonly debuffs: readonly ParsedSpecialBonus[];
  };
  readonly specialEvidence: boolean;
  readonly unmatchedBonuses?: readonly UnmatchedSpecialBonus[];
}
export interface ParsedBattleReport {
  readonly imageId: string;
  readonly imageIds?: readonly string[];
  readonly pageType?: ReportPageType;
  readonly pageTypes?: readonly ReportPageType[];
  readonly left?: ParsedBattleReportSide;
  readonly right?: ParsedBattleReportSide;
  readonly warnings: readonly string[];
  readonly confidence: number;
}
