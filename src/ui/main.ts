import { renderHeroPortrait, renderWeaponArt, renderSkillArt } from "./heroArtwork";
import { renderReportAttributeComparison } from "./reportConfigurationView";
import { renderHistoricalBonusTable } from "./historicalBonusView";
import { historicalReportBonuses } from "../pvp/validationUi/historicalBonuses";
import { parseConfigurationImport } from "./configImport";
import { renderExpertSkillOptions, renderExpertSkillDescription } from "./expertSkillView";
import { renderIceFireSide, renderIceFirePermutationMetrics, renderIceFireCandidateConversion } from "./iceFireView";
import { renderReportSpecialBonuses, renderReportRawAttributePreview } from "./reportSpecialBonusView";
import { iceFireSharedContext, normalizeIceFireShared, isIceFireInput } from "../pvp/validationUi/iceFireContext";
import { formalSampleSchedule } from "../pvp/optimizer/queueRacing";
import { expectedAttributeAuditIsConsistent } from "../pvp/validationUi/expectedReportAttribute";
import { maxT12SkillLevel, normalizeBattleInputPolicy } from "../pvp/validationUi/inputPolicy";
import { AdvancedScenarioStates, scenarioStateKey, type ScenarioEditorState } from "./advancedScenarioState";
import { advancedHelp, attributeModeHelp, WEAPON_HELP } from "./advancedHelp";
import { allocateDeployment, deploymentRatios, renderTotalRatioDeployment } from "./troopDeploymentView";
import { combatBuffPreset, renderCombatBuffPresets, type CombatBuffPreset } from "./combatBuffPresets";
import { renderOptimizerPerformance, performanceReportBody, optimizerProgressText } from "./optimizerPerformanceView";
import { stopPerformanceReport, type SearchPerformanceReport } from "../pvp/optimizer/profiling";
import { bodySkillOptionsView, renderBodySlotCard } from "./bodySkillSelectView";
import { heroCategoryLabel } from "../pvp/validationUi/heroCategory";
import { optimizationTargetLabel, updateRallyOptimizationSide } from "./optimizationTarget";
import { createOptimizationContext, optimizationContextAudit } from "../pvp/optimizer/optimizationContext";
import "./styles.css";
import "./simpleMode.css";
import "./advancedMode.css";
import { resolveEditorLayers } from "./editorLayers";
import { playerOptimizationProgress } from "./optimizerProgressView";
import { rallyRecommendationDetails } from "./rallyRecommendationView";
import { createOptimizerBenchmarkFixture, restoreOptimizerBenchmarkFixture } from "./optimizerBenchmarkFixture";
import { resolveJointPipelineOptions } from "../pvp/optimizer/jointPipeline/types";
import { jointHeadPolicy } from "../pvp/optimizer/jointPipeline/domain";
import { renderAdvancedLineupActions, renderAdvancedScene, renderAdvancedRun, renderAdvancedBatch, renderAdvancedStatistics, renderPlayerSingle,
  renderPlayerSingleDrawer, renderAdvancedBatchDrawer } from "./advancedModeView";
import { EDITOR_MODE_KEY, copySimpleAttributes, setSimpleCounts,
  setSimpleRatios, simpleTroopRatios, simpleTroopTotal, validSimpleRatios, type EditorMode } from "./simpleMode";
import { renderModeHeader, renderSimpleMode, renderSimpleDetailsOnly, renderSimpleHero } from "./simpleModeView";
import { encodeSimpleShare, decodeSimpleShare } from "./simpleShare";
import { createPlayerDefaultInput, normalizePlayerHeroLevels } from "./playerConfig";
import type { RallyTroopRatios } from "../pvp/validationUi/rallyDeployment";
import { perfMark, perfMeasure, timeUiSection, recordOcrBackend } from "./startupPerformance";
import { renderFatalError } from "./startupErrors";
import { LazyDetails } from "./lazyDetails";
import { DEBUG_PREVIEW, debugJsonPreview, debugHtmlPreview } from "./debugPreview";
import { downloadBattleJson } from "./battleJsonExport";
import { renderBatchSkillDamageStatistics, renderSingleSkillDamageStatistics, skillStatisticsExport } from "./skillStatisticsView";
import { CURRENT_ENGINE_RULE_UNKNOWNS, createValidationPreviewState, previewExpectedReportBonuses, getValidationThreeQueues, toValidationThreeQueueConfig, runValidationThreeQueueScenario, resolveValidationTroopCounts, resolveThreeThreeThreeSide, runValidationBattle } from "../pvp/validationUi/adapter";
import { DEFAULT_BATCH_SIMULATION_COUNT, MAX_BATCH_SIMULATION_COUNT, MIN_BATCH_SIMULATION_COUNT, type BatchMetricDistribution, type BatchSimulationResult } from "../pvp/validationUi/batchSimulation";
import { DEFAULT_EXTERNAL_BUFF_CONFIG, PET_DEFENSE_REDUCTION_LEVELS, PET_LIFE_REDUCTION_LEVELS, PET_PENETRATION_REDUCTION_LEVELS, STANDARD_PET_LEVELS } from "../pvp/externalBuffs/data";
import { TROOP_DAMAGE_COEFFICIENTS } from "../pvp/data/troopDamageCoefficients";
import { TROOP_HP_COEFFICIENTS } from "../pvp/data/troopHpCoefficients";
import { TROOP_TYPES, type SideId, type TroopType } from "../pvp/types/combat";
import { CONFIRMED_HERO_SKILL_DEFINITIONS } from "../pvp/heroSkills/definitions/simpleHeroes";
import { calculateEffectiveTroopConstant } from "../pvp/formulas/effectiveTroopConstant";
import { formatValidationHeroOption, getValidationTroopSkillDisplay, getBattleReportSkillTriggerCount } from "../pvp/validationUi/presentation";
import { getTroopConstant } from "../pvp/data/troopConstants";
import { getExclusiveWeaponSkillTier } from "../pvp/heroSkills/data/exclusiveWeapons";
import { getValidationCatalog, getAvailableMemberSkills } from "../pvp/validationUi/catalog";
import { SERVER_STAGES, getServerStage, getAvailableTroopLevels, isTroopLevelAvailableAtStage, isHeroAvailableAtStage, type ServerStageId } from "../pvp/progression/serverStage";
import { validationStageId, sanitizeConfigForStage } from "../pvp/validationUi/stageConfig";
import { resolveBodySkillConfigs } from "../pvp/validationUi/bodySkillConfig";
import { rawReportSide } from "../pvp/validationUi/reportBonusContexts";
import { changeIceFireExpectedHero, changeIceFireReportHero, captureQueueReportBaseline, changeQueueHero, changeQueueAttribute, normalizeIceFireReportLineage,
  createQueueReportLineageAudit } from "../pvp/validationUi/queueReportLineage";
import { availableHeadHeroesByTroop, headFormationGenerationAudit } from "../pvp/optimizer/candidateGenerator";
import { getActiveSkillUniverse } from "../pvp/validationUi/activeSkillUniverse";
import { prepareValidationRunInput, replayValidationSeed } from "../pvp/validationUi/randomMode";
import { highestConfiguredTroopLevel, type BattleScenarioType } from "../pvp/scenario/scenarioTypes";
import { toThreeQueueBasisPoints, allocateThreeQueueTroops } from "../pvp/scenario/threeQueueRatios";
import type { ThreeQueueScenarioResult } from "../pvp/scenario/threeQueueScenario";
import { resetAllProbabilityOverrides } from "../pvp/validationUi/probabilityDebugOverrides";
import { sortActiveSkillsForUi } from "../pvp/validationUi/activeSkillSorting";
import type { AttributeResolutionTrace, DamageEvent, MultiplierGroupResult } from "../pvp/types/damage";
import type { ThreeQueueBatchResult } from "../pvp/validationUi/threeQueueBatch";
import type { DebugOverrideMode, ValidationBattleResult, ValidationActiveSkillOption, ValidationExpectedReportBonus, ValidationSideInput, ValidationQueueConfig, ValidationTroopInput, ValidationLevelCompositionEntry } from "../pvp/validationUi/types";
import type { HeroStatCorrection } from "../pvp/heroSkills/heroStatCorrection";
import type { RoundBattleTrace, RoundDamageEventTrace } from "../pvp/logging/battleTrace";
import type { PostBattleCasualtyResult } from "../pvp/postBattle/casualtyResolver";
import { defaultTheoryOptions, type TheoryCoverage } from "../pvp/optimizer/theory";
import { defaultOptimizationConfig } from "../pvp/optimizer/index";
import { defaultSimpleScenarioOptimizationOptions, applySimpleScenarioCandidate, type SimpleScenarioOptimizationOptions, type SimpleScenarioOptimizationResult } from "../pvp/optimizer/scenarioOptimizer";
import { defaultThreeQueueOptimizationOptions, applyThreeQueueCandidate, type ThreeQueueOptimizationOptions, type ThreeQueueOptimizationResult } from "../pvp/optimizer/threeQueueOptimizer";
import { candidateToInput, candidateKey } from "../pvp/optimizer/candidateGenerator";
import type { OptimizationConfig, OptimizationProgress, OptimizationResult, CandidateEvaluation } from "../pvp/optimizer/types";
import { mapDoubleSidedFinalReport } from "../pvp/battleReportRecognition/mapping";
import { selectSpecialBonusCandidate } from "../pvp/battleReportRecognition/specialBonusMerge";
import { refreshReportDiagnostics } from "../pvp/battleReportRecognition/reportData";
import { resolveParsedTroopSetup } from "../pvp/battleReportRecognition/troopResolution";
import { matchSpecialBonusLabel } from "../pvp/battleReportRecognition/specialBonusRegistry";
import type { ParsedBattleReport, ParsedBattleReportSide, OcrBox, ReportSourceSide } from "../pvp/battleReportRecognition/types";
import {
  LocalStorageConfigStorage,
  copySavedProfile,
  createSavedProfile,
  exportPersistedJson,
  renameSavedProfile,
  restorePersistedConfig,
  type RestoredBattleSetup,
  type SavedBattleProfile,
} from "../storage";
import { registerValidationWebMcp } from "./webmcp";
import {
  clearValidationResultRevision,
  createValidationResultRevisionState,
  doesValidationScopeAffectInput,
  isValidationResultStale,
  markValidationInputChanged,
  markValidationResultCurrent,
} from "./resultRevision";
import { swapIceFireQueues, copySideAToB, swapBattleSides } from "./sideConfigActions";
import { initializeOptimizerWeaponLevels } from "./optimizerWeaponDefaults";
import { selectSimulationHero } from "./simulationWeaponSelection";
import { createHeadPoolAudit } from "../pvp/optimizer/headPoolAudit";
import { optimizationHeroIds, ownedHeroIds, ownedOptimizationHeroIds, optimizerHeadHeroAllowed,
  optimizerWeaponLevel, setOptimizationPoolEnabled, setOwnedHero, optimizerServerGeneration,
  configuredHeadHeroIds, heroOwnershipScope, setHeroOwnershipScope, syncOptimizationHeroPoolForStage } from "../pvp/optimizer/heroPools";
import { resolveSearchDimensions, type SearchDimensionsAudit } from "../pvp/optimizer/searchDimensions";
import { isThreeQueueBattleInput, battleSceneLabel } from "../pvp/scenario/scenePolicy";
import { normalizeInnerEarthInput, getInnerEarthConfig, getInnerEarthRule, assertInnerEarthInput, sanitizeInnerEarthForStage,
  createInnerEarthAudit } from "../pvp/innerEarth";
import { applyInnerEarthCandidate, type InnerEarthOptimizationResult } from "../pvp/optimizer/innerEarthOptimizer";
import { renderInnerEarthForm, renderInnerEarthModePicker, renderInnerEarthPets, updateInnerEarthField,
  changeInnerEarthMode, updateInnerEarthDeployment, INNER_EARTH_MODE_LABELS } from "./innerEarthView";
import { createReportRecognitionState, mergeRecognitionImage, clearRecognitionContext,
  pendingRecognitionSides as pendingDraftSides } from "./reportImportDrafts";
import { applyRecognizedAttributeReport, attributeImportSchema, attributePreviewGroups, confirmAttributeGroup } from "../pvp/battleReportRecognition/attributeImport";
import { optimizerRoute } from "./optimizerRoute";
import { renderAppDialog, type AppDialog } from "./appDialog";
import {
  createExpandedSections,
  isExpandedSectionKey,
  rememberExpandedSection,
  type ExpandedSectionKey,
} from "./expandedSections";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (appRoot === null) throw new Error("Missing #app root element.");
const app: HTMLDivElement = appRoot;
const blankOcrBox: OcrBox = [[0, 0], [0, 0], [0, 0], [0, 0]];
const reportAttributes = ["attack", "defense", "penetration", "life"] as const;
const lazyDetails = new LazyDetails();
const optimizerRacingMigrationNotice = "旧集结优化预算已升级为 5/20/50/100/300 场，默认保留 300/80/25/10/5；已取消旧独立筛选参数。";
// Presentation-only filters never enter saved battle configuration or result revisions.
const memberSearchQueries = new Map<string, string>();
const previewCache = new WeakMap<typeof input,
  ReturnType<typeof createValidationPreviewState> | null>();
const expectedCache = new WeakMap<typeof input,
  ReturnType<typeof previewExpectedReportBonuses> | null>();

perfMark("main loaded");
perfMark("app init start");

const catalog = getValidationCatalog();
const headPoolOwnershipMigrationNotice = "已将旧英雄可用列表迁移为我的英雄，并补充当前手动阵容已选英雄；升代时自动加入新开放车头。已有参与开关和专武等级保留。";
let input = createPlayerDefaultInput();
let editorMode: EditorMode = "simple";
let developerToolsEnabled = new URLSearchParams(location.search).get("dev") === "1";
try { const layers = resolveEditorLayers(location.search, window.localStorage);
  editorMode = layers.mode; developerToolsEnabled = layers.developerToolsEnabled;
} catch { /* Storage may be unavailable. */ }
const simpleTroopModes: Record<SideId, "count" | "ratio"> = { A: "count", B: "count" };
const simpleRatioDrafts: Record<SideId, RallyTroopRatios | null> = { A: null, B: null };
let advancedRatioDrafts: Record<SideId, RallyTroopRatios | null> = { A: null, B: null };
let simpleDetailsOpen = false;
let specialBuffsOpen = false;
let configurationPopup: "buffs" | "troops" = "buffs";
let specialBuffsSide: SideId = "A";
let playerSingleDetailsOpen = false;
let lineupActionsOpen = false;
let appDialog: AppDialog | null = null;
let recognitionState = createReportRecognitionState();
const specialWarningsAcknowledged: Record<SideId, boolean> = { A: false, B: false };
const reportApplied: Record<SideId, boolean> = { A: false, B: false };
const reportQueueTargets: Record<SideId, 0 | 1 | 2> = { A: 0, B: 0 };
const reportRequestVersions = { A: 0, B: 0, final: 0 };
let pendingReportImports = 0;
let finalReportDraft: ParsedBattleReport | null = null;
let finalReportApplied = false;
let finalReportLeftTarget: SideId = "A";
let reportImportBusy = false;
let result: ValidationBattleResult | null = null;
let threeQueueResult: ThreeQueueScenarioResult | null = null;
let batchCount = DEFAULT_BATCH_SIMULATION_COUNT;
let batchResult: BatchSimulationResult | ThreeQueueBatchResult | null = null;
let optimizationConfig: OptimizationConfig = defaultOptimizationConfig(input.randomSeed);
let optimizationResult: OptimizationResult | null = null;
let simpleOptimizationResult: SimpleScenarioOptimizationResult | null = null;
let simpleResultRevision: number | null = null;
let threeQueueOptimizationResult: ThreeQueueOptimizationResult | null = null;
let innerEarthOptimizationResult: InnerEarthOptimizationResult | null = null;
let threeQueueResultRevision: number | null = null;
let innerEarthResultRevision: number | null = null;
let threeQueueSearchStatus: "idle" | "running" | "cancelled" = "idle";
let optimizerPanelOpen = false;
let heroPoolSide: SideId = "A";
let simpleOptimizerOptions: SimpleScenarioOptimizationOptions =
  defaultSimpleScenarioOptimizationOptions(input.randomSeed);
let threeQueueOptimizerOptions: ThreeQueueOptimizationOptions =
  defaultThreeQueueOptimizationOptions(input.randomSeed);
let optimizationRunning = false;
let cancelOptimizerRun: (() => void) | null = null;
let optimizationProgress: OptimizationProgress | null = null;
let optimizationPerformanceReport: SearchPerformanceReport | null = null;
let optimizationProgressReceivedAt = 0;
let verificationRunning = false;
let batchRunning = false;
let batchProgress = 0;
let errorMessage: string | null = null;
let stageNotice: string | null = null;
let developerMode = developerToolsEnabled;
let traceStartRound = 1;
let traceEndRound = 20;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let revisionState = createValidationResultRevisionState();
const expandedSections = createExpandedSections();
let configStorage: LocalStorageConfigStorage | null = null;
let savedProfiles: readonly SavedBattleProfile[] = [];
let storageStatus: "saving" | "saved" | "error" | "idle" = "idle";
let storageNotice: string | null = null;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastQueuedStorageSnapshot = "";
let lastAutosaveReferences: readonly unknown[] = [];
let profilesLoaded = false;
let storedProfileCount = 0;
let scenarioStates = new AdvancedScenarioStates(null);

try {
  configStorage = new LocalStorageConfigStorage(window.localStorage);
  const restored = configStorage.loadAutosave({ validateBattleState: false });
  if (restored !== null) {
    input = restored.input;
    batchCount = restored.simulationCount;
    optimizationConfig = restored.optimizationConfig;
    simpleOptimizerOptions = restored.simpleOptimizerOptions;
    threeQueueOptimizerOptions = restored.threeQueueOptimizerOptions;
    heroPoolSide = optimizerRoute(input.scenarioType) === "rally" ? optimizationConfig.candidateSide ?? "A" :
      isThreeQueueBattleInput(input) ? threeQueueOptimizerOptions.side : simpleOptimizerOptions.side;
    storageStatus = "saved";
    if (restored.adjusted || restored.migrated) {
      storageNotice = restored.queueAttributesMigrated
        ? "旧三队列配置已复制为三个队伍相同属性，请根据实际战报调整。"
        : restored.headPoolOwnershipMigrated ? headPoolOwnershipMigrationNotice
        : "已按当前输入规则迁移旧配置；历史条件仅供反推，旧的当前自定义加成已忽略，请核对属性与优化设置。";
    }
    if (restored.sceneMigrationWarnings?.length) storageNotice = [storageNotice, ...restored.sceneMigrationWarnings].filter(Boolean).join(" ");
    if (restored.optimizerRacingMigrated) storageNotice = [storageNotice, optimizerRacingMigrationNotice].filter(Boolean).join(" ");
  }
  storedProfileCount = configStorage.countProfiles();
  lastQueuedStorageSnapshot = restored?.adjusted || restored?.migrated || restored?.optimizerRacingMigrated
    ? "" : storageSnapshot();
} catch (error) {
  storageStatus = "error";
  storageNotice = error instanceof Error ? error.message : "本地配置无法读取。";
  lastQueuedStorageSnapshot = storageSnapshot();
}

try { scenarioStates = new AdvancedScenarioStates(window.localStorage); }
catch (error) { storageNotice = `分场景存档暂不可用，当前阵容仍已恢复：${error instanceof Error ? error.message : String(error)}`; }

// A share restores the same canonical input through the existing validated codec.
try {
  const shared = new URLSearchParams(location.hash?.replace(/^#/, "") ?? "").get("s") ??
    new URLSearchParams(location.search).get("s");
  if (shared !== null) {
    const restored = decodeSimpleShare(shared);
    input = restored.input;
    batchCount = restored.simulationCount;
    storageNotice = "已载入分享阵容，可直接开始模拟。";
  }
} catch (error) { errorMessage = error instanceof Error ? error.message : "分享链接无法读取。"; }

perfMark("state restored");
perfMeasure("state restoration", "app init start", "state restored");
render();

app.addEventListener("toggle", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLDetailsElement)) return;
  try {
    if (target.dataset.profileLibrary !== undefined && target.open && !profilesLoaded) {
      savedProfiles = requireConfigStorage().listProfiles();
      profilesLoaded = true;
    }
    lazyDetails.toggle(target);
  } catch (error) { renderFatalError(error); }
}, true);

app.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  if (target.dataset.scope === "member-search") return;
  captureExpandedSections();
  const scope = target.dataset.scope;
  if (scope === "optimizer-fixture-file" && target instanceof HTMLInputElement && developerToolsEnabled) {
    const file = target.files?.[0];
    if (file) void file.text().then((text) => importOptimizerFixture(text, false));
    return;
  }
  if (!developerToolsEnabled && (scope === "developer" || scope === "override" || scope === "disable" ||
    scope === "actual" || scope === "trace-range" || scope === "attribute-input-mode" || scope === "casualty-mode" ||
    scope === "leader-skill-level" || scope === "queue-skill-level" ||
    scope === "control" && target.dataset.field === "maxRounds")) return;
  if (scope === "dialog-name") { if (appDialog !== null) appDialog.name = target.value; return; }
  if (scope === "import-file" && target instanceof HTMLInputElement) {
    const file = target.files?.[0] ?? null;
    target.value = "";
    void importConfigFile(file);
    return;
  }
  if (scope === "attribute-report-field") {
    try { updateAttributeReportField(requireSide(target.dataset.side), target.dataset.key ?? "", target.value); errorMessage = null; }
    catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    render(); return;
  }
  if (scope === "report-image" && target instanceof HTMLInputElement) {
    void importReportImage(target);
    return;
  }
  try {
    if (scope === "player-attribute-source") {
      if (input.scenarioType === "INNER_EARTH" || isThreeQueueBattleInput(input)) throw new Error("当前玩法使用固定的属性来源。");
      input = { ...input, attributeInputMode: target.value === "base" ? "prediction" : "finalReport" };
    }
    if (scope === "leader-skill-level") {
      const sideId = requireSide(target.dataset.side), current = getInputSide(sideId), skillId = target.dataset.skillId ?? "";
      const definition = CONFIRMED_HERO_SKILL_DEFINITIONS.find((skill) => skill.id === skillId);
      const level = Number(target.value);
      if (!definition || !definition.levelValues[level] || !Object.values(current.leaderHeroIds ?? {}).includes(definition.heroId)) throw new Error("技能或等级无效。");
      setInputSide(sideId, { ...current, leaderSkillLevels: { ...current.leaderSkillLevels, [skillId]: level } });
    }
    if (scope === "simple-count" || scope === "simple-total" || scope === "simple-ratio") {
      updateSimpleTroops(target);
    }
    if (scope === "advanced-deployment") {
      const sideId = requireSide(target.dataset.side ?? target.closest<HTMLElement>("[data-deployment-side]")?.dataset.deploymentSide ?? "A");
      const side = getInputSide(sideId);
      const counts = Object.fromEntries(TROOP_TYPES.map((troop) => [troop, side.troops[troop].count])) as Record<TroopType, number>;
      const ratios = advancedRatioDrafts[sideId] ?? deploymentRatios(counts);
      if (target.dataset.field === "ratio") advancedRatioDrafts[sideId] = { ...ratios, [requireTroop(target.dataset.troop)]: Number(target.value) };
      if (target.dataset.field === "total" || validSimpleRatios(advancedRatioDrafts[sideId] ?? ratios)) {
        const total = target.dataset.field === "total" ? Number(target.value) : TROOP_TYPES.reduce((sum, troop) => sum + counts[troop], 0);
        input = setSimpleCounts(input, sideId, allocateDeployment(total, advancedRatioDrafts[sideId] ?? ratios));
      }
    }
    if (scope === "simple-random") input = { ...input,
      simulationMode: (target as HTMLInputElement).checked ? "random" : "fixedSeed" };
    if (scope === "troop" && target.dataset.field === "count" || scope === "server-stage") {
      simpleRatioDrafts.A = null; simpleRatioDrafts.B = null; advancedRatioDrafts = { A: null, B: null };
    }
    if (scope === "report-source") {
      const side = requireSide(target.dataset.side);
      recognitionState[side].selectedSourceSide = target.value === "right" ? "right" : "left";
      markReportDraftChanged(side);
    }
    if (scope === "report-queue-target") {
      const side = requireSide(target.dataset.side);
      const index = Number(target.value);
      if (index !== 0 && index !== 1 && index !== 2)
        throw new Error("识图目标队列无效。");
      reportQueueTargets[side] = index;
      markReportDraftChanged(side);
    }
    if (scope === "report-final-map") {
      finalReportLeftTarget = target.value === "B" ? "B" : "A";
      finalReportApplied = false;
    }
    if (scope === "report-special-completeness") {
      const side = requireSide(target.dataset.side);
      if (!["complete", "explicitZero", "incomplete"].includes(target.value))
        throw new Error("特殊加成完整性状态无效。");
      recognitionState[side].specialBonusCompleteness = target.value as
        typeof recognitionState.A.specialBonusCompleteness;
      markReportDraftChanged(side);
    }
    if (scope === "report-special-warning") specialWarningsAcknowledged[
      requireSide(target.dataset.side)] = (target as HTMLInputElement).checked;
    if (scope === "report-field") updateReportDraftField(target as HTMLInputElement);
    if (scope !== "server-stage") stageNotice = null;
    if (scope === "troop") updateTroopField(target);
    if (scope === "troop-level-mode") updateTroopLevelMode(target as HTMLSelectElement);
    if (scope === "mixed-level") updateMixedLevel(target as HTMLSelectElement);
    if (scope === "mixed-count") updateMixedCount(target as HTMLInputElement);
    if (scope === "report-hero") updateReportHero(target as HTMLSelectElement);
    if (scope === "report-weapon") updateReportWeapon(target as HTMLSelectElement);
    if (scope === "leader") updateLeader(target as HTMLSelectElement);
    if (scope === "simulation-weapon") updateSimulationWeapon(target as HTMLSelectElement);
    if (scope === "member") updateMember(target as HTMLSelectElement);
    if (scope === "control") updateControl(target as HTMLInputElement);
    if (scope === "batch-count") updateBatchCount(target as HTMLInputElement);
    if (scope === "optimizer") updateOptimizerField(target);
    if (scope === "simple-optimizer") updateSimpleOptimizerField(target);
    if (scope === "three-queue-optimizer") updateThreeQueueOptimizerField(target);
    if (scope === "simulation-mode") {
      input = {
        ...input,
        simulationMode: target.value as "fixedSeed" | "random",
      };
    }
    if (scope === "battle-context") {
      input = {
        ...input,
        battleContext: target.value as NonNullable<typeof input.battleContext>,
      };
    }
    if (scope === "scenario-type") {
      const scenarioType = target.value as BattleScenarioType;
      if (scenarioType !== input.scenarioType) {
        for (const side of ["A", "B"] as const) {
          if (recognitionState[side].reportContext !== null) markReportDraftChanged(side);
        }
      }
      switchScenario(scenarioType);
      if (scenarioType === "INNER_EARTH") heroPoolSide = "A";
    }
    if (scope === "city-territory") input = { ...input, defenderInTerritory: (target as HTMLInputElement).checked };
    if (scope === "inner-earth-mode") input = changeInnerEarthMode(input, target.value);
    if (scope === "inner-earth") input = updateInnerEarthField(input, target.dataset, target.value);
    if (scope === "inner-earth-deployment") input = updateInnerEarthDeployment(input, target.dataset, target.value);
    if (scope === "server-stage") {
      const previousInput = input;
      const stage = target.value as ServerStageId;
      const sanitized = sanitizeConfigForStage(input, stage);
      const previousEarth = input.innerEarth;
      input = sanitized.input.scenarioType === "INNER_EARTH" ? sanitizeInnerEarthForStage(sanitized.input, stage) : sanitized.input;
      input = normalizeIceFireReportLineage(input);
      input = syncOptimizationHeroPoolForStage(previousInput, input);
      stageNotice = sanitized.changed || JSON.stringify(previousEarth) !== JSON.stringify(input.innerEarth)
        ? "服务器阶段已调整，部分超阶段英雄/兵种配置已重置。" : null;
      optimizationConfig = defaultOptimizationConfig(input.randomSeed);
    }
    if (scope === "deployment-capacity") updateDeploymentCapacity(target as HTMLInputElement);
    if (scope === "available-level") updateAvailableLevel(target as HTMLSelectElement);
    if (scope === "three-queue-level") updateThreeQueueLevel(target as HTMLSelectElement);
    if (scope === "queue-ratio") updateQueueRatio(target as HTMLInputElement);
    if (scope === "queue-hero" || scope === "queue-report-hero") updateQueueHero(target as HTMLSelectElement);
    if (scope === "queue-weapon" || scope === "queue-report-weapon" || scope === "queue-t12") updateIceFireQueueSetting(target as HTMLSelectElement);
    if (scope === "ice-fire-shared") updateIceFireSharedField(target as HTMLSelectElement);
    if (scope === "queue-attribute") updateQueueAttribute(target as HTMLInputElement);
    if (scope === "queue-level") updateQueueLevel(target as HTMLSelectElement);
    if (scope === "queue-mixed-level" || scope === "queue-mixed-ratio")
      updateQueueImportedComposition(target);
    if (scope === "queue-external") updateQueueExternalBuff(target as HTMLSelectElement);
    if (scope === "queue-skill-level") updateQueueHeroSkillLevel(target as HTMLSelectElement);
    if (scope === "casualty-mode") input = { ...input,
      postBattleCasualtyMode: target.value as "NORMAL" | "FURNACE" };
    if (scope === "t12") updateT12(target as HTMLInputElement);
    if (scope === "rally") updateRallyField(target as HTMLInputElement);
    if (scope === "bonus-context") updateBonusContext(target);
    if (scope === "external") updateExternalBuff(target as HTMLSelectElement);
    if (scope === "capacity") updateCapacity(target as HTMLInputElement);
    if (scope === "attribute-input-mode") {
      if (input.scenarioType === "INNER_EARTH") throw new Error("地心玩法的属性输入模式固定。");
      input = { ...input, attributeInputMode: target.value as "finalReport" | "prediction" };
    }
    if (scope === "hero-pool") updateHeroPool(target as HTMLInputElement);
    if (scope === "owned-hero") {
      input = setOwnedHero(input, target.dataset.heroId!, (target as HTMLInputElement).checked);
    }
    if (scope === "hero-ownership-scope") input = setHeroOwnershipScope(input, target.value === "allAvailable" ? "allAvailable" : "owned");
    if (scope === "hero-pool-side") heroPoolSide = input.scenarioType === "INNER_EARTH" ? "A" : target.value === "B" ? "B" : "A";
    if (scope === "owned-weapon") updateOwnedWeapon(target as HTMLSelectElement);
    if (scope === "override") updateOverride(target as HTMLSelectElement);
    if (scope === "disable") updateDisabledSkill(target as HTMLInputElement);
    if (scope === "actual") updateActual(target as HTMLInputElement);
    if (scope === "developer") developerMode = (target as HTMLInputElement).checked;
    if (scope === "trace-range") updateTraceRange(target as HTMLInputElement);
    if (doesValidationScopeAffectInput(scope)) {
      revisionState = markValidationInputChanged(revisionState);
      batchResult = null;
      optimizationResult = null;
      simpleOptimizationResult = null;
      threeQueueOptimizationResult = null;
      innerEarthOptimizationResult = null;
    }
    errorMessage = null;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
  render();
});

app.addEventListener("input", (event) => {
  const target = event.target;
  if (typeof HTMLTextAreaElement !== "undefined" && target instanceof HTMLTextAreaElement && target.dataset.scope === "import-config-text") {
    if (appDialog !== null) appDialog.importText = target.value;
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.scope === "dialog-name") {
    if (appDialog !== null) appDialog.name = target.value;
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.scope === "member-search") {
    const sideId = requireSide(target.dataset.side);
    const index = Number(target.dataset.index);
    memberSearchQueries.set(`${sideId}:${index}`, target.value);
    const side = getInputSide(sideId);
    const view = bodySkillOptionsView({ side: sideId, index, stage: validationStageId(input),
      selectedSkillId: side.bodySkills?.[index]?.skillId ?? side.selectedMemberSkillIds[index] ?? "",
      selectedLevel: side.bodySkills?.[index]?.skillLevel ?? 5, query: target.value });
    const slot = target.closest<HTMLElement>("[data-member-slot]");
    const select = slot?.querySelector<HTMLSelectElement>('select[data-scope="member"]');
    const status = slot?.querySelector<HTMLElement>("[data-member-search-status]");
    if (select) select.innerHTML = view.html;
    if (status) status.textContent = view.status;
    return;
  }
  if (!(target instanceof HTMLInputElement) || target.dataset.scope !== "rally") return;
  try {
    updateRallyField(target);
    revisionState = markValidationInputChanged(revisionState);
    batchResult = null;
    optimizationResult = null;
    simpleOptimizationResult = null;
    threeQueueOptimizationResult = null;
    innerEarthOptimizationResult = null;
    const side = requireSide(target.dataset.side);
    const panel = app.querySelector<HTMLElement>(`.side-${side.toLowerCase()}`);
    const deployment = getInputSide(side).rallyDeployment;
    if (panel !== null && deployment !== undefined) {
      const sum = TROOP_TYPES.reduce((total, troop) => total + deployment.ratios[troop], 0);
      const sumOutput = panel.querySelector<HTMLElement>("[data-rally-ratio-sum]");
      if (sumOutput !== null) {
        sumOutput.textContent = `${sum.toFixed(2)}%`;
        sumOutput.className = Math.abs(sum - 100) <= .005 ? "positive" : "negative";
      }
      let counts: Readonly<Record<TroopType, number>> | null = null;
      try { counts = resolveValidationTroopCounts(getInputSide(side), "rally"); } catch { /* incomplete input */ }
      for (const troop of TROOP_TYPES) {
        const output = panel.querySelector<HTMLElement>(`[data-rally-count="${troop}"]`);
        if (output !== null) output.textContent = counts?.[troop].toString() ?? "—";
      }
    }
    const invalid = !rallyDeploymentValid();
    const n0Output = app.querySelector<HTMLOutputElement>("[data-rally-n0]");
    if (n0Output !== null) {
      if (invalid) n0Output.textContent = "—";
      else {
        const a = resolveValidationTroopCounts(input.sideA, "rally");
        const b = resolveValidationTroopCounts(input.sideB, "rally");
        n0Output.textContent = formatNumber(Math.min(
          TROOP_TYPES.reduce((total, troop) => total + a[troop], 0),
          TROOP_TYPES.reduce((total, troop) => total + b[troop], 0),
        ));
      }
    }
    for (const action of ["run", "run-batch", "run-optimizer"]) {
      const button = app.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
      if (button !== null) button.disabled = invalid;
    }
    if (result !== null && app.querySelector(".optimizer-input-stale") === null) {
      app.querySelector(".results")?.insertAdjacentHTML("afterbegin",
        `<div class="error-box optimizer-input-stale">⚠ 当前输入已修改，下方结果来自上一次模拟，请重新运行。</div>`);
    }
    scheduleAutosaveIfChanged();
  } catch { /* final validation and feedback run on change */ }
});

app.addEventListener("toggle", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLDetailsElement)) return;
  const key = target.dataset.expandedSection;
  if (key !== undefined && isExpandedSectionKey(key)) {
    rememberExpandedSection(expandedSections, key, target.open);
  }
}, true);

app.addEventListener("keydown", (event) => {
  if (specialBuffsOpen) {
    const key = event as KeyboardEvent;
    if (key.key === "Escape") {
      event.preventDefault(); specialBuffsOpen = false; render();
      app.querySelector<HTMLElement>(configurationPopup === "troops" ? '[data-action="troops-edit"]' : '.report-stat-source [data-action="special-buffs-open"]')?.focus(); return;
    }
    if (key.key === "Tab") {
      const fields = [...app.querySelectorAll<HTMLElement>('.special-buffs-dialog button, .special-buffs-dialog input, .special-buffs-dialog select, .special-buffs-dialog summary')].filter(node => node.getClientRects().length > 0);
      const first = fields[0], last = fields.at(-1);
      if (first && last && (key.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault(); (key.shiftKey ? last : first).focus();
      }
    }
    return;
  }
  if ((event as KeyboardEvent).key === "Escape" && simpleDetailsOpen) {
    simpleDetailsOpen = false; render(); app.querySelector<HTMLButtonElement>('[data-action="simple-details"]')?.focus(); return;
  }
  if ((event as KeyboardEvent).key === "Tab" && simpleDetailsOpen) {
    const nodes = [...app.querySelectorAll<HTMLElement>('.simple-drawer button, .simple-drawer [href], .simple-drawer [tabindex="0"]')];
    const first = nodes[0], last = nodes.at(-1);
    if (first && last && ((event as KeyboardEvent).shiftKey ? document.activeElement === first : document.activeElement === last)) {
      event.preventDefault(); ((event as KeyboardEvent).shiftKey ? last : first).focus(); return;
    }
  }
  if (appDialog === null) return;
  const keyboard = event as KeyboardEvent;
  if (keyboard.key === "Escape") { event.preventDefault(); appDialog = null; render(); }
  if (keyboard.key === "Enter" && event.target instanceof HTMLInputElement && event.target.dataset.scope === "dialog-name") {
    event.preventDefault(); app.querySelector<HTMLButtonElement>('[data-action="dialog-confirm"]')?.click();
  }
  if (keyboard.key === "Tab") {
    const fields = [...app.querySelectorAll<HTMLElement>('.app-dialog input, .app-dialog textarea, .app-dialog button')];
    const first = fields[0], last = fields.at(-1);
    if (keyboard.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!keyboard.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});

app.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const actionTarget = target.closest<HTMLElement>("[data-action]");
  const action = actionTarget?.dataset.action;
  if (action === "troops-edit" || action === "special-buffs-open" || action === "special-buffs-close" || action === "special-buffs-side") {
    captureExpandedSections();
    if (action === "troops-edit" || action === "special-buffs-open") configurationPopup = action === "troops-edit" ? "troops" : "buffs";
    if (action === "troops-edit") specialBuffsSide = actionTarget?.dataset.side === "B" ? "B" : "A";
    specialBuffsOpen = action !== "special-buffs-close";
    if (action === "special-buffs-side") specialBuffsSide = actionTarget?.dataset.side === "B" ? "B" : "A";
    render();
    app.querySelector<HTMLElement>(specialBuffsOpen ? '.special-buffs-dialog [aria-selected="true"]' : configurationPopup === "troops" ? '[data-action="troops-edit"]' : '[data-action="special-buffs-open"]')?.focus();
    return;
  }
  if ((action === "combat-buff-preset" || action === "apply-historical-base") && actionTarget) {
    captureExpandedSections();
    try {
      if (batchRunning || optimizationRunning) return;
      if (action === "apply-historical-base") applyHistoricalBase(requireSide(actionTarget.dataset.side), actionTarget.dataset.queueIndex);
      else {
        const preset = actionTarget.dataset.preset as CombatBuffPreset;
        if (!["small", "large", "pets", "off"].includes(preset)) throw new Error("无效Buff预设。");
        if (actionTarget.dataset.side === "earth") {
          const config = getInnerEarthConfig(input);
          if (!getInnerEarthRule(config.subMode).allowPet) throw new Error("当前地心玩法不使用宠物。");
          const buffs = combatBuffPreset({ ...DEFAULT_EXTERNAL_BUFF_CONFIG, pet: config.petContext ?? DEFAULT_EXTERNAL_BUFF_CONFIG.pet }, preset);
          input = normalizeInnerEarthInput(input, { ...config, petContext: buffs.pet });
        } else {
          const sideId = requireSide(actionTarget.dataset.side), side = getInputSide(sideId);
          if (isIceFireInput(input)) {
            const shared = iceFireSharedContext(side);
            const buffs = combatBuffPreset({ town: DEFAULT_EXTERNAL_BUFF_CONFIG.town, pet: shared.petContext, expert: shared.expertContext }, preset);
            setInputSide(sideId, { ...side, shared: { ...shared, petContext: buffs.pet } });
          } else setInputSide(sideId, { ...side, externalBuffs: combatBuffPreset(side.externalBuffs ?? DEFAULT_EXTERNAL_BUFF_CONFIG, preset) });
        }
      }
      revisionState = markValidationInputChanged(revisionState);
      batchResult = null; optimizationResult = null; simpleOptimizationResult = null;
      threeQueueOptimizationResult = null; innerEarthOptimizationResult = null; errorMessage = null;
    } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    render(); return;
  }
  if (action === undefined) return;
  if (action === "export-skill-statistics") {
    const value = actionTarget?.dataset.statSource === "single" ? result :
      batchResult && !("attackerWins" in batchResult) ? batchResult : null;
    if (value !== null) downloadConfig(JSON.stringify(skillStatisticsExport(value)), "技能统计");
    return;
  }
  if (["export-battle-input", "export-battle-result", "copy-battle-input"].includes(action)) {
    if (!developerToolsEnabled || result === null) return;
    try {
      if (action === "copy-battle-input") void copyText(JSON.stringify(result.input, null, 2), "BattleInput 已复制");
      else {
        const kind = action === "export-battle-input" ? "input" : "result";
        downloadBattleJson(kind, kind === "input" ? result.input : result.simulation, result.input.randomSeed);
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      render();
    }
    return;
  }
  if (["download-optimizer-fixture", "copy-optimizer-fixture", "import-optimizer-fixture", "import-run-optimizer-fixture"].includes(action)) {
    if (!developerToolsEnabled || optimizationRunning) return;
    if (action === "download-optimizer-fixture" || action === "copy-optimizer-fixture") {
      void createOptimizerBenchmarkFixture(input, optimizationConfig, batchCount).then(async (fixture) => {
        const json = JSON.stringify(fixture, null, 2);
        if (action === "download-optimizer-fixture") downloadConfig(json, "完整优化BenchmarkFixture");
        else await navigator.clipboard.writeText(json);
        showToast(action === "download-optimizer-fixture" ? "完整优化 Benchmark Fixture 已下载" : "完整优化 Benchmark Fixture 已复制");
      }).catch((error) => { errorMessage = error instanceof Error ? error.message : String(error); render(); });
    } else appDialog = { title: "导入完整优化 Benchmark Fixture", importText: "", confirmLabel: action === "import-run-optimizer-fixture" ? "导入并复跑" : "校验并导入",
      onConfirm: (text) => { void importOptimizerFixture(text, action === "import-run-optimizer-fixture"); } };
    render(); return;
  }
  if (!developerToolsEnabled && ["disable-random", "auto-random", "copy-input", "copy-trace", "copy-result", "copy-optimizer-performance"].includes(action)) return;
  if (action === "lineup-actions-toggle") { lineupActionsOpen = !lineupActionsOpen; render(); return; }
  if (action === "editor-mode") {
    captureExpandedSections();
    editorMode = actionTarget?.dataset.mode === "advanced" ? "advanced" : "simple";
    simpleDetailsOpen = false;
    playerSingleDetailsOpen = false;
    simpleRatioDrafts.A = null; simpleRatioDrafts.B = null;
    try { window.localStorage.setItem(EDITOR_MODE_KEY, editorMode); } catch { /* preference is optional */ }
    if (window.history?.replaceState) {
      const url = new URL(location.href); url.searchParams.set("mode", editorMode);
      window.history.replaceState(null, "", url);
    }
    render(); return;
  }
  if (action === "simple-details" || action === "simple-close-details" || action === "player-single-details") {
    captureExpandedSections(); simpleDetailsOpen = action !== "simple-close-details";
    playerSingleDetailsOpen = action === "player-single-details"; render();
    app.querySelector<HTMLElement>(simpleDetailsOpen ? '.simple-drawer button' : '[data-action="simple-details"]')?.focus();
    return;
  }
  if (action === "developer-focus-raw" && developerToolsEnabled) {
    simpleDetailsOpen = false; playerSingleDetailsOpen = false; render();
    const tools = app.querySelector<HTMLDetailsElement>(".developer-tools");
    if (tools) { tools.open = true; lazyDetails.toggle(tools); }
    const raw = app.querySelector<HTMLDetailsElement>('[data-dev-group="raw"]');
    if (raw) { raw.open = true; lazyDetails.toggle(raw); raw.scrollIntoView({ block: "start" }); }
    return;
  }
  if (action === "simple-share") {
    try {
      const url = new URL(location.href); url.search = "";
      url.hash = new URLSearchParams({ s: encodeSimpleShare(input, batchCount) }).toString();
      void copyText(url.href, "分享链接已复制");
    } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); render(); }
    return;
  }
  if (action === "simple-troop-mode" && actionTarget !== null) {
    captureExpandedSections();
    const side = requireSide(actionTarget.dataset.side);
    simpleTroopModes[side] = actionTarget.dataset.value === "ratio" ? "ratio" : "count";
    // Only changing the editor cannot round or reallocate any troops.
    if (simpleTroopModes[side] === "count") simpleRatioDrafts[side] = null;
    render(); return;
  }
  if ((action === "simple-copy-attributes" || action === "simple-preset") && actionTarget !== null) {
    captureExpandedSections();
    try {
      if (batchRunning) return;
      const side = requireSide(actionTarget.dataset.side);
      if (action === "simple-copy-attributes") input = copySimpleAttributes(input, side);
      else {
        const values = (actionTarget.dataset.value ?? "").split("/").map(Number);
        const ratios = { shield: values[0]!, lancer: values[1]!, marksman: values[2]! };
        input = setSimpleRatios(input, side, simpleTroopTotal(input, side), ratios);
        simpleRatioDrafts[side] = ratios;
      }
      revisionState = markValidationInputChanged(revisionState); batchResult = null;
      errorMessage = null;
    } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    render(); return;
  }
  if (action === "dialog-cancel") { appDialog = null; render(); return; }
  if (action === "dialog-confirm" && appDialog !== null) {
    const current = appDialog;
    try { current.onConfirm(current.importText ?? current.name ?? ""); if (appDialog === current) appDialog = null;
      refreshSavedProfiles(); errorMessage = null;
    } catch (error) { current.error = error instanceof Error ? error.message : String(error); }
    render(); return;
  }
  if (action === "confirm-attribute-group" && actionTarget !== null) {
    try {
      const side = requireSide(actionTarget.dataset.side), key = actionTarget.dataset.key ?? "";
      const field = app.querySelector<HTMLInputElement>(`[data-scope="attribute-report-field"][data-side="${side}"][data-key="${key}"]`);
      updateAttributeReportField(side, key, field?.value ?? ""); errorMessage = null;
    } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    render(); return;
  }
  captureExpandedSections();
  if (action === "swap-ice-fire-queues" && actionTarget !== null) {
    try { input = swapIceFireQueues(input, requireSide(actionTarget.dataset.side), Number(actionTarget.dataset.first), Number(actionTarget.dataset.second)); revisionState = markValidationInputChanged(revisionState); errorMessage = null; }
    catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    render(); return;
  }
  if (action === "confirm-report-bonus" && actionTarget !== null) {
    try {
      const side = requireSide(actionTarget.dataset.side), source = actionTarget.dataset.source === "right" ? "right" : "left";
      const draft = recognitionState[side].reportContext, column = draft?.[source], group = actionTarget.dataset.group;
      const index = Number(actionTarget.dataset.index);
      if (!draft || !column || !["additive", "buffs", "debuffs"].includes(group ?? "")) throw new Error("特殊加成行无效。");
      const typed = group as "additive" | "buffs" | "debuffs", bonuses = column.specialBonuses, item = bonuses?.[typed][index];
      if (!bonuses || !item || item.conflict) throw new Error("请先选择冲突数值或修改数值再确认。");
      recognitionState[side].reportContext = { ...draft, [source]: { ...column, specialBonuses: { ...bonuses, [typed]: bonuses[typed].map((entry, row) => row !== index ? entry : { ...entry, amount: { ...entry.amount, confirmed: true, needsConfirmation: false } }) } } };
      markReportDraftChanged(side); errorMessage = null;
    } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    render(); return;
  }
  if (action === "apply-report-side" && actionTarget !== null) {
    try {
      const side = requireSide(actionTarget.dataset.side);
      const draft = recognitionState[side].reportContext;
      if (draft === null) throw new Error("请先上传并检查图片。");
      const context = recognitionState[side];
      const parsed = draft[context.selectedSourceSide];
      if (parsed === undefined) throw new Error("未识别到所选侧，请切换读取侧。");
      input = applyRecognizedAttributeReport(input, draft, context.selectedSourceSide, side, context.specialBonusCompleteness, reportQueueTargets[side]);
      reportApplied[side] = true;
      revisionState = markValidationInputChanged(revisionState);
      errorMessage = null;
    } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    render();
    return;
  }
  if (action === "apply-final-report") {
    try {
      if (finalReportDraft === null) throw new Error("请先上传双方战报。");
      input = mapDoubleSidedFinalReport(input, finalReportDraft, finalReportLeftTarget);
      finalReportApplied = true;
      revisionState = markValidationInputChanged(revisionState);
      errorMessage = null;
    } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    render();
    return;
  }
  if (action === "add-report-bonus" && actionTarget !== null) {
    try { addManualReportBonus(requireSide(actionTarget.dataset.side),
      actionTarget.dataset.source === "right" ? "right" : "left"); errorMessage = null; }
    catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    render();
    return;
  }
  if (action === "remove-report-bonus" && actionTarget !== null) {
    try { removeReportBonus(requireSide(actionTarget.dataset.side),
      actionTarget.dataset.group, Number(actionTarget.dataset.index),
      actionTarget.dataset.source === "right" ? "right" : "left");
    errorMessage = null; }
    catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    render();
    return;
  }
  if ((action === "confirm-unknown-bonus" || action === "remove-unknown-bonus") &&
    actionTarget !== null) {
    try {
      resolveUnknownReportBonus(requireSide(actionTarget.dataset.side),
        Number(actionTarget.dataset.index), action === "confirm-unknown-bonus",
        actionTarget.dataset.source === "right" ? "right" : "left");
      errorMessage = null;
    } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    render();
    return;
  }
  if (action === "clear-report-context" && actionTarget !== null) {
    const side = requireSide(actionTarget.dataset.side);
    recognitionState = clearRecognitionContext(recognitionState, side);
    reportRequestVersions[side] += 1;
    markReportDraftChanged(side);
    specialWarningsAcknowledged[side] = false;
    errorMessage = null;
    render();
    return;
  }
  if (action === "select-report-bonus-candidate" && actionTarget !== null) {
    try {
      const side = requireSide(actionTarget.dataset.side);
      const source = actionTarget.dataset.source === "right" ? "right" : "left";
      const group = actionTarget.dataset.group;
      const draft = recognitionState[side].reportContext;
      const column = draft?.[source];
      const index = Number(actionTarget.dataset.index);
      if (draft === null || column === undefined ||
        group !== "additive" && group !== "buffs" && group !== "debuffs")
        throw new Error("特殊加成候选上下文无效。");
      const bonuses = column.specialBonuses;
      const bonus = bonuses?.[group][index];
      if (bonuses === undefined || bonus === undefined) throw new Error("特殊加成候选行无效。");
      const selected = selectSpecialBonusCandidate(bonus, Number(actionTarget.dataset.candidate));
      recognitionState[side].reportContext = { ...draft, [source]: { ...column,
        specialBonuses: { ...bonuses, [group]: bonuses[group].map((item, row) =>
          row === index ? selected : item) } },
        warnings: draft.warnings.filter((warning) => !warning.startsWith("特殊加成冲突")) };
      markReportDraftChanged(side);
      errorMessage = null;
    } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    render();
    return;
  }
  if (action === "hero-pool-all" || action === "hero-pool-none") {
    input = setOptimizationPoolEnabled(input, heroPoolSide, action === "hero-pool-all");
    revisionState = markValidationInputChanged(revisionState);
    render();
    return;
  }
  if (action === "hero-pool-own-current") {
    for (const id of configuredHeadHeroIds(input).filter((id) => isHeroAvailableAtStage(id, validationStageId(input))))
      input = setOwnedHero(input, id, true);
    revisionState = markValidationInputChanged(revisionState);
    render();
    return;
  }
  if (action === "import-config") {
    appDialog = { title: "导入阵容配置", importText: "", confirmLabel: "解析并预览", onConfirm: (text) => previewConfigurationImport(text) };
    render();
    return;
  }
  if (action === "open-optimizer") {
    optimizerPanelOpen = !optimizerPanelOpen;
    if (optimizerPanelOpen) {
      const next = initializeOptimizerWeaponLevels(input,
        catalog.leaderHeroes.filter((hero) => isHeroAvailableAtStage(hero,
          validationStageId(input))));
      if (next !== input) {
        input = next;
        revisionState = markValidationInputChanged(revisionState);
      }
    }
    render();
    if (optimizerPanelOpen) app.querySelector(".optimizer-panel")?.scrollIntoView({
      behavior: "smooth", block: "start" });
    return;
  }
  if (["save-profile", "load-profile", "rename-profile", "copy-profile",
    "delete-profile", "export-profile", "export-config"].includes(action)) {
    try {
      const storage = requireConfigStorage();
      if (action === "save-profile") {
        const label = input.scenarioType === "INNER_EARTH" ? `地心-${INNER_EARTH_MODE_LABELS[getInnerEarthConfig(input).subMode]}` : battleSceneLabel(input);
        const date = new Date();
        const defaultName = `${label}-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
        appDialog = { title: "保存方案", name: defaultName, confirmLabel: "保存", onConfirm: (name) => {
          const created = createSavedProfile(name, input, batchCount, optimizationConfig, undefined, undefined, simpleOptimizerOptions, threeQueueOptimizerOptions);
          const previous = storage.listProfiles().find((profile) => profile.name === created.name);
          if (previous === undefined) storage.saveProfile(created);
          else appDialog = { title: "覆盖方案", message: `覆盖已有方案“${previous.name}”？`, confirmLabel: "覆盖", onConfirm: () => {
            storage.saveProfile({ ...created, id: previous.id, createdAt: previous.createdAt });
          } };
        } };
      }
      if (action === "load-profile" && actionTarget !== null) {
        const profile = profileByAction(actionTarget);
        const loaded = restorePersistedConfig(profileEnvelope(profile));
        const restored = { ...loaded, ...(profile.optimizerRacingMigrated ? { optimizerRacingMigrated: true } : {}),
          ...(profile.headPoolOwnershipMigrated ? { headPoolOwnershipMigrated: true } : {}), queueAttributesMigrated:
          profile.queueAttributesMigrated === true || loaded.queueAttributesMigrated };
        appDialog = { title: "载入方案", message: importPreview(restored), confirmLabel: "载入", onConfirm: () => applyRestoredSetup(restored, "方案") };
      }
      if (action === "rename-profile" && actionTarget !== null) {
        const profile = profileByAction(actionTarget);
        appDialog = { title: "重命名方案", name: profile.name, confirmLabel: "保存", onConfirm: (name) => storage.saveProfile(renameSavedProfile(profile, name)) };
      }
      if (action === "copy-profile" && actionTarget !== null) {
        storage.saveProfile(copySavedProfile(profileByAction(actionTarget)));
      }
      if (action === "delete-profile" && actionTarget !== null) {
        const profile = profileByAction(actionTarget);
        appDialog = { title: "删除方案", message: `删除方案“${profile.name}”？`, confirmLabel: "删除", onConfirm: () => storage.deleteProfile(profile.id) };
      }
      if (action === "export-profile" && actionTarget !== null) {
        const profile = profileByAction(actionTarget);
        downloadConfig(JSON.stringify(profileEnvelope(profile), null, 2), profile.name);
      }
      if (action === "export-config") {
        downloadConfig(exportPersistedJson(input, batchCount, optimizationConfig,
          simpleOptimizerOptions, threeQueueOptimizerOptions),
          `${getServerStage(validationStageId(input)).label}-${input.scenarioType ?? "SINGLE"}`);
      }
      refreshSavedProfiles();
      errorMessage = null;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    render();
    return;
  }
  if (action === "add-mixed-level" && actionTarget !== null) {
    addMixedLevel(actionTarget);
    revisionState = markValidationInputChanged(revisionState);
    batchResult = null;
    optimizationResult = null;
    render();
  }
  if (action === "remove-mixed-level" && actionTarget !== null) {
    removeMixedLevel(actionTarget);
    revisionState = markValidationInputChanged(revisionState);
    batchResult = null;
    optimizationResult = null;
    render();
  }
  if (action === "run") runBattle();
  if (action === "run-batch") void runBatch();
  if (action === "run-optimizer") void runOptimizer();
  if (action === "cancel-optimizer") cancelOptimizerRun?.();
  if (action === "copy-optimizer-performance" && optimizationPerformanceReport !== null) {
    void navigator.clipboard.writeText(JSON.stringify(optimizationPerformanceReport, null, 2))
      .then(() => { storageNotice = "性能报告 JSON 已复制。"; render(); })
      .catch((error: unknown) => { errorMessage = error instanceof Error ? error.message : String(error); render(); });
  }
  if (action === "apply-simple-optimizer" && actionTarget !== null) {
    applySimpleOptimizationCandidate(Number(actionTarget.dataset.index));
  }
  if (action === "apply-three-queue-optimizer" && actionTarget !== null) {
    applyThreeQueueOptimizationCandidate(Number(actionTarget.dataset.index));
  }
  if (action === "apply-inner-earth-optimizer" && actionTarget !== null) {
    try {
      const row = innerEarthOptimizationResult?.result.topCandidates[Number(actionTarget.dataset.index)];
      if (innerEarthOptimizationResult === null || row === undefined ||
        innerEarthResultRevision !== revisionState.inputRevision) throw new Error("推荐方案已失效，请重新优化。");
      applyOptimizedInput(applyInnerEarthCandidate(input, innerEarthOptimizationResult, row.candidate),
        "已应用地心推荐英雄与比例；基础属性、宠物及敌方配置保持原输入。");
    } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); render(); }
  }
  if (action === "apply-rally-optimizer" && actionTarget !== null) {
    applyRallyOptimizationCandidate(Number(actionTarget.dataset.index));
  }
  if (action === "apply-rally-wave" && actionTarget !== null) {
    applyRallyOptimizationWave(Number(actionTarget.dataset.index));
  }
  if (action === "verify-optimizer" && actionTarget !== null) void verifyOptimizerCandidate(actionTarget);
  if (action === "reset" || action === "restore-default") {
    if (autosaveTimer !== null) clearTimeout(autosaveTimer);
    autosaveTimer = null;
    try { configStorage?.clearAutosave(); }
    catch (error) {
      storageStatus = "error";
      storageNotice = error instanceof Error ? error.message : "清除自动存档失败。";
    }
    input = createScenarioDefault(scenarioStateKey(input), validationStageId(input));
    simpleRatioDrafts.A = null; simpleRatioDrafts.B = null; advancedRatioDrafts = { A: null, B: null };
    result = null;
    batchCount = DEFAULT_BATCH_SIMULATION_COUNT;
    batchResult = null;
    optimizationConfig = defaultOptimizationConfig(input.randomSeed);
    simpleOptimizerOptions = defaultSimpleScenarioOptimizationOptions(input.randomSeed);
    threeQueueOptimizerOptions = defaultThreeQueueOptimizationOptions(input.randomSeed);
    optimizationResult = null;
    simpleOptimizationResult = null;
    threeQueueOptimizationResult = null;
  innerEarthOptimizationResult = null;
    revisionState = createValidationResultRevisionState();
    errorMessage = null;
    stageNotice = null;
    storageNotice = "已恢复默认配置；命名方案已保留。";
    if (storageStatus !== "error") storageStatus = "idle";
    lastQueuedStorageSnapshot = "";
    render();
  }
  if (action === "replay-seed" && result !== null) {
    input = replayValidationSeed(input, result.input.randomSeed);
    revisionState = markValidationInputChanged(revisionState);
    batchResult = null;
    optimizationResult = null;
    render();
  }
  if (action === "disable-random") {
    input = { ...input, triggerOverrides: allRandomOverridesOff() };
    revisionState = markValidationInputChanged(revisionState);
    batchResult = null;
    optimizationResult = null;
    render();
  }
  if (action === "auto-random") {
    input = {
      ...input,
      triggerOverrides: resetAllProbabilityOverrides(input.triggerOverrides),
    };
    revisionState = markValidationInputChanged(revisionState);
    batchResult = null;
    optimizationResult = null;
    render();
  }
  if (action === "copy-a-to-b") {
    input = copySideAToB(input);
    revisionState = markValidationInputChanged(revisionState);
    batchResult = null;
    optimizationResult = null;
    errorMessage = null;
    render();
  }
  if (action === "swap-sides") {
    input = swapBattleSides(input);
    revisionState = markValidationInputChanged(revisionState);
    batchResult = null;
    optimizationResult = null;
    errorMessage = null;
    render();
  }
  if (action === "copy-input") void copyText(JSON.stringify(input, null, 2), "BattleInput 已复制");
  if (action === "copy-trace" && result !== null) {
    void copyText(JSON.stringify(result.trace, null, 2), "BattleTrace 已复制");
  }
  if (action === "copy-result" && result !== null) {
    void copyText(JSON.stringify(result.simulation, null, 2), "BattleResult 已复制");
  }
});

const unregisterWebMcp = registerValidationWebMcp({
  run(parameters) {
    if (parameters.randomSeed !== undefined || parameters.maxRounds !== undefined) {
      revisionState = markValidationInputChanged(revisionState);
      batchResult = null;
      optimizationResult = null;
    }
    input = {
      ...input,
      ...(parameters.randomSeed === undefined
        ? {}
        : { randomSeed: parameters.randomSeed }),
      ...(parameters.maxRounds === undefined
        ? {}
        : { maxRounds: parameters.maxRounds }),
    };
    runBattle();
    if (result === null) throw new Error(errorMessage ?? "Validation battle failed.");
    return {
      summary: result.summary,
      roundDamage: result.roundDamage,
      ruleUnknown: CURRENT_ENGINE_RULE_UNKNOWNS,
    };
  },
  onRegistrationError(error) {
    errorMessage = `WebMCP registration failed: ${error instanceof Error ? error.message : String(error)}`;
    render();
  },
});
window.addEventListener("beforeunload", unregisterWebMcp, { once: true });
window.addEventListener("beforeunload", () => {
  if (autosaveTimer === null || configStorage === null) return;
  clearTimeout(autosaveTimer); autosaveTimer = null;
  try {
    scenarioStates.save(currentScenarioState());
    configStorage.saveAutosave(input, batchCount, optimizationConfig, simpleOptimizerOptions, threeQueueOptimizerOptions);
  } catch (error) { console.warn("离开页面时配置未能保存", error); }
});
perfMark("ui interactive");
perfMeasure("initialization", "app init start", "ui interactive");

function captureExpandedSections(): void {
  for (const details of app.querySelectorAll<HTMLDetailsElement>(
    "details[data-expanded-section]",
  )) {
    const key = details.dataset.expandedSection;
    if (key !== undefined && isExpandedSectionKey(key)) {
      rememberExpandedSection(expandedSections, key, details.open);
    }
  }
}

function storageSnapshot(): string {
  return JSON.stringify({ input, batchCount, optimizationConfig,
    simpleOptimizerOptions, threeQueueOptimizerOptions });
}

function currentScenarioState(): ScenarioEditorState {
  return { input, simulationCount: batchCount, optimizationConfig, simpleOptimizerOptions, threeQueueOptimizerOptions };
}

function createScenarioDefault(scenarioType: BattleScenarioType, serverStage: ServerStageId): typeof input {
  let fresh = normalizeBattleInputPolicy({ ...createPlayerDefaultInput(), serverStage, scenarioType,
    battleContext: scenarioType === "CITY_DEFENSE" ? "cityDefense" : scenarioType === "RALLY" ? "rally" : "challenge",
    ...(scenarioType === "ICE_FIRE_LEAGUE" ? { attributeInputMode: "prediction" as const, threeQueueMode: "ICE_FIRE_LEAGUE" as const } : {}) });
  fresh = sanitizeConfigForStage(fresh, serverStage).input;
  if (scenarioType === "INNER_EARTH") fresh = normalizeInnerEarthInput(fresh);
  return normalizeIceFireReportLineage(fresh);
}

function switchScenario(scenarioType: BattleScenarioType): void {
  if (scenarioType === scenarioStateKey(input)) return;
  try { scenarioStates.save(currentScenarioState()); }
  catch (error) { storageNotice = `本场景暂未持久保存：${error instanceof Error ? error.message : String(error)}；页面内草稿仍保留。`; }
  let saved = scenarioStates.read(scenarioType);
  if (saved === null) {
    const fresh = createScenarioDefault(scenarioType, validationStageId(input));
    saved = { input: fresh, simulationCount: batchCount, optimizationConfig: defaultOptimizationConfig(fresh.randomSeed),
      simpleOptimizerOptions: defaultSimpleScenarioOptimizationOptions(fresh.randomSeed),
      threeQueueOptimizerOptions: defaultThreeQueueOptimizationOptions(fresh.randomSeed) };
  }
  input = saved.input; batchCount = saved.simulationCount;
  optimizationConfig = saved.optimizationConfig; simpleOptimizerOptions = saved.simpleOptimizerOptions;
  threeQueueOptimizerOptions = saved.threeQueueOptimizerOptions;
  simpleRatioDrafts.A = null; simpleRatioDrafts.B = null;
  advancedRatioDrafts = { A: null, B: null };
  simpleTroopModes.A = "count"; simpleTroopModes.B = "count";
  result = null; threeQueueResult = null; batchResult = null;
  simpleOptimizationResult = null; threeQueueOptimizationResult = null; innerEarthOptimizationResult = null;
}

function updateStorageStatus(): void {
  const label = app.querySelector<HTMLElement>("[data-storage-status]");
  if (label !== null) label.textContent = storageStatus === "saving" ? "保存中…"
    : storageStatus === "saved" ? "● 已自动保存"
      : storageStatus === "error" ? "本地保存失败" : "尚未保存";
}

function scheduleAutosaveIfChanged(): void {
  const references = [input, batchCount, optimizationConfig,
    simpleOptimizerOptions, threeQueueOptimizerOptions];
  if (references.every((value, index) => value === lastAutosaveReferences[index])) return;
  lastAutosaveReferences = references;
  const snapshot = storageSnapshot();
  if (snapshot === lastQueuedStorageSnapshot) return;
  lastQueuedStorageSnapshot = snapshot;
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  if (configStorage === null) {
    storageStatus = "error";
    updateStorageStatus();
    return;
  }
  storageStatus = "saving";
  updateStorageStatus();
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    try {
      scenarioStates.save(currentScenarioState());
      configStorage!.saveAutosave(input, batchCount, optimizationConfig,
        simpleOptimizerOptions, threeQueueOptimizerOptions);
      storageStatus = "saved";
      if (storageNotice?.startsWith("三队列比例待完成：")) storageNotice = null;
    } catch (error) {
      const pending = isThreeQueueBattleInput(input) ? (["A", "B"] as const)
        .flatMap((sideId) => getValidationThreeQueues(sideId === "A" ? input.sideA : input.sideB)
          .flatMap((queue, index) => {
            try { toThreeQueueBasisPoints(queue.ratios); return []; }
            catch { return [`${sideId}${index + 1}`]; }
          })) : [];
      storageStatus = pending.length > 0 ? "idle" : "error";
      storageNotice = pending.length > 0
        ? `三队列比例待完成：${pending.join("、")} 的盾/矛/射需各自合计 100%。`
        : error instanceof Error ? `自动保存失败：${error.message}` : "自动保存失败。";
    }
    updateStorageStatus();
  }, 400);
}

function applyRestoredSetup(restored: RestoredBattleSetup, source: string): void {
  scenarioStates.remember(currentScenarioState());
  input = restored.input;
  batchCount = restored.simulationCount;
  optimizationConfig = restored.optimizationConfig;
  simpleOptimizerOptions = restored.simpleOptimizerOptions;
  threeQueueOptimizerOptions = restored.threeQueueOptimizerOptions;
  heroPoolSide = optimizerRoute(input.scenarioType) === "rally" ? optimizationConfig.candidateSide ?? "A" :
    isThreeQueueBattleInput(input) ? threeQueueOptimizerOptions.side : simpleOptimizerOptions.side;
  result = null;
  threeQueueResult = null;
  batchResult = null;
  optimizationResult = null;
  simpleOptimizationResult = null;
  threeQueueOptimizationResult = null;
  innerEarthOptimizationResult = null;
  revisionState = createValidationResultRevisionState();
  stageNotice = restored.adjusted
    ? "已根据服务器阶段调整部分过期或超阶段配置。" : null;
  storageNotice = restored.queueAttributesMigrated
    ? "旧三队列配置已复制为三个队伍相同属性，请根据实际战报调整。"
    : `${source}已载入${restored.migrated ? "，旧字段已按当前输入规则迁移，请核对属性与优化设置" : ""}。`;
  if (restored.sceneMigrationWarnings?.length) storageNotice = [storageNotice, ...restored.sceneMigrationWarnings].filter(Boolean).join(" ");
  if (restored.optimizerRacingMigrated) storageNotice += ` ${optimizerRacingMigrationNotice}`;
  if (restored.headPoolOwnershipMigrated) storageNotice += ` ${headPoolOwnershipMigrationNotice}`;
  errorMessage = null;
  lastQueuedStorageSnapshot = "";
  render();
}

async function importOptimizerFixture(text: string, rerun: boolean): Promise<void> {
  if (optimizationRunning) return;
  try {
    const restored = await restoreOptimizerBenchmarkFixture(text);
    applyRestoredSetup(restored, "完整优化 Benchmark Fixture");
    optimizerPanelOpen = true;
    storageNotice = "已校验完整 Fixture；Head/Body 空间、共同种子和全部优化参数已恢复。";
    render();
    if (rerun) await runOptimizer();
  } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); render(); }
}

function requireConfigStorage(): LocalStorageConfigStorage {
  if (configStorage === null) throw new Error("浏览器本地存储不可用。");
  return configStorage;
}

function refreshSavedProfiles(): void {
  savedProfiles = requireConfigStorage().listProfiles();
  profilesLoaded = true;
}

function profileByAction(target: HTMLElement): SavedBattleProfile {
  const id = target.dataset.profileId;
  if (id === undefined) throw new Error("缺少方案 ID。");
  const profile = requireConfigStorage().getProfile(id);
  if (profile === null) throw new Error("方案不存在或已删除。");
  return profile;
}

function profileEnvelope(profile: SavedBattleProfile) {
  return { schemaVersion: profile.schemaVersion,
    savedAt: profile.updatedAt, data: profile.data };
}

function filenamePart(value: string): string {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60) || "config";
}

function downloadConfig(json: string, name: string): void {
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `wos-pvp-${filenamePart(name)}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function previewConfigurationImport(text: string): void {
  const restored = parseConfigurationImport(text, batchCount);
  appDialog = { title: "导入阵容配置", message: importPreview(restored), confirmLabel: "载入阵容", onConfirm: () => applyRestoredSetup(restored, "导入配置") };
  render();
}

function importPreview(restored: RestoredBattleSetup): string {
  const stage = getServerStage(validationStageId(restored.input));
  const scenario = restored.input.scenarioType ?? "SINGLE";
  const leaderNames = (side: ValidationSideInput) =>
    Object.values(side.leaderHeroIds ?? {}).filter((id): id is string => !!id)
      .map((id) => catalog.reportHeroes.find((hero) => hero.heroId === id)?.name ?? id)
      .join(" / ") || "未配置车头";
  return `载入后会覆盖当前编辑配置。\n服务器阶段：${stage.label}\n战斗场景：${scenario}\n进攻方：${leaderNames(restored.input.sideA)}\n防守方：${leaderNames(restored.input.sideB)}${restored.adjusted ? "\n部分超阶段配置将被调整。" : ""}${restored.migrated ? "\n旧版本配置将被迁移。" : ""}${restored.queueAttributesMigrated ? "\n旧三队列配置已复制为三个队伍相同属性，请根据实际战报调整。" : ""}\n\n确认载入？`;
}

async function importConfigFile(file: File | null): Promise<void> {
  if (file === null) return;
  try {
    previewConfigurationImport(await file.text());
  } catch (error) {
    errorMessage = error instanceof Error ? `导入失败：${error.message}` : "导入失败。";
    render();
  }
}

function render(): void {
  input = normalizeBattleInputPolicy(input);
  if (!developerToolsEnabled) input = normalizePlayerHeroLevels(input);
  const popupScroll = app.querySelector<HTMLElement>('.special-buffs-dialog')?.scrollTop ?? 0;
  try { renderApp(); const popup = app.querySelector<HTMLElement>('.special-buffs-dialog'); if (popup) popup.scrollTop = popupScroll; updateStorageStatus(); queueMicrotask(scheduleAutosaveIfChanged); }
  catch (error) { console.error("PVP UI render failed", error); renderFatalError(error); }
}

function renderApp(): void {
  lazyDetails.beginRender();
  const initial = performance.getEntriesByName("pvp:initial render start").length === 0;
  if (initial) perfMark("initial render start");
  const recognitionPending = pendingRecognitionSides().length > 0;
  const preview = null;
  const resultIsStale = recognitionPending ||
    (result !== null || threeQueueResult !== null) && isValidationResultStale(revisionState);
  if (editorMode === "simple") {
    app.innerHTML = `<main class="shell simple-shell" ${simpleDetailsOpen ? "inert" : ""}>
      ${renderModeHeader(editorMode)}
      ${errorMessage === null ? "" : `<div class="error-box" role="alert">${escapeHtml(errorMessage)}</div>`}
      ${stageNotice === null ? "" : `<div class="stage-notice" role="status">${escapeHtml(stageNotice)}</div>`}
      ${storageNotice === null ? "" : `<div class="stage-notice" role="status">${escapeHtml(storageNotice)}</div>`}
      ${renderSimpleMode({ input, count: batchCount, running: batchRunning, progress: batchProgress,
        blocked: recognitionPending || (input.battleContext === "rally" && input.attributeInputMode === "prediction" && !rallyDeploymentValid()) ||
          ((isThreeQueueBattleInput(input) || input.scenarioType === "INNER_EARTH") && !threeQueueValid()),
        result: batchResult, troopModes: simpleTroopModes, ratioDrafts: simpleRatioDrafts,
        detailsOpen: false, developer: developerToolsEnabled, renderAttributes: renderAttributeInputs, renderBuffs: renderExternalBuffs,
        renderMoreBuffs: renderSimpleMoreBuffs,
        renderFold: (key, summary, body) => lazyDetails.render(key, summary, body, 'class="simple-fold"'),
      })}${developerToolsEnabled ? renderDeveloperTools(preview, resultIsStale) : ""}</main>${simpleDetailsOpen ? renderSimpleResultDrawer() : ""}`;
    if (initial) {
      perfMark("initial render end"); perfMeasure("first render", "initial render start", "initial render end");
    }
    return;
  }
  app.innerHTML = `
    <main class="shell advanced-shell report-theme" ${appDialog === null && !simpleDetailsOpen && !specialBuffsOpen ? "" : "inert"}>
      ${renderModeHeader(editorMode)}
      ${renderAdvancedScene(input)}
      ${stageNotice === null ? "" : `<div class="stage-notice" role="status">${escapeHtml(stageNotice)}</div>`}
      ${storageNotice === null ? "" : `<div class="stage-notice" role="status">${escapeHtml(storageNotice)}</div>`}
      ${errorMessage === null ? "" : `<div class="error-box" role="alert">${escapeHtml(errorMessage)}</div>`}
      ${renderAdvancedLineupActions(lineupActionsOpen, input.scenarioType === "INNER_EARTH")}
      ${input.scenarioType === "INNER_EARTH" ? renderInnerEarthForm(input, "player", (key, title, body) => lazyDetails.render(key, title, body, 'class="advanced-fold"')) : renderReportConfiguration()}
      ${lazyDetails.render("player-report-import", "战报 / 属性导入", renderReportImporter, 'class="advanced-fold advanced-more-settings"')}
      ${lazyDetails.render("player-profile-management", "阵容与预设管理", () => `${input.scenarioType === "INNER_EARTH" && getInnerEarthRule(getInnerEarthConfig(input).subMode).heroMode === "empty" ? "" : renderOwnedHeroes()}${renderPlayerProfiles()}`, 'class="advanced-fold advanced-more-settings"')}
      ${renderAdvancedRun(input, batchCount, batchRunning, batchProgress, playerRunBlocked())}
      ${optimizerPanelOpen ? renderPlayerOptimizer() : ""}
      ${renderAdvancedBatch(batchResult)}
      ${batchResult === null ? "" : lazyDetails.render("player-result-statistics", "详细统计 · 回合、兵损与技能表现", () => renderAdvancedStatistics(batchResult!), 'class="advanced-fold advanced-more-settings"')}
      ${renderPlayerSingle(result, threeQueueResult, resultIsStale)}
      ${developerToolsEnabled ? renderDeveloperTools(preview, resultIsStale) : ""}
      <footer class="simple-footer"><span>WHITEOUT BATTLE LAB · 高级阵容工具 · <a href="https://wos.h5joy-games.com/zh-CN/heroes/" target="_blank" rel="noreferrer">贴图来源</a></span><span>模拟结果供阵容比较参考，请结合实际战报判断。</span></footer>
    </main>${renderSpecialBuffDialog()}${renderAppDialog(appDialog)}${simpleDetailsOpen ? renderPlayerDetailsDrawer() : ""}
  `;
  if (initial) {
    perfMark("initial render end");
    perfMeasure("first render", "initial render start", "initial render end");
  }
}

function renderDeveloperTools(preview: ReturnType<typeof safePreview>, resultIsStale: boolean): string {
  if (!developerToolsEnabled) return "";
  const recognitionPending = pendingRecognitionSides().length > 0;
  const markup = lazyDetails.render("dev-tools", `<span class="dev-badge">DEV</span><div><h2>开发工具，仅用于模型验证</h2><p>配置覆盖、内部诊断和原始数据，与玩家设置分开显示。</p></div><span>展开开发工具 ↓</span>`, () => `<div class="developer-tools-body">
    ${lazyDetails.render("dev-simulation", "Simulation Internals · 模拟内部设置", () => renderControls(previewInitialTroopCount()).replaceAll('name="scenario-type"', 'name="dev-scenario-type"'), 'class="dev-group" data-dev-group="simulation"')}
    ${lazyDetails.render("dev-skills", "Skill Debug · 技能与配置校验", () => `
      ${isThreeQueueBattleInput(input) || input.scenarioType === "INNER_EARTH" ? "" : lazyDetails.render("advanced-debug",
        '<h2>高级调试</h2><span class="tag">展开后加载本场技能</span>', () => {
          const state = recognitionPending ? null : safePreview();
          return renderDebugPanel(state === null ? [] : getActiveSkillUniverse(state));
        }, 'class="panel debug-panel" data-expanded-section="advanced-debug"')}
      ${timeUiSection("report importer render", renderReportImporter)}
      ${isThreeQueueBattleInput(input) || input.scenarioType === "INNER_EARTH" ? "" : `<h3>英雄技能等级覆盖</h3><div class="config-grid">${(["A", "B"] as const).map((side) => `<section><h4>${side}方普通英雄远征技能</h4>${renderPlayerHeroSkills(side, getInputSide(side))}</section>`).join("")}</div>`}
      ${input.scenarioType === "INNER_EARTH" && getInnerEarthRule(getInnerEarthConfig(input).subMode).heroMode === "empty" ? "" : renderOwnedHeroes()}
      ${input.scenarioType === "INNER_EARTH" ? renderInnerEarthForm(input) : `<div class="config-grid">${isThreeQueueBattleInput(input) ? renderThreeQueueSide("A", input.sideA) : renderSide("A", input.sideA, preview, null)}${isThreeQueueBattleInput(input) ? renderThreeQueueSide("B", input.sideB) : renderSide("B", input.sideB, preview, null)}</div>`}
    `, 'class="dev-group" data-dev-group="skills"')}
    ${lazyDetails.render("dev-damage", "Damage Debug · 伤害与效果日志", () => `${isThreeQueueBattleInput(input) ? threeQueueResult === null ? '<p class="hint">先运行单场。</p>' : renderThreeQueueResults(threeQueueResult, resultIsStale) : result === null ? '<p class="hint">先运行单场以加载 DamageEvent Trace。</p>' : renderResults(result, resultIsStale)}`, 'class="dev-group" data-dev-group="damage"')}
    ${lazyDetails.render("dev-rng", "RNG Debug · 逐技能随机判定", () => `${result === null ? '<p class="hint">先运行单场。固定判定通过 Skill Debug 中的覆盖选项设置。</p>' : `<pre>${escapeHtml(debugJsonPreview(result.trace.rounds.slice(0, DEBUG_PREVIEW.rounds).map((round) => ({ round: round.round, troopSkills: round.troopSkills.filter((skill) => skill.probability !== null), heroSkills: round.heroSkills.filter((skill) => skill.probability !== null), procEffectFamilies: round.procEffectFamilies }))))}</pre>`}`, 'class="dev-group" data-dev-group="rng"')}
    ${lazyDetails.render("dev-theory", "Theory / Criterion · 优化参数与内部诊断", () => `
      <section class="panel optimizer-fixture-tools"><h3>导出完整优化 Benchmark Fixture</h3><p class="hint">保存双方完整配置、有效候选池、全部优化参数和精确共同种子。导入前校验输入与 Head/Body 空间；复跑使用保存的随机种子。</p>
      <div class="inline-fields"><button class="btn" data-action="download-optimizer-fixture" ${optimizationRunning ? "disabled" : ""}>下载 JSON</button><button class="btn" data-action="copy-optimizer-fixture" ${optimizationRunning ? "disabled" : ""}>复制 JSON</button><button class="btn" data-action="import-optimizer-fixture" ${optimizationRunning ? "disabled" : ""}>粘贴导入 Fixture</button><button class="btn" data-action="import-run-optimizer-fixture" ${optimizationRunning ? "disabled" : ""}>导入并一键复跑</button><label>选择 Fixture 文件<input data-scope="optimizer-fixture-file" type="file" accept="application/json,.json" ${optimizationRunning ? "disabled" : ""}></label></div></section>
      ${lazyDetails.render("head-pool-audit", "Head Pool Audit + H0（只检查候选池，不运行战斗）", () => {
      const audit = createHeadPoolAudit(input, optimizerRoute(input.scenarioType) === "rally" ? optimizationConfig.constraints : {}, heroPoolSide);
      return `${audit.warning ? `<p class="error-box">${audit.warning}</p>` : ""}<pre>${escapeHtml(debugJsonPreview({ headPoolAudit: audit }))}</pre>`;
    })}${optimizerPanelOpen ? renderOptimizer() : '<p class="hint">打开配队优化后，可在此查看和调整原有完整优化参数。</p>'}`, 'class="dev-group" data-dev-group="theory"')}
    ${lazyDetails.render("dev-raw", "Raw Data · 查看原始调试数据", () => `${renderRuleUnknowns()}${renderStoragePanel()}${lazyDetails.render("raw-config", "canonical config JSON", () => `<button class="btn" data-action="copy-input">复制战斗输入</button>${renderDebugPreview(input)}`, 'class="mini-details"')}${renderBatchStatistics(batchResult)}${result === null ? "" : renderDeveloperMode(result)}
      ${input.scenarioType === "INNER_EARTH" ? lazyDetails.render("inner-earth-audit", "地心玩法审计", () =>
        `<pre>${escapeHtml(debugJsonPreview(createInnerEarthAudit(input)))}</pre>`, 'class="panel"') : ""}
    `, 'class="dev-group" data-dev-group="raw"')}</div>`, 'class="developer-tools" data-dev-tools');
  return markup;
}

function playerRunBlocked(): boolean {
  return pendingRecognitionSides().length > 0 ||
    (input.battleContext === "rally" && input.attributeInputMode === "prediction" && !rallyDeploymentValid()) ||
    ((isThreeQueueBattleInput(input) || input.scenarioType === "INNER_EARTH") && !threeQueueValid());
}


function renderSpecialBuffContent(sideId: SideId, side: ValidationSideInput): string {
  return `${input.scenarioType === "CITY_DEFENSE" && sideId === "B" ? `<label class="checkbox-label"><input type="checkbox" data-scope="city-territory" ${input.defenderInTerritory ? "checked" : ""}>是否在领地内（部队攻击力、防御力各 +10%）</label><p class="hint">基础面板模式下计入本次 Buff；最终战报模式请填写已包含领地加成的属性。</p>` : ""}${advancedHelp("配置本次准备模拟的战斗中实际存在的外部增益。", "基础面板模式下，普通攻防穿血Buff会叠加到基础属性；最终战报模式已包含这些属性，不重复计算。快捷按钮只设置城镇和宠物战斗属性，专家和出征/集结/宠物容量保持原值。预设应用后仍可逐项修改。")}${attributeModeHelp(input.attributeInputMode === "prediction")}${renderExternalBuffs(sideId, side)}<h4>出征容量增益</h4><p class="hint">容量与普通攻防穿血分开保存；基础面板模式按现有部署规则计算，最终战报模式使用实际入场兵数。</p><div class="inline-fields"><label>出征容量增益 %<input data-scope="capacity" data-side="${sideId}" data-field="marchCapacityBonus" type="text" inputmode="decimal" value="${(side.marchCapacityBonus ?? 0) * 100}"></label><label>宠物出征容量等级<select data-scope="capacity" data-side="${sideId}" data-field="petMarchCapacityLevel">${Array.from({ length: 11 }, (_, level) => `<option value="${level}" ${level === (side.petMarchCapacityLevel ?? 0) ? "selected" : ""}>Lv${level} · +${level * 1500}</option>`).join("")}</select></label></div>`;
}

function renderSpecialBuffDialog(): string {
  if (!specialBuffsOpen) return "";
  const title = configurationPopup === "troops" ? "更改部队" : "特殊加成";
  return `<div class="special-buffs-overlay"><div class="special-buffs-backdrop" data-action="special-buffs-close"></div><section class="report-theme special-buffs-dialog" role="dialog" aria-modal="true" aria-labelledby="special-buffs-title"><header><div><h2 id="special-buffs-title">${title}</h2><p>${configurationPopup === "troops" ? "调整出征兵力、比例、兵种等级和 T12 技能。" : "配置城镇、宠物、专家及领地增益。"}修改后自动保存。</p></div><button class="btn" data-action="special-buffs-close" aria-label="关闭${title}">关闭 ×</button></header><div class="special-buffs-tabs" role="tablist" aria-label="选择配置方">${(["A", "B"] as const).map(side => `<button class="btn" role="tab" aria-selected="${side === specialBuffsSide}" aria-controls="special-buffs-panel" id="special-buffs-tab-${side}" data-action="special-buffs-side" data-side="${side}">${side} 方${configurationPopup === "troops" ? "部队" : "特殊加成"}</button>`).join("")}</div><div id="special-buffs-panel" role="tabpanel" aria-labelledby="special-buffs-tab-${specialBuffsSide}">${configurationPopup === "troops" ? renderAdvancedSide(specialBuffsSide, getInputSide(specialBuffsSide), "troops") + renderAdvancedSide(specialBuffsSide, getInputSide(specialBuffsSide), "t12") : renderSpecialBuffContent(specialBuffsSide, getInputSide(specialBuffsSide))}</div><footer><span>修改即时生效，关闭后可查看双方对比。</span><button class="btn primary" data-action="special-buffs-close">完成</button></footer></section></div>`;
}

function renderReportTroops(): string {
  const sides = (["A", "B"] as const).map(id => {
    const original = getInputSide(id);
    const side = input.scenarioType === "THREE_THREE_THREE" ? resolveThreeThreeThreeSide(original) : original;
    const counts = input.battleContext === "rally" && input.attributeInputMode === "prediction"
      ? (() => { try { return resolveValidationTroopCounts(side, "rally", "prediction"); } catch { return { shield: 0, lancer: 0, marksman: 0 }; } })()
      : Object.fromEntries(TROOP_TYPES.map(t => [t, getUiComposition(side.troops[t]).reduce((sum, row) => sum + row.aliveCount, 0)])) as Record<TroopType, number>;
    const total = TROOP_TYPES.reduce((sum, t) => sum + counts[t], 0);
    return { id, side, counts, total };
  });
  const icons = { shield: "🛡", lancer: "⚔", marksman: "🏹" };
  return `<div class="report-troops-summary"><div class="report-troops-totals">${sides.map(({ id, total, counts }) => `<div class="side-${id.toLowerCase()}"><div class="report-side-caption">${id} · ${id === "A" ? "我方部队" : "对方部队"}<button class="btn btn-small" data-action="troops-edit" data-side="${id}" aria-haspopup="dialog">更改部队</button></div><p>初始部队</p><strong>${formatNumber(total)}</strong><div class="report-troops-ratio" aria-label="${id}方兵种比例">${TROOP_TYPES.map(t => `<span class="ratio-${t}" style="width:${total ? counts[t] / total * 100 : 0}%"></span>`).join("")}</div><div class="report-troops-legend">${TROOP_TYPES.map(t => `<span class="ratio-${t}">${troopName(t)} ${total ? (counts[t] / total * 100).toFixed(2) : "0.00"}%</span>`).join("")}</div></div>`).join("")}</div><table class="report-stat-table report-troops-table"><caption>参战部队详情</caption><thead><tr><th>A 方数量</th><th>兵种 / 等级</th><th>B 方数量</th></tr></thead>${TROOP_TYPES.map(t => {
    const compositions = sides.map(({ side, counts }) => side.troops[t].levelMode === "mixed" ? getUiComposition(side.troops[t]) : [{ level: side.troops[t].troopLevel, aliveCount: counts[t] }]);
    const levels = [...new Set(compositions.flatMap(rows => rows.map(row => row.level)))].sort((a,b) => getTroopConstant(b) - getTroopConstant(a));
    return `<tbody><tr class="report-troop-divider"><th colspan="3">${icons[t]} ${troopName(t)}</th></tr>${levels.map(level => `<tr>${compositions.map((rows, index) => `${index === 1 ? `<th scope="row">${escapeHtml(level)}</th>` : ""}<td class="side-${index === 0 ? "a" : "b"}"><strong>${formatNumber(rows.filter(row => row.level === level).reduce((sum,row) => sum + row.aliveCount, 0))}</strong></td>`).join("")}</tr>`).join("")}<tr class="report-troops-skill"><td>${sides[0]!.side.troops[t].t12Level ?? 0} 级</td><th scope="row">T12 技能</th><td>${sides[1]!.side.troops[t].t12Level ?? 0} 级</td></tr></tbody>`;
  }).join("")}</table><p class="hint">此处展示开战前配置；伤亡与剩余兵力在模拟完成后查看。</p></div>`;
}

function renderReportConfiguration(): string {
  if (isThreeQueueBattleInput(input)) return `<section class="config-grid advanced-config" aria-label="双方战斗配置">${renderAdvancedSide("A", input.sideA)}${renderAdvancedSide("B", input.sideB)}</section>`;
  const role = (side: SideId) => input.scenarioType === "CITY_DEFENSE" ? side === "A" ? "进攻方阵容" : "守城方阵容" : input.scenarioType === "RALLY" ? side === "A" ? "集结进攻方" : "集结防守方" : side === "A" ? "我方阵容" : "对比阵容";
  const pair = (section: ReportConfigSection) => `<div class="report-pair">${(["A", "B"] as const).map(side => `<div class="advanced-side side-${side.toLowerCase()}"><div class="report-side-caption">${side} · ${role(side)}</div><div class="advanced-side-body">${renderAdvancedSide(side, getInputSide(side), section)}</div></div>`).join("")}</div>`;
  const block = (id: string, number: string, title: string, subtitle: string, content: string) => `<section id="${id}" class="report-config-section"><header class="report-section-heading"><span>${number}</span><div><h2>${title}</h2><p>${subtitle}</p></div></header>${content}</section>`;
  return `<section class="battle-report-config" aria-label="双方战斗配置"><header class="report-config-banner"><p>战报阵容录入</p><h2>逐项对照，还原这场战斗</h2><div class="report-opponents"><div class="report-opponent side-a"><b>A</b><span>${role("A")}</span><strong>${formatNumber(TROOP_TYPES.reduce((sum,t)=>sum+input.sideA.troops[t].count,0))}<small> 出征部队</small></strong></div><span class="report-versus">VS</span><div class="report-opponent side-b"><b>B</b><span>${role("B")}</span><strong>${formatNumber(TROOP_TYPES.reduce((sum,t)=>sum+input.sideB.troops[t].count,0))}<small> 出征部队</small></strong></div></div><nav aria-label="战报录入导航"><a href="#report-heroes">英雄对比</a><a href="#report-troops">部队对比</a><a href="#report-stats">属性加成</a><button class="report-buffs-link" data-action="special-buffs-open">特殊加成</button></nav></header>
    ${block("report-heroes", "01", "英雄对比", "按战报双方英雄栏录入；专武等级在下方展开设置。", pair("heroes") + pair("weapons") + (input.scenarioType === "RALLY" || input.scenarioType === "CITY_DEFENSE" ? pair("bodies") : ""))}
    ${block("report-troops", "02", "部队对比", "双方初始部队与兵种等级，按战报顺序对照。", renderReportTroops())}
    ${block("report-stats", "03", "属性加成", "按战报属性顺序逐行录入，左右两栏始终对应 A 方和 B 方。", renderReportAttributeComparison(input) + pair("attributes"))}
  </section>`;
}

type ReportConfigSection = "heroes" | "troops" | "attributes" | "buffs" | "t12" | "weapons" | "bodies";
function renderAdvancedSide(sideId: SideId, side: ValidationSideInput, section?: ReportConfigSection): string {
  if (isThreeQueueBattleInput(input)) return `<article class="advanced-side side-${sideId.toLowerCase()}"><header><h2>${sideId}方三队阵容</h2></header><div class="advanced-side-body">${lazyDetails.render(`player-queues-${sideId}`, '三队英雄、兵种与属性设置', () => renderIceFireSide(input, sideId, undefined, false, (key, title, body) => lazyDetails.render(key, title, body, 'class="advanced-fold"'), index => renderBonusContexts(sideId, getValidationThreeQueues(side)[index]!, index)), 'class="advanced-fold"')}</div></article>`;
  const is333 = input.scenarioType === "THREE_THREE_THREE", display = is333 ? resolveThreeThreeThreeSide(side) : side;
  const isRally = input.battleContext === "rally" && input.attributeInputMode === "prediction";
  const totalRatio = (scenarioStateKey(input) === "SINGLE" || input.scenarioType === "CITY_DEFENSE") && TROOP_TYPES.every((troop) => side.troops[troop].levelMode !== "mixed");
  const counts = Object.fromEntries(TROOP_TYPES.map((troop) => [troop, side.troops[troop].count])) as Record<TroopType, number>;
  const parts = {
    heroes: () => `<h3>英雄阵容</h3>${advancedHelp("选择本场实际参战的英雄。", "英雄runtime技能参与当前战斗。最终战报模式已包含英雄静态属性，不再叠加；基础面板模式按已建模的英雄与专武来源构造当前属性。")}
    <div class="simple-heroes">${TROOP_TYPES.map((troop) => renderSimpleHero(sideId, side, troop, input, developerToolsEnabled)).join("")}</div>`,
    troops: () => `<div class="advanced-section-title"><h3>兵量与兵种等级</h3><span>总兵力 ${formatNumber(TROOP_TYPES.reduce((sum, troop) => sum + display.troops[troop].count, 0))}</span></div>
    ${totalRatio ? `<div data-deployment-side="${sideId}">${renderTotalRatioDeployment(counts, "advanced-deployment", advancedRatioDrafts[sideId])}</div>` + `<details class="mini-details"><summary>高级：精确人数输入</summary><div class="inline-fields">${TROOP_TYPES.map((troop) => `<label>${troopName(troop)}精确人数<input type="number" min="0" step="1" data-scope="troop" data-side="${sideId}" data-troop="${troop}" data-field="count" value="${counts[troop]}"></label>`).join("")}</div></details>` : ""}
    ${is333 ? render333Deployment(sideId, side) : ""}${isRally ? renderRallyDeployment(sideId, side) : ""}
    <div class="troop-cards advanced-troop-cards">${TROOP_TYPES.map((troop) => renderTroopRow(sideId, troop, display.troops[troop], display, false)).join("")}</div>`,
    attributes: () => `${lazyDetails.render(`player-attributes-${sideId}`, '<span>战报属性</span><small>12 项百分数</small>', () => renderAdvancedAttributes(sideId, side, false), 'class="advanced-fold"')}`,
    buffs: () => lazyDetails.render(`player-buffs-${sideId}`, '<span>城镇、宠物与专家 Buff</span><small>本次战斗的外部增益</small>', () => renderSpecialBuffContent(sideId, side), 'class="advanced-fold"'),
    t12: () => `${lazyDetails.render(`player-t12-${sideId}`, '<span>T12兵种技能</span><small>盾兵 / 矛兵 / 射手</small>', () => `${advancedHelp("设置当前盾、矛、射的T12兵种技能等级。该技能不属于战报12项攻防穿血。", "技能按现有兵种机制参与战斗；Lv0表示关闭。不同场景独立保存等级，切换不会覆盖集结的高等级设置。")}<p class="hint" data-t12-limit>当前为${maxT12SkillLevel(input, sideId) === 24 ? input.scenarioType === "CITY_DEFENSE" ? "守城" : "集结" : "非集结"}模式，最高Lv${maxT12SkillLevel(input, sideId)}。</p><div class="inline-fields">${TROOP_TYPES.map((troop) => `<label>${troopName(troop)}<select data-scope="t12" data-side="${sideId}" data-troop="${troop}">${Array.from({ length: maxT12SkillLevel(input, sideId) + 1 }, (_, level) => `<option value="${level}" ${level === (side.troops[troop].t12Level ?? 0) ? "selected" : ""}>Lv${level}</option>`).join("")}</select></label>`).join("")}</div>`, 'class="advanced-fold"')}`,
    weapons: () => `${lazyDetails.render(`player-weapons-${sideId}`, '<span>英雄专武</span><small>各英雄独立等级</small>', () => `${advancedHelp("设置实际参战英雄的专武等级。最终战报模式仍需设置，以运行专武战斗技能。", WEAPON_HELP)}${TROOP_TYPES.map((troop) => { const id = side.leaderHeroIds?.[troop]; return id ? renderWeaponLevelInput("simulation-weapon", sideId, id, `${catalog.leaderHeroes.find((hero) => hero.heroId === id)?.name ?? "英雄"}专武`, side.simulationWeaponLevels?.[id] ?? 0) : ""; }).join("") || '<p class="hint">先选择英雄。</p>'}`, 'class="advanced-fold"')}`,
    bodies: () => `${input.scenarioType === "CITY_DEFENSE" ? sideId === "B" ? lazyDetails.render("player-city-body-B", "守城车身英雄 · 四个槽位", () => `<div class="member-grid">${Array.from({ length: 4 }, (_, index) => renderMemberSelect(sideId, side, index)).join("")}</div>`, 'class="advanced-fold"') : '<p class="hint">进攻方沿用单撞规则，不配置车身。</p>' : ""}
    ${input.battleContext === "rally" ? lazyDetails.render(`player-rally-${sideId}`, '<span>集结详细设置</span><small>车身英雄 / 容量增益</small>', () => `${advancedHelp("仅用于集结场景的车身英雄、容量和集结相关配置。", "车身技能参与集结战斗；容量按现有部署规则使用，与普通战报属性分开。切换其他模式会保存本场景状态，再次返回集结时恢复。")}<h4>车身英雄</h4><div class="member-grid">${Array.from({ length: 4 }, (_, index) => renderMemberSelect(sideId, side, index)).join("")}</div><h4>容量增益</h4><div class="inline-fields"><label>集结容量增益 %<input data-scope="capacity" data-side="${sideId}" data-field="rallyCapacityBonus" type="text" inputmode="decimal" value="${(side.rallyCapacityBonus ?? 0) * 100}"></label><label>额外固定容量<input data-scope="capacity" data-side="${sideId}" data-field="rallyFixedCapacityBonus" type="number" min="0" value="${side.rallyFixedCapacityBonus ?? 0}"></label></div>`, 'class="advanced-fold"') : ""}`,
  };
  if (section !== undefined) return parts[section]();
  return `<article class="advanced-side side-${sideId.toLowerCase()}"><header><h2>${sideId}方阵容</h2></header><div class="advanced-side-body">${Object.values(parts).map(render => render()).join("")}</div></article>`;
}
function renderAdvancedAttributes(sideId: SideId, side: ValidationSideInput, showInputs = true): string {
  return `${advancedHelp("设置本次战斗使用的盾、矛、射攻防穿血。可直接输入最终战报属性，也可以输入基础属性后由下方Buff自动计算。", "最终战报包含普通外部属性增益，不能再次叠加。基础面板模式则使用正规城镇、宠物、专家及专武来源。历史反推是独立工具，只有点击还原按钮才会将结果写入基础属性。")}
    <label>这些属性来自哪里？<select data-scope="player-attribute-source"><option value="report" ${input.attributeInputMode !== "prediction" ? "selected" : ""}>最终战报 · 已含增益</option><option value="base" ${input.attributeInputMode === "prediction" ? "selected" : ""}>基础面板 · 另行配置增益</option></select></label>
    ${attributeModeHelp(input.attributeInputMode === "prediction")}${showInputs ? renderAttributeInputs(sideId, side) : ""}<button class="btn btn-small" data-action="simple-copy-attributes" data-side="${sideId}">复制到另一方</button>
    ${input.attributeInputMode === "prediction" ? `<h4>预计最终战报属性</h4>${renderExpectedPanel(sideId)}<details class="mini-details"><summary>属性中已经包含的参考英雄与专武</summary><p class="hint">基础值已包含参考阵容时在此注明；更换模拟英雄时只计算阵容差值。完全未包含英雄和专武的基础值请留空。</p><div class="hero-slot-grid">${TROOP_TYPES.map((troop) => renderHeroSelect("report-hero", sideId, side, troop)).join("")}</div></details>` : ""}
    ${renderBonusContexts(sideId, side)}`;
}
function renderExpectedPanel(sideId: SideId): string {
  const expected = safeExpectedPreview()?.[sideId];
  if (!expected) return '<p class="hint">请先补齐有效配置以查看预计最终属性。</p>';
  return `<div class="table-scroll"><table class="data-table" data-expected-panel><thead><tr><th>兵种</th>${reportAttributes.map((stat) => `<th>${attributeName(stat)} %</th>`).join("")}</tr></thead><tbody>${TROOP_TYPES.map((troop) => `<tr><th>${troopName(troop)}</th>${reportAttributes.map((stat) => `<td>${(expected.breakdown[troop][stat].finalBonus * 100).toFixed(2)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderPlayerHeroSkills(sideId: SideId, side: ValidationSideInput): string {
  const leaders = Object.values(side.leaderHeroIds ?? {}).filter(Boolean);
  const skills = catalog.skills.filter((skill) => skill.source === "hero" && skill.category === "expedition" && leaders.includes(skill.heroId));
  return `<div class="external-grid">${skills.map((skill) => `<label><span class="skill-art-name">${renderSkillArt(skill.id)}${escapeHtml(catalog.leaderHeroes.find((hero) => hero.heroId === skill.heroId)?.name ?? "英雄")} · ${escapeHtml(skill.name)}</span><select data-scope="leader-skill-level" data-side="${sideId}" data-skill-id="${escapeAttr(skill.id)}">${Object.keys(CONFIRMED_HERO_SKILL_DEFINITIONS.find((definition) => definition.id === skill.id)?.levelValues ?? {}).map(Number).sort((a, b) => a - b).map((level) => `<option value="${level}" ${(side.leaderSkillLevels?.[skill.id] ?? 5) === level ? "selected" : ""}>Lv${level}</option>`).join("")}</select></label>`).join("") || '<p class="hint">先选择英雄，再设置技能等级。</p>'}</div>`;
}

function renderPlayerProfiles(): string {
  return renderStoragePanel().replace(/<button[^>]*data-action="save-profile"[^>]*>[\s\S]*?<\/button>/g, "")
    .replace("导出配置", "导出阵容").replace("导入配置", "导入阵容")
    .replace("恢复默认配置", "恢复默认阵容").replace("选择配置 JSON 文件", "选择阵容文件");
}

function renderPlayerDetailsDrawer(): string {
  const markup = playerSingleDetailsOpen && result !== null ? renderPlayerSingleDrawer(result) : renderAdvancedBatchDrawer(batchResult);
  return developerToolsEnabled ? markup.replace('</section>', '<footer><button class="btn" data-action="developer-focus-raw">查看原始调试数据</button></footer></section>') : markup;
}

function renderPlayerOptimizer(): string {
  const route = optimizerRoute(input.scenarioType);
  const field = (scope: string, key: string, value: number, label: string) => `<label>${label}<input data-scope="${scope}" data-field="${key}" type="number" min="1" value="${value}"></label>`;
  const chooseSide = (scope: string, key: string, value: SideId) => `<label>优化哪一方<select data-scope="${scope}" data-field="${key}"><option value="A" ${value === "A" ? "selected" : ""}>${scope === "optimizer" ? "集结进攻方" : "A方"}</option><option value="B" ${value === "B" ? "selected" : ""}>${scope === "optimizer" ? "集结防守方" : "B方"}</option></select></label>`;
  let fields = "";
  if (input.scenarioType === "CITY_DEFENSE") fields = `<label>优化哪一方<select data-scope="optimizer" data-field="candidateSide"><option value="A" ${(optimizationConfig.candidateSide ?? "A") === "A" ? "selected" : ""}>单撞进攻方</option><option value="B" ${optimizationConfig.candidateSide === "B" ? "selected" : ""}>守城防守方</option></select></label><label>目标<output>最高本方单场胜率</output></label>${field("optimizer", "verificationTrials", optimizationConfig.verificationTrials, "最终复验场次")}${optimizationConfig.candidateSide === "B" ? `<label>固定当前四个车身<input data-scope="optimizer" data-field="fixedMemberSkillIds" type="checkbox" ${optimizationConfig.constraints.fixedBodyExact ? "checked" : ""}></label>` : ""}${input.attributeInputMode === "prediction" ? `<label>固定当前英雄<input data-scope="optimizer" data-field="fixedLeaders" type="checkbox" ${optimizationConfig.constraints.fixedLeaders ? "checked" : ""}></label>` : ""}`;
  else if (route === "rally") fields = `${chooseSide("optimizer", "candidateSide", optimizationConfig.candidateSide ?? "A")}${(optimizationConfig.candidateSide ?? "A") === "A" ? `<label>目标<select data-scope="optimizer" data-field="objectiveMode">${([['auto', '自动选择'], ['singleWin', '最高单波胜率'], ['minRallies', '最少集结击破']] as const).map(([value, name]) => `<option value="${value}" ${optimizationConfig.objectiveMode === value ? "selected" : ""}>${name}</option>`).join("")}</select></label>` : ""}${field("optimizer", "verificationTrials", optimizationConfig.verificationTrials, "最终复验场次")}<label>固定当前车身<input data-scope="optimizer" data-field="fixedMemberSkillIds" type="checkbox" ${optimizationConfig.constraints.fixedBodyExact ? "checked" : ""}></label>${input.attributeInputMode === "prediction" ? `<label>固定当前车头<input data-scope="optimizer" data-field="fixedLeaders" type="checkbox" ${optimizationConfig.constraints.fixedLeaders ? "checked" : ""}></label>` : ""}`;
  else if (route === "threeQueue" || route === "innerEarth" && ["HEART_OF_EARTH", "HERO_LAND"].includes(getInnerEarthConfig(input).subMode)) fields = `${route === "innerEarth" ? '<label>优化对象<output>A方</output></label>' : chooseSide("three-queue-optimizer", "side", threeQueueOptimizerOptions.side)}${field("three-queue-optimizer", "finalValidationCount", threeQueueOptimizerOptions.finalValidationCount, "最终复验场次")}${field("three-queue-optimizer", "finalCandidateCount", threeQueueOptimizerOptions.finalCandidateCount, "最终候选数")}<label>对手变阵<select data-scope="three-queue-optimizer" data-field="enemyPermutationMode">${([['fixedCurrent', '当前顺序'], ['allPermutations', '全部六种排列'], ['worstCase', '最不利顺序']] as const).map(([value, name]) => `<option value="${value}" ${threeQueueOptimizerOptions.enemyPermutationMode === value ? "selected" : ""}>${name}</option>`).join("")}</select></label><label>固定我方队伍顺序<input data-scope="three-queue-optimizer" data-field="fixedOwnQueueOrder" type="checkbox" ${threeQueueOptimizerOptions.fixedOwnQueueOrder ? "checked" : ""}></label><div class="advanced-queue-locks">${[0, 1, 2].map((index) => `<label>固定第${index + 1}队英雄<input data-scope="three-queue-optimizer" data-field="lockHeroes" data-queue-index="${index}" type="checkbox" ${threeQueueOptimizerOptions.lockHeroes[index] ? "checked" : ""}></label><label>固定第${index + 1}队比例<input data-scope="three-queue-optimizer" data-field="lockRatios" data-queue-index="${index}" type="checkbox" ${threeQueueOptimizerOptions.lockRatios[index] ? "checked" : ""}></label>`).join("")}</div>`;
  else fields = `${route === "innerEarth" ? '<label>优化对象<output>A方兵种比例</output></label>' : chooseSide("simple-optimizer", "side", simpleOptimizerOptions.side)}${field("simple-optimizer", "verificationTrials", simpleOptimizerOptions.verificationTrials, "最终复验场次")}${field("simple-optimizer", "topN", simpleOptimizerOptions.topN, "最终候选数")}${input.attributeInputMode === "prediction" && route !== "innerEarth" ? `<label>固定当前英雄<input data-scope="simple-optimizer" data-field="fixedHeroes" type="checkbox" ${simpleOptimizerOptions.fixedHeroes ? "checked" : ""}></label>` : ""}<label>固定当前配兵<input data-scope="simple-optimizer" data-field="fixedRatio" type="checkbox" ${simpleOptimizerOptions.fixedRatio ? "checked" : ""}></label>`;
  const noHeroes = input.scenarioType === "INNER_EARTH" && getInnerEarthRule(getInnerEarthConfig(input).subMode).heroMode === "empty";
  return `<section class="panel optimizer-panel player-optimizer"><header class="panel-head"><h2>配队优化</h2><span class="tag tag-cyan">比较合法阵容的战斗表现</span></header><div class="panel-body"><p class="hint">固定对手和已有战报属性，用模拟比较候选阵容。${input.attributeInputMode !== "prediction" ? "当前车头及实际专武固定；保持最终战报的属性含义。" : "可选择参与比较的英雄，或固定当前英雄只优化配兵。"}</p>${noHeroes ? "" : renderHeroPool()}<div class="optimizer-fields">${fields}</div><button class="btn btn-primary" data-action="run-optimizer" ${optimizationRunning || playerRunBlocked() ? "disabled" : ""}>${optimizationRunning ? "搜索中…" : "开始自动配队"}</button>${optimizationRunning ? '<button class="btn" data-action="cancel-optimizer">取消搜索</button>' : ""}<span class="optimizer-progress hint">${escapeHtml(playerOptimizationProgress(optimizationProgress, optimizationPerformanceReport))}</span></div>${renderPlayerOptimizationResults()}</section>`;
}

function renderPlayerOptimizationResults(): string {
  const heroNames = (leaders: Readonly<Partial<Record<TroopType, string | null>>>, weapons?: Readonly<Record<string, number>>) => TROOP_TYPES.map((troop) => {
    const id = leaders[troop], name = catalog.leaderHeroes.find((hero) => hero.heroId === id)?.name ?? "未配置";
    return name + (id && weapons?.[id] ? ` · 专武 Lv${weapons[id]}` : "");
  }).join(" / ");
  const card = (index: number, winRate: number, trials: number, details: string, action: string) => `<article class="player-optimization-card"><h3>推荐阵容 ${index + 1}<strong>${formatPercent(winRate)}</strong></h3><p>${details}</p><small>${trials} 场复验</small><button class="btn btn-small" data-action="${action}" data-index="${index}">应用此阵容</button></article>`;
  if (input.scenarioType === "INNER_EARTH" && innerEarthOptimizationResult !== null && innerEarthResultRevision === revisionState.inputRevision) {
    const rows = innerEarthOptimizationResult.result.topCandidates;
    return `<h3>地心优化结果</h3>${rows.map((row, index) => { const candidate = row.candidate; const ratios = "ratios" in candidate ? candidate.ratios : undefined; return card(index, row.winRate, row.trials, "queues" in candidate ? candidate.queues.map((queue) => heroNames(queue.leaderHeroIds, queue.headWeaponLevels)).join("；") : `${heroNames(candidate.leaderHeroIds, candidate.headWeaponLevels)} · 配比 ${ratios ? TROOP_TYPES.map((troop) => ratios[troop]).join(" / ") : "1:1:1"}`, "apply-inner-earth-optimizer"); }).join("")}`;
  }
  if (isThreeQueueBattleInput(input) && threeQueueOptimizationResult !== null && threeQueueResultRevision === revisionState.inputRevision) return threeQueueOptimizationResult.topCandidates.map((row, index) => card(index, row.winRate, row.trials, row.candidate.queues.map((queue, qi) => `第${qi + 1}队 ${heroNames(queue.leaderHeroIds, queue.headWeaponLevels)} · ${TROOP_TYPES.map((troop) => queue.ratiosBp[troop] / 100).join(" / ")}`).join("；"), "apply-three-queue-optimizer")).join("");
  if (optimizerRoute(input.scenarioType) === "rally" && optimizationResult !== null) return `<h3>${optimizationTargetLabel(input.scenarioType, optimizationConfig.candidateSide ?? "A")}优化结果</h3>${optimizationResult.singleWaveTop.map((row, index) => card(index, row.winRate, row.trials, rallyRecommendationDetails(row.candidate, TROOP_TYPES.map((t) => input[(optimizationConfig.candidateSide ?? "A") === "A" ? "sideA" : "sideB"].troops[t].troopLevel), developerToolsEnabled), "apply-rally-optimizer")).join("")}${optimizationResult.multiWaveTop.map((plan, index) => `<article class="player-optimization-card"><h3>多波方案 ${index + 1}</h3><p>${plan.targetWaves === null ? "当前验证未达到目标击破概率" : `${plan.targetWaves} 波达到目标击破概率`}</p>${plan.waves.map((wave) => `<p>第${wave.wave}波累计击破 ${formatPercent(wave.defeatProbability)}</p>`).join("")}<button class="btn" data-action="apply-rally-wave" data-index="${index}">应用第1波阵容</button></article>`).join("")}`;
  if (simpleOptimizationResult !== null && simpleResultRevision === revisionState.inputRevision) return simpleOptimizationResult.topCandidates.map((row, index) => card(index, row.winRate, row.trials, `${heroNames(row.candidate.leaderHeroIds, row.candidate.headWeaponLevels)} · 配比 ${row.candidate.ratios ? TROOP_TYPES.map((troop) => row.candidate.ratios![troop]).join(" / ") : "1:1:1"}`, "apply-simple-optimizer")).join("");
  return "";
}

function renderRuleUnknowns(): string {
  return `<details class="unknown-banner">
    <summary>当前引擎待确认规则 · ${CURRENT_ENGINE_RULE_UNKNOWNS.length} 项</summary>
    <ul>${CURRENT_ENGINE_RULE_UNKNOWNS.map((rule) => `<li>${escapeHtml(ruleUnknownDescription(rule))}${developerMode ? ` <code>${rule}</code>` : ""}</li>`).join("")}</ul>
    <p><strong>单项待定机制：</strong>S12～S16 英雄规则仍待对应代数 PVP 战报验证。艾丽芙“绫绮之幕”复用加托护盾模板。</p>
  </details>`;
}

function renderStoragePanel(): string {
  const status = storageStatus === "saving" ? "保存中…"
    : storageStatus === "saved" ? "● 已自动保存"
      : storageStatus === "error" ? "本地保存失败" : "尚未保存";
  return `<section class="storage-panel" aria-label="配置持久化">
    <div class="storage-toolbar"><span class="storage-status" data-storage-status>${status}</span>
      <button class="btn btn-small" type="button" data-action="save-profile">保存为方案</button>
      <button class="btn btn-small" type="button" data-action="export-config">导出配置</button>
      <button class="btn btn-small" type="button" data-action="import-config">导入配置</button>
      <button class="btn btn-small" type="button" data-action="restore-default">恢复默认配置</button>
      <input class="storage-file-input" data-scope="import-file" type="file" accept=".json,application/json" aria-label="选择配置 JSON 文件">
    </div>
    ${lazyDetails.render("profile-library", `方案库 · ${profilesLoaded ? savedProfiles.length : storedProfileCount} 个方案`, () =>
      savedProfiles.length === 0 ? `<p class="hint">暂无命名方案。</p>` : `
      <div class="profile-list">${savedProfiles.map((profile) => {
        const stageId = profile.data.input.serverStage;
        const stage = SERVER_STAGES.find((entry) => entry.id === stageId);
        return `<div class="profile-row"><div><strong>${escapeHtml(profile.name)}</strong>
          <small>${escapeHtml(stage?.label ?? String(stageId))} · ${escapeHtml(String(profile.data.input.scenarioType))} · ${new Date(profile.updatedAt).toLocaleString("zh-CN")}</small></div>
          <div class="profile-actions">
            <button class="btn btn-small" data-action="load-profile" data-profile-id="${escapeAttr(profile.id)}">加载</button>
            <button class="btn btn-small" data-action="rename-profile" data-profile-id="${escapeAttr(profile.id)}">重命名</button>
            <button class="btn btn-small" data-action="copy-profile" data-profile-id="${escapeAttr(profile.id)}">复制</button>
            <button class="btn btn-small" data-action="export-profile" data-profile-id="${escapeAttr(profile.id)}">导出</button>
            <button class="btn btn-small" data-action="delete-profile" data-profile-id="${escapeAttr(profile.id)}">删除</button>
          </div></div>`;
      }).join("")}</div>`, 'class="profile-library" data-profile-library')}
  </section>`;
}

function renderReportImporter(): string {
  if (!import.meta.env.DEV) return `<section class="panel report-import"><header class="panel-head"><h2>战报图片识别</h2></header><div class="panel-body"><p>战报图片识别功能暂未在公开 Beta 开放。</p></div></section>`;
  return `<section class="panel report-import"><header class="panel-head"><h2>本地战报识图</h2>
    <span class="tag tag-cyan">属性与特殊加成校对</span></header><div class="panel-body">
    <p class="hint">整图本地中文 OCR，识别攻击、防御、穿透、生命及特殊加成；不识别兵种等级、火晶或兵种图标。兵量与等级由手填或玩法规则确定。按当前玩法归并为 1 / 2 / 4 / 6 / 9 / 12 项；装备锻炉我方9项中攻击、防御独立，穿透/生命按兵种配对。冲突及低置信度值须逐项确认。应用前仅保存在预览中。确认属性与特殊加成后按历史战报公式反推，并一次性应用；正式配置在确认前保持隔离。${reportImportBusy ? "识别中…" : ""}</p>
    <div class="report-sides">${(["A", "B"] as const).map(renderPredictionImportSide).join("")}</div></div></section>`;
}

function renderHeroPool(): string {
  if (input.attributeInputMode !== "prediction" && !isIceFireInput(input)) return "";
  if (input.scenarioType === "INNER_EARTH") heroPoolSide = "A";
  const owned = new Set(ownedOptimizationHeroIds(input));
  const heroes = catalog.leaderHeroes.filter((hero) => owned.has(hero.heroId))
    .sort((a, b) => (a.generation ?? 0) - (b.generation ?? 0));
  const selected = new Set(optimizationHeroIds(input, heroPoolSide));
  const excludedCurrent = configuredHeadHeroIds(input).filter((id) => !selected.has(id));
  const unownedCurrent = excludedCurrent.filter((id) => !ownedHeroIds(input).includes(id));
  const currentNotice = excludedCurrent.length ? `<p class="hint">当前手动阵容中未参与自动 Head 搜索的英雄：${excludedCurrent.map((id) => `${escapeHtml(catalog.leaderHeroes.find((h) => h.heroId === id)?.name ?? id)}（${unownedCurrent.includes(id) ? "未标记拥有" : owned.has(id) ? "未勾选参与" : "R/SR 不参与 Head"}）`).join("、")}。手动阵容独立保留。</p>${unownedCurrent.length ? '<button class="btn btn-small" data-action="hero-pool-own-current">确认当前阵容英雄已拥有</button>' : ""}` : "";
  const serverGeneration = optimizerServerGeneration(input);
  const stageWarning = developerToolsEnabled && !heroes.some((hero) => hero.generation === serverGeneration && selected.has(hero.heroId))
    ? `<p class="error-box">S${serverGeneration} server stage but no S${serverGeneration} SSR is eligible for Head optimization</p>` : "";
  const weaponLevels = heroes.filter((hero) => selected.has(hero.heroId)).map((hero) => optimizerWeaponLevel(input, hero.heroId, heroPoolSide));
  const weaponSummary = `专武：Lv10 × ${weaponLevels.filter((level) => level === 10).length} · 自定义等级 × ${weaponLevels.filter((level) => level !== null && level !== 10).length} · 无专武 × ${weaponLevels.filter((level) => level === null).length}`;
  return lazyDetails.render("hero-pool", `<h2>本次优化英雄池</h2><span>参与优化：${selected.size} / 可用 ${owned.size}（已拥有且当前合法） · ${weaponSummary}</span>`, () =>
    `<div class="panel-body"><p class="hint">此处只设置本次参与优化与优化专武等级；长期拥有情况在“我的英雄”中维护。R/SR 不进入车头自动优化池，手动配置与车身池继续保留。近三代只用于生成新车头。全选 / 全不选保留拥有情况与专武等级。</p>
    ${currentNotice}${stageWarning}<p class="hint">拥有范围：${heroOwnershipScope(input) === "allAvailable" ? "理论全部可用（随服务器阶段开放新英雄）" : "我的英雄（升代时自动加入新开放车头，保留已有参与设置）"}</p><div class="inline-fields"><button class="btn btn-small" data-action="hero-pool-all">全选</button><button class="btn btn-small" data-action="hero-pool-none">全不选</button>
      ${input.scenarioType === "INNER_EARTH" ? '<label>英雄池侧<output>我方 A</output></label>' : `<label>编辑英雄池侧<select data-scope="hero-pool-side"><option value="A" ${heroPoolSide === "A" ? "selected" : ""}>A 方</option><option value="B" ${heroPoolSide === "B" ? "selected" : ""}>B 方</option></select></label>`}</div>
    <div class="hero-pool-grid">${heroes.map((hero) => `<div class="hero-pool-row"><label><input data-scope="hero-pool" data-hero-id="${escapeAttr(hero.heroId)}" type="checkbox" ${selected.has(hero.heroId) ? "checked" : ""}>参与优化</label><span class="hero-art-name">${renderHeroPortrait(hero.heroId)}${escapeHtml(hero.name)} ${heroCategoryLabel(hero)}</span>
      ${hero.weaponMaxStat === null ? "<span>无专武等级</span>" : `<label>专武<select data-scope="owned-weapon" data-hero-id="${escapeAttr(hero.heroId)}" data-side="${heroPoolSide}">${Array.from({ length: 11 }, (_, level) => `<option value="${level}" ${level === optimizerWeaponLevel(input, hero.heroId, heroPoolSide) ? "selected" : ""}>Lv${level}</option>`).join("")}</select></label>`}</div>`).join("")}</div></div>`, 'class="hero-pool"');
}

function renderOwnedHeroes(): string {
  const heroes = catalog.leaderHeroes.filter((hero) => isHeroAvailableAtStage(hero, validationStageId(input)))
    .sort((a, b) => (a.generation ?? 0) - (b.generation ?? 0));
  const owned = new Set(ownedHeroIds(input));
  return lazyDetails.render("owned-heroes", `<h2>我的英雄</h2><span>已拥有：${owned.size} / 当前阶段 ${heroes.length}</span>`, () =>
    `<div class="panel-body"><label>拥有范围<select data-scope="hero-ownership-scope"><option value="allAvailable" ${heroOwnershipScope(input) === "allAvailable" ? "selected" : ""}>理论全部可用</option><option value="owned" ${heroOwnershipScope(input) === "owned" ? "selected" : ""}>我的英雄</option></select></label><p class="hint">升代时自动加入本次新开放的合法车头，已有英雄的拥有、参与与专武设置保持不变。取消拥有会关闭双方对此英雄的优化参与状态，保留专武等级。手动选择新英雄会将其加入我的英雄，已有的参与开关保持不变。此处包含可用于手动配置及车身的 R / SR 英雄。</p><div class="hero-pool-grid">${heroes.map((hero) =>
      `<label class="owned-hero-row"><input data-scope="owned-hero" data-hero-id="${escapeAttr(hero.heroId)}" type="checkbox" ${owned.has(hero.heroId) ? "checked" : ""}><span class="hero-art-name">${renderHeroPortrait(hero.heroId)}拥有 ${escapeHtml(hero.name)} ${heroCategoryLabel(hero)}</span></label>`).join("")}</div></div>`, 'class="owned-heroes"');
}

function updateHeroPool(target: HTMLInputElement): void {
  const heroId = target.dataset.heroId;
  if (heroId === undefined || !catalog.leaderHeroes.some((hero) => hero.heroId === heroId && optimizerHeadHeroAllowed(hero, optimizerServerGeneration(input)))) {
    throw new Error("英雄池条目无效。");
  }
  input = setOptimizationPoolEnabled(input, heroPoolSide, target.checked, heroId);
}

function updateOwnedWeapon(target: HTMLSelectElement): void {
  const side = requireSide(target.dataset.side);
  const heroId = target.dataset.heroId;
  const level = Number(target.value);
  if (heroId === undefined || !catalog.leaderHeroes.some((hero) => hero.heroId === heroId &&
    hero.weaponMaxStat !== null && optimizerHeadHeroAllowed(hero, optimizerServerGeneration(input))) ||
    !Number.isInteger(level) || level < 0 || level > 10) throw new Error("专武等级无效。");
  input = { ...input, optimizerHeroPool: { ...input.optimizerHeroPool, [side]: {
    ...input.optimizerHeroPool?.[side], [heroId]: { enabled: optimizationHeroIds(input, side).includes(heroId), weaponLevel: level } } } };
}

function renderPredictionImportSide(side: SideId): string {
  const context = recognitionState[side], report = context.reportContext, source = context.selectedSourceSide;
  const schema = attributeImportSchema(input, side), groups = attributePreviewGroups(report?.[source], schema);
  const innerThree = input.scenarioType === "INNER_EARTH" && ["HEART_OF_EARTH", "HERO_LAND"].includes(getInnerEarthConfig(input).subMode);
  const labels: Record<string, string> = { allStats: "全属性", attackDefense: "攻击 / 防御", penetrationLife: "穿透 / 生命", sharedAttackDefense: "全兵种攻击 / 防御", sharedPenetrationLife: "全兵种穿透 / 生命",
    ...Object.fromEntries(TROOP_TYPES.flatMap((troop) => [
      [`${troop}Attack`, `${troopName(troop)}攻击`], [`${troop}Defense`, `${troopName(troop)}防御`],
      [`${troop}AttackDefense`, `${troopName(troop)}攻击 / 防御`], [`${troop}PenetrationLife`, `${troopName(troop)}穿透 / 生命`],
    ])) };
  return `<div class="report-import-side"><h3>${side} 方属性识图</h3>
    <label>上传属性图片<input data-scope="report-image" data-import-kind="prediction-attributes" data-side="${side}" type="file" accept="image/*" multiple></label>
    <label>补充特殊加成图片<input data-scope="report-image" data-import-kind="special" data-side="${side}" type="file" accept="image/*" multiple></label>
    <label>读取侧<select data-scope="report-source" data-side="${side}"><option value="left" ${source === "left" ? "selected" : ""}>左侧</option><option value="right" ${source === "right" ? "selected" : ""}>右侧</option></select></label>
    ${isThreeQueueBattleInput(input) || innerThree && side === "A" ? `<label>应用到队列<select data-scope="report-queue-target" data-side="${side}">${([0, 1, 2] as const).map((index) => `<option value="${index}" ${reportQueueTargets[side] === index ? "selected" : ""}>第 ${index + 1} 队</option>`).join("")}</select></label>` : ""}
    ${innerThree && side === "B" ? '<p class="hint">敌方属性一次应用到 B1 / B2 / B3。</p>' : ""}
    <p>已识别属性：${groups.filter((group) => group.item !== undefined).length}/${groups.length}${reportApplied[side] ? " · 已应用" : ""}</p>
    ${report === null ? "" : `<div class="table-scroll"><table class="data-table"><thead><tr><th>属性 %</th><th>识别值 / 手动校对</th><th>原始属性预览</th><th>状态</th></tr></thead><tbody>${groups.map((group) => {
      const parts = group.key.split("."), label = labels[group.key] ?? (parts.length === 2 ? `${troopName(parts[0] as TroopType)}${attributeName(parts[1] as typeof reportAttributes[number])}` : attributeName(group.key as typeof reportAttributes[number]));
      return `<tr class="${group.needsConfirmation ? "ocr-low-confidence" : ""}"><td>${label}</td><td><input data-scope="attribute-report-field" data-side="${side}" data-key="${group.key}" type="text" inputmode="decimal" value="${group.item?.value ?? ""}" title="${escapeAttr(group.cells.map((cell) => `${cell.value.rawText ?? ""} bbox:${JSON.stringify(cell.value.box)}`).join("; "))}"></td>
        <td>${renderReportRawAttributePreview(report, source, side, context.specialBonusCompleteness, group.cells)}</td><td>${group.conflict ? `数值冲突：${group.cells.map((cell) => cell.value.value).join(" / ")}` : group.item === undefined ? "未识别" : `${((group.item.finalConfidence ?? group.item.confidence) * 100).toFixed(0)}%`}${group.needsConfirmation ? `<button class="btn btn-small" data-action="confirm-attribute-group" data-side="${side}" data-key="${group.key}">确认此值</button>` : " · 已确认"}</td></tr>`;
    }).join("")}</tbody></table></div>
    ${renderReportSpecialBonuses(report, side, source, context.specialBonusCompleteness)}
    <button class="btn btn-primary" data-action="apply-report-side" data-side="${side}">确认并应用到 ${side} 方</button>
    <button class="btn btn-small" data-action="clear-report-context" data-side="${side}">清除本方识图预览</button>`}
    </div>`;
}

function updateAttributeReportField(side: SideId, key: string, raw: string): void {
  const context = recognitionState[side], report = context.reportContext, source = context.selectedSourceSide;
  if (report === null || !raw.trim()) throw new Error("请先识别或填写属性值。");
  const parsed = report[source] ?? { sourceSide: source, attributes: {}, troopSetup: {}, specialEvidence: false };
  context.reportContext = { ...report, [source]: confirmAttributeGroup(parsed, attributeImportSchema(input, side), key, Number(raw)) };
  reportApplied[side] = false;
}

async function importReportImage(target: HTMLInputElement): Promise<void> {
  if (!import.meta.env.DEV) return;
  const files = [...(target.files ?? [])];
  const kind = target.dataset.importKind;
  const owner = kind === "final" ? null : requireSide(target.dataset.side);
  if (files.length === 0) return;
  const requestKey = owner ?? "final";
  const requestVersion = ++reportRequestVersions[requestKey];
  pendingReportImports += 1;
  perfMark("OCR request start");
  if (owner !== null) {
    reportApplied[owner] = false;
    specialWarningsAcknowledged[owner] = false;
    recognitionState[owner].specialBonusCompleteness = "incomplete";
  }
  else finalReportApplied = false;
  reportImportBusy = true;
  render();
  try {
    const images = await Promise.all(files.map(async (file) => {
      if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
        throw new Error("请选择不超过 10 MB 的图片。");
      }
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("图片读取失败。"));
        reader.readAsDataURL(file);
      });
      return { imageId: `${file.name}:${file.lastModified}`, dataBase64 };
    }));
    const { recognizeLocalReport } = await import("./recognizeLocalReport");
    const payload = await recognizeLocalReport(images);
    if (payload.performance !== undefined) recordOcrBackend(payload.performance);
    const { normalizeRecognitionResult } = await import("../pvp/battleReportRecognition/recognize");
    if (reportRequestVersions[requestKey] !== requestVersion) return;
    let nextRecognitionState = recognitionState;
    for (const [index, image] of payload.images.entries()) {
      const parsed = normalizeRecognitionResult(image, owner === null ? "FULL_12" : attributeImportSchema(input, owner));
      if (kind === "final") finalReportDraft = parsed;
      else if (owner !== null) {
        nextRecognitionState = mergeRecognitionImage(nextRecognitionState, owner, parsed,
          kind === "prediction-attributes" && index === 0 && parsed.pageTypes?.includes("attributes") === true);
      }
    }
    recognitionState = nextRecognitionState;
    errorMessage = null;
  } catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
  finally {
    pendingReportImports -= 1;
    reportImportBusy = pendingReportImports > 0;
    render();
    perfMark("OCR request end");
    perfMeasure("OCR upload to preview", "OCR request start", "OCR request end");
  }
}

function updateReportDraftField(target: HTMLInputElement): void {
  const kind = target.dataset.importKind;
  const owner = target.dataset.owner;
  const source = target.dataset.source === "right" ? "right" : "left";
  const draft = kind === "final" ? finalReportDraft :
    owner === "A" || owner === "B" ? recognitionState[owner].reportContext : null;
  if (draft === null) throw new Error("未加载识别结果。");
  const previous = draft[source];
  if (previous === undefined) throw new Error("未识别到指定侧。");
  const field = target.dataset.field;
  const raw = target.value.trim();
  let updated: ParsedBattleReportSide;
  if (field?.startsWith("bonus")) {
    const group = target.dataset.group as "additive" | "buffs" | "debuffs";
    const index = Number(target.dataset.index);
    const bonuses = previous.specialBonuses;
    const item = bonuses?.[group]?.[index];
    if (bonuses === undefined || item === undefined) throw new Error("特殊加成行无效。");
    if (field === "bonus-group") {
      if (raw !== "additive" && raw !== "buffs" && raw !== "debuffs")
        throw new Error("特殊加成分类无效。");
      if (raw === "additive" && !/官职|官職/.test(item.label))
        throw new Error("当前只有官职类可以归为 additive。");
      const category = raw === "buffs" ? "buff" as const :
        raw === "debuffs" ? "debuff" as const : "additive" as const;
      updated = { ...previous, specialBonuses: { ...bonuses,
        [group]: bonuses[group].filter((_, row) => row !== index),
        [raw]: [...bonuses[raw], { ...item, category,
          effectTarget: raw === "debuffs" ? "enemy" as const : "self" as const }] } };
    } else {
      let changed = item;
      if (field === "bonus") {
        const amount = Number(raw);
        if (!raw || !Number.isFinite(amount)) throw new Error("识别修正值必须是数字。");
        changed = { ...item, conflict: false, candidates: [],
          conflictValues: [],
          amount: { value: group === "debuffs" ? Math.abs(amount) : amount,
            confidence: 1, confirmed: true, box: blankOcrBox } };
      } else if (field === "bonus-label") {
        if (!raw) throw new Error("特殊加成名称不能为空。");
        const match = matchSpecialBonusLabel(raw);
        changed = { ...item, label: raw,
          canonicalLabel: match?.rule.canonicalLabel ?? raw,
          matchConfidence: match?.confidence ?? 0, matchScore: match?.confidence ?? 0,
          ...(match === undefined ? {} : { matchType: match.matchType }) };
      } else if (field === "bonus-stat") {
        if (!reportAttributes.includes(raw as typeof reportAttributes[number])) throw new Error("属性类型无效。");
        changed = { ...item, attribute: raw as typeof reportAttributes[number] };
      } else if (field === "bonus-target") {
        if (raw !== "self" && raw !== "enemy") throw new Error("作用对象无效。");
        changed = { ...item, effectTarget: raw };
      } else if (field === "bonus-troop") {
        if (raw !== "all" && !TROOP_TYPES.some((troop) => troop === raw))
          throw new Error("兵种范围无效。");
        const { troop: _oldTroop, ...withoutTroop } = item;
        void _oldTroop;
        changed = { ...withoutTroop, troopScope: raw as "all" | TroopType,
          ...(raw === "all" ? {} : { troop: raw as TroopType }) };
      } else throw new Error("特殊加成字段无效。");
      updated = { ...previous, specialBonuses: { ...bonuses,
        [group]: bonuses[group].map((entry, row) => row === index ? changed : entry) } };
    }
  } else {
    const amount = Number(raw);
    if (field !== "level" && (!raw || !Number.isFinite(amount))) {
      throw new Error("识别修正值必须是数字。");
    }
    const value = { value: field === "level" ? raw.toUpperCase() : amount,
      confidence: 1, confirmed: true, box: blankOcrBox };
    const troop = requireTroop(target.dataset.troop);
    if (field === "level" || field === "count" || field === "displayedTroopLevel" || field === "displayedFireCrystalLevel") {
      const previousSetup = previous.troopSetup[troop] ?? {};
      let setup = { ...previousSetup, [field]: value };
      if (field === "level") {
        const { resolvedTroopComposition: _previousComposition, ...withoutComposition } = setup;
        void _previousComposition;
        setup = { ...withoutComposition, resolutionSource: "userOverride" };
      }
      else {
        const { resolutionSource: _previousSource, ...withoutSource } = setup;
        void _previousSource;
        setup = resolveParsedTroopSetup(withoutSource);
        setup = { ...setup, resolutionSource: "userOverride" };
      }
      updated = { ...previous, troopSetup: { ...previous.troopSetup,
        [troop]: setup } };
    } else if (reportAttributes.some((attribute) => attribute === field)) {
      updated = { ...previous, attributes: { ...previous.attributes,
        [troop]: { ...previous.attributes[troop], [field!]: value } } };
    } else throw new Error("识别字段无效。");
  }
  const hasRemainingConflict = [updated, draft[source === "left" ? "right" : "left"]]
    .some((column) => (["additive", "buffs", "debuffs"] as const).some((group) =>
      column?.specialBonuses?.[group].some((bonus) => bonus.conflict)));
  const next = { ...draft, [source]: updated,
    warnings: hasRemainingConflict ? draft.warnings : draft.warnings.filter((warning) =>
      !warning.startsWith("特殊加成冲突")) };
  if (kind === "final") finalReportDraft = next;
  else {
    recognitionState[owner as SideId].reportContext = next;
    markReportDraftChanged(owner as SideId);
  }
}

function addManualReportBonus(side: SideId, source: ReportSourceSide): void {
  const form = app.querySelector<HTMLElement>(`[data-bonus-form="${side}-${source}"]`);
  if (form === null) throw new Error("特殊加成表单不存在。");
  const read = (selector: string) => form.querySelector<HTMLInputElement | HTMLSelectElement>(selector)?.value ?? "";
  const label = read("[data-bonus-label]").trim();
  const group = read("[data-bonus-group]") as "additive" | "buffs" | "debuffs";
  const attribute = read("[data-bonus-attribute]") as typeof reportAttributes[number];
  const troop = read("[data-bonus-troop]");
  const amount = Number(read("[data-bonus-value]"));
  if (!label || !Number.isFinite(amount) || !read("[data-bonus-value]").trim()) {
    throw new Error("请填写加成来源和数值。");
  }
  if (group === "additive" && !/官职|官職/.test(label)) {
    throw new Error("当前只有官职加成可以归为 additive。");
  }
  const draft = recognitionState[side].reportContext;
  if (draft === null || draft[source] === undefined) throw new Error("请先上传属性图片。");
  const previous = draft[source];
  const match = matchSpecialBonusLabel(label);
  const entry = { label, canonicalLabel: match?.rule.canonicalLabel ?? label,
    sourceRecognitionState: side, sourceReportSide: source, category: group === "buffs" ? "buff" as const :
      group === "debuffs" ? "debuff" as const : "additive" as const,
    activeInThisBattle: true as const, troopScope: troop ? requireTroop(troop) : "all" as const,
    attribute, amount: { value: group === "debuffs" ?
    Math.abs(amount) : amount, confidence: 1,
    confirmed: true, box: blankOcrBox },
  effectTarget: group === "debuffs" ? "enemy" as const : "self" as const,
  scope: /守城/.test(label) ? "garrison" as const : /集结/.test(label) ? "rally" as const : "general" as const,
  ...(troop ? { troop: requireTroop(troop) } : {}) };
  const bonuses = previous.specialBonuses ?? { additive: [], buffs: [], debuffs: [] };
  recognitionState[side].reportContext = { ...draft, [source]: { ...previous, specialEvidence: true,
    specialBonuses: { ...bonuses, [group]: [...bonuses[group], entry] } } };
  markReportDraftChanged(side);
}

function removeReportBonus(side: SideId, group: string | undefined,
  index: number, source: ReportSourceSide): void {
  if (group !== "additive" && group !== "buffs" && group !== "debuffs") {
    throw new Error("特殊加成类别无效。");
  }
  const draft = recognitionState[side].reportContext;
  const previous = draft?.[source];
  const bonuses = previous?.specialBonuses;
  if (draft === null || previous === undefined || bonuses === undefined ||
    !Number.isInteger(index) || bonuses[group][index] === undefined) {
    throw new Error("特殊加成项目无效。");
  }
  recognitionState[side].reportContext = { ...draft, [source]: { ...previous,
    specialBonuses: { ...bonuses, [group]: bonuses[group].filter((_, row) => row !== index) } } };
  markReportDraftChanged(side);
}

function resolveUnknownReportBonus(side: SideId, index: number,
  confirm: boolean, source: ReportSourceSide): void {
  const draft = recognitionState[side].reportContext;
  const previous = draft?.[source];
  const unknown = previous?.unmatchedBonuses?.[index];
  if (draft === null || previous === undefined || unknown === undefined ||
    !Number.isInteger(index)) throw new Error("待确认特殊加成项目无效。");
  let bonuses = previous.specialBonuses ?? { additive: [], buffs: [], debuffs: [] };
  if (confirm) {
    const row = app.querySelector<HTMLElement>(
      `[data-unknown-side="${side}"][data-unknown-source="${source}"][data-unknown-index="${index}"]`);
    if (row === null) throw new Error("待确认特殊加成表格不存在。");
    const read = (selector: string) => row.querySelector<HTMLInputElement | HTMLSelectElement>(
      selector)?.value.trim() ?? "";
    const label = read("[data-unknown-label]");
    const group = read("[data-unknown-group]") as "additive" | "buffs" | "debuffs";
    const target = read("[data-unknown-target]");
    const troopScope = read("[data-unknown-troop]");
    const attribute = read("[data-unknown-stat]") as typeof reportAttributes[number];
    const rawAmount = read("[data-unknown-value]");
    const amount = Number(rawAmount);
    if (!label || !rawAmount || !Number.isFinite(amount) ||
      (group !== "debuffs" && amount < 0) ||
      !["additive", "buffs", "debuffs"].includes(group) ||
      !["self", "enemy"].includes(target) ||
      !["all", ...TROOP_TYPES].includes(troopScope) ||
      !reportAttributes.includes(attribute)) {
      throw new Error("请完整核对未知加成的名称、数值、类型和作用范围。");
    }
    if (group === "additive" && !/官职|官職/.test(label)) {
      throw new Error("当前只有官职加成可以归为 additive。");
    }
    const match = matchSpecialBonusLabel(label);
    const entry = {
      label, canonicalLabel: match?.rule.canonicalLabel ?? label,
      sourceRecognitionState: side, sourceReportSide: source, activeInThisBattle: true as const,
      category: group === "buffs" ? "buff" as const :
        group === "debuffs" ? "debuff" as const : "additive" as const,
      attribute, troopScope: troopScope as "all" | TroopType,
      amount: { value: group === "debuffs" ? Math.abs(amount) : amount,
        confidence: 1, confirmed: true, box: blankOcrBox },
      scope: match?.rule.scope ?? "general" as const,
      effectTarget: target as "self" | "enemy",
    };
    bonuses = { ...bonuses, [group]: [...bonuses[group], entry] };
  }
  const unmatchedBonuses = previous.unmatchedBonuses!.filter((_, row) => row !== index);
  recognitionState[side].reportContext = { ...draft,
    warnings: unmatchedBonuses.length === 0 ? draft.warnings.filter((warning) =>
      !warning.startsWith("特殊加成名称未能归类")) : draft.warnings,
    [source]: { ...previous, specialBonuses: bonuses, unmatchedBonuses } };
  markReportDraftChanged(side);
}

function pendingRecognitionSides(): SideId[] {
  if (input.scenarioType === "INNER_EARTH") return [];
  return pendingDraftSides({ A: recognitionState.A.reportContext, B: recognitionState.B.reportContext }, reportApplied,
    isIceFireInput(input) ? "prediction" : input.attributeInputMode ?? "finalReport");
}

function markReportDraftChanged(side: SideId): void {
  const report = recognitionState[side].reportContext;
  if (report !== null) recognitionState[side].reportContext = refreshReportDiagnostics(report);
  reportApplied[side] = false;
}

function renderControls(n0: number | null): string {
  const innerEarth = input.scenarioType === "INNER_EARTH";
  const pendingReport = pendingRecognitionSides();
  const invalidRally = input.battleContext === "rally" &&
    input.attributeInputMode === "prediction" && !rallyDeploymentValid();
  const threeQueueError = pendingReport.length === 0 &&
    (isThreeQueueBattleInput(input) || innerEarth) ?
    threeQueueValidationError() : null;
  const invalidThreeQueue = threeQueueError !== null;
  const stage = getServerStage(validationStageId(input));
  return `<section class="control-strip" aria-label="战斗控制">
    <h2 class="control-title">全局战斗设置</h2>
    <label>服务器阶段<select data-scope="server-stage">${SERVER_STAGES.map((candidate) => `<option value="${candidate.id}" ${candidate.id === stage.id ? "selected" : ""}>${candidate.label}</option>`).join("")}</select></label>
    <div class="stage-summary"><span>英雄上限 <strong>S${stage.maxHeroGeneration}</strong></span><span>兵种上限 <strong>${stage.maxTroopLevel}</strong></span></div>
    <div class="scenario-picker"><span>战斗场景</span>${(["SINGLE", "CITY_DEFENSE", "THREE_THREE_THREE", "ICE_FIRE_LEAGUE", "RALLY", "INNER_EARTH"] as const).map((type) => `<label class="scenario-choice"><input type="radio" name="scenario-type" data-scope="scenario-type" value="${type}" ${(input.scenarioType ?? (input.battleContext === "rally" ? "RALLY" : "SINGLE")) === type ? "checked" : ""}><span>${({ SINGLE: "单撞模式", CITY_DEFENSE: "守城模式", THREE_THREE_THREE: "333模式", ICE_FIRE_LEAGUE: "冰火战歌模式", RALLY: "集结模式", INNER_EARTH: "地心模式" })[type]}</span></label>`).join("")}</div>
    ${innerEarth ? renderInnerEarthModePicker(input) : ""}
    <button class="btn btn-primary" data-action="run" ${invalidRally || invalidThreeQueue || pendingReport.length > 0 ? "disabled" : ""}>开始模拟</button>
    <button class="btn" data-action="open-optimizer" ${optimizationRunning ? "disabled" : ""}>配队优化</button>
    <button class="btn" data-action="run-batch" ${batchRunning || invalidRally || invalidThreeQueue || pendingReport.length > 0 ? "disabled" : ""}>${batchRunning ? `批量模拟中… ${batchProgress}/${batchCount}` : "开始批量模拟"}</button>
    <button class="btn" data-action="reset">重置</button>
    <label>模拟场次
      <input data-scope="batch-count" type="number" min="${MIN_BATCH_SIMULATION_COUNT}" max="${MAX_BATCH_SIMULATION_COUNT}" step="1" value="${batchCount}">
    </label>
    <label>模拟方式 <details class="inline-help"><summary aria-label="模拟方式说明">ⓘ</summary><p>固定种子或随机模拟均运行一次真实战斗，概率技能逐次随机判定。批量模拟用相同配置重复运行真实随机战斗，统计胜率、兵力与技能触发分布；不会将概率改成期望值。</p></details>
      <select data-scope="simulation-mode">
        <option value="fixedSeed" ${(input.simulationMode ?? "fixedSeed") === "fixedSeed" ? "selected" : ""}>固定种子模拟</option>
        <option value="random" ${input.simulationMode === "random" ? "selected" : ""}>随机模拟</option>
      </select>
    </label>
    <label>属性输入模式 <details class="inline-help"><summary aria-label="属性输入说明">ⓘ</summary><p>最终战报属性直接输入引擎，不重复计算专武或外部属性。预测模式从裸属性、特殊加成与阵容构造面板。三队列仅支持各队独立的预测 / 配置属性。</p></details>
      ${innerEarth ? `<output>${getInnerEarthRule(getInnerEarthConfig(input).subMode).inputMode === "prediction" ? "预期战报属性" : "最终战报属性"}（玩法固定）</output>` : isThreeQueueBattleInput(input) ? `<output>预测 / 配置（各队独立）</output>` : `
      <select data-scope="attribute-input-mode">
        <option value="finalReport" ${(input.attributeInputMode ?? "finalReport") === "finalReport" ? "selected" : ""}>最终战报属性</option>
        <option value="prediction" ${input.attributeInputMode === "prediction" ? "selected" : ""}>预测 / 配置</option>
      </select>`}
    </label>
    <label>战后规则 <details class="inline-help"><summary aria-label="战后伤亡说明">ⓘ</summary><p>退场兵力在战斗结束后分类。普通：损失 0%、受伤 35%、轻伤 65%；掏炉子：损失 35%、受伤 10%、轻伤 55%。击败＝损失＋受伤。此设置不改变战斗伤害。</p></details><select data-scope="casualty-mode"><option value="NORMAL" ${(input.postBattleCasualtyMode ?? "NORMAL") === "NORMAL" ? "selected" : ""}>普通 · 0/35/65</option><option value="FURNACE" ${input.postBattleCasualtyMode === "FURNACE" ? "selected" : ""}>掏炉子 · 35/10/55</option></select></label>
    ${(input.simulationMode ?? "fixedSeed") === "fixedSeed" ? `<label>随机种子
      <input data-scope="control" data-field="randomSeed" type="number" step="1" value="${input.randomSeed}">
    </label>` : `<div><span class="muted">随机种子</span><output>每次运行自动生成</output></div>`}
    <label>最大回合数
      <input data-scope="control" data-field="maxRounds" type="number" min="1" max="1500" step="1" value="${input.maxRounds}">
    </label>
    <div><span class="muted">固定 N0（只读）</span><output class="metric" data-rally-n0>${n0 === null ? "—" : formatNumber(n0)}</output></div>
    <div class="spacer"></div>
    <p class="control-help">固定种子模拟：相同输入会得到相同的概率技能触发结果。随机模拟每次运行生成新 seed，结果页可一键切回固定种子复现。批量模拟用于统计概率技能触发率、胜率等数据，不改变单场战斗最大回合数。</p>
    ${invalidRally ? `<p class="field-error">盾、矛、射比例必须合计 100%，且总兵力必须为非负整数。</p>` : ""}
    ${pendingReport.length > 0 ? `<p class="hint">${pendingReport.join("、")} 方识图仍是预览；确认并应用后才检查正式战斗配置。</p>` : ""}
    ${invalidThreeQueue ? `<p class="field-error">${escapeHtml(threeQueueError!)}。每队内部盾/矛/射比例须各合计 100.00%。</p>` : ""}
    ${developerMode ? `<button class="btn btn-small" data-action="copy-input">复制战斗输入</button><button class="btn btn-small" data-action="copy-trace" ${result === null ? "disabled" : ""}>复制战斗日志</button>` : ""}
  </section>`;
}

function rallyDeploymentValid(): boolean {
  try {
    resolveValidationTroopCounts(input.sideA, "rally", "prediction");
    resolveValidationTroopCounts(input.sideB, "rally", "prediction");
    return true;
  } catch {
    return false;
  }
}

function threeQueueValidationError(): string | null {
  try {
    if (input.scenarioType === "INNER_EARTH") { assertInnerEarthInput(input); return null; }
    for (const side of [input.sideA, input.sideB]) {
      const capacity = side.deploymentCapacity ?? TROOP_TYPES.reduce(
        (sum, troop) => sum + side.troops[troop].count, 0);
      if (!Number.isSafeInteger(capacity) || capacity < 1)
        return "三队列容量无效";
      for (const queue of getValidationThreeQueues(side)) {
        allocateThreeQueueTroops(capacity, toThreeQueueBasisPoints(queue.ratios));
        for (const troop of TROOP_TYPES) {
          if (!isTroopLevelAvailableAtStage(queue.troopLevels![troop], validationStageId(input)))
            return "三队列兵种等级超过服务器阶段";
          for (const attribute of reportAttributes)
            if (!Number.isFinite(queue.attributes![troop][attribute])) return "三队列属性输入无效";
        }
      }
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function threeQueueValid(): boolean { return threeQueueValidationError() === null; }

function renderOptimizer(): string {
  const route = optimizerRoute(input.scenarioType);
  if (route === "innerEarth") return renderInnerEarthOptimizer();
  const markup = route === "threeQueue" ? renderThreeQueueOptimizer() :
    route === "rally" ? renderRallyOptimizer() : renderSimpleOptimizer();
  return markup.replace('<div class="panel-body">',
    `<div class="panel-body">${renderHeroPool()}`);
}

function renderThreeQueueOptimizer(): string {
  const options = threeQueueOptimizerOptions;
  const pendingReport = pendingRecognitionSides().length > 0;
  const valid = !pendingReport && threeQueueValid();
  const numberField = (label: string, field: keyof ThreeQueueOptimizationOptions,
    min: number, max: number) => `<label>${label}<input data-scope="three-queue-optimizer" data-field="${field}" type="number" min="${min}" max="${max}" step="1" value="${options[field]}"></label>`;
  return `<section class="panel optimizer-panel"><header class="panel-head"><h2>冰火战歌优化</h2><span class="tag tag-cyan">完整三队胜率</span></header><div class="panel-body">
    <p class="hint">冰火战歌固定顺序：双方按队列位置循环。单队候选池 → 有界 Pair / Triple → 整场 Criterion → 浮点回合估计 → 累计 ${formalSampleSchedule(options).join(" / ")} 整场；保留上限 ${(options.formalStageKeeps ?? [80,25,10,options.finalCandidateCount]).join(" / ")}，共享seed补样本。各队历史英雄和战报来源固定，预期英雄/专武改变会重算属性。六排列按最差、平均、当前胜率依次排序。最终场数按每种敌方排列计。</p>
    <div class="optimizer-fields">
      <label>优化哪一方<select data-scope="three-queue-optimizer" data-field="side"><option value="A" ${options.side === "A" ? "selected" : ""}>进攻方 A</option><option value="B" ${options.side === "B" ? "selected" : ""}>防守方 B</option></select></label>
      <label>敌方队列变阵<select data-scope="three-queue-optimizer" data-field="enemyPermutationMode"><option value="fixedCurrent" ${options.enemyPermutationMode === "fixedCurrent" ? "selected" : ""}>固定当前顺序</option><option value="allPermutations" ${(options.enemyPermutationMode ?? "allPermutations") === "allPermutations" ? "selected" : ""}>全部6种排列</option><option value="worstCase" ${options.enemyPermutationMode === "worstCase" ? "selected" : ""}>最坏情况防守</option></select></label><label>固定我方当前队列顺序<input type="checkbox" data-scope="three-queue-optimizer" data-field="fixedOwnQueueOrder" ${options.fixedOwnQueueOrder ? "checked" : ""}></label><label>目标 <output>最差胜率 → 平均胜率 → 当前胜率</output></label>
      <label>兵种比例 <output>粗筛 5%，微调 1%</output></label>
      ${numberField("每队单队候选池", "criterionCandidatesPerQueue", 1, 300)}
      ${numberField("Pair 保留上限", "criterionPairLimit", 1, 10000)}
      ${numberField("Triple 评价上限", "criterionTripleLimit", 1, 10000)}
      ${numberField("Theory 保留上限", "criterionTheoryLimit", 1, 10000)}
      ${options.formalStageTrials ? `<label>自定义累计正式整场序列<output>${formalSampleSchedule(options).join(" / ")}</output></label>` :
        numberField("粗筛累计整场数", "coarseSimulationCount", 1, 100000) + numberField("复筛累计整场数", "refinementSimulationCount", 1, 100000)}
      ${numberField("最终候选数", "finalCandidateCount", 1, 20)}
      ${numberField("最终累计整场数", "finalValidationCount", 1, 100000)}
      ${numberField("随机种子", "rootSeed", Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)}
    </div>
    <div class="queue-grid">${[0, 1, 2].map((index) => `<div class="queue-card"><h4>第 ${index + 1} 队锁定</h4><label>锁定当前英雄 <input data-scope="three-queue-optimizer" data-field="lockHeroes" data-queue-index="${index}" type="checkbox" ${options.lockHeroes[index] ? "checked" : ""}></label><label>锁定当前比例 <input data-scope="three-queue-optimizer" data-field="lockRatios" data-queue-index="${index}" type="checkbox" ${options.lockRatios[index] ? "checked" : ""}></label></div>`).join("")}</div>
    <p class="hint">锁定比例需已是整百分比。各队保留当前出征容量与最高兵种等级；失败 Trial 计入验证场数，胜率分母与批量模拟一致。</p>
    <button class="btn btn-primary" data-action="run-optimizer" ${!valid || optimizationRunning ? "disabled" : ""}>${optimizationRunning ? "搜索中…" : "开始自动配队"}</button>
    ${optimizationRunning ? `<button class="btn btn-small" data-action="cancel-optimizer">取消搜索</button>` : ""}
    <span class="hint optimizer-progress">${escapeHtml(optimizerProgressText(optimizationProgress, optimizationPerformanceReport))}</span>
    <div class="optimizer-performance-host">${renderOptimizerPerformance(optimizationPerformanceReport)}</div>
    ${threeQueueSearchStatus === "cancelled" ? `<p class="hint">搜索已取消，未保留可应用的候选。</p>` : ""}
    ${pendingReport ? `<p class="hint">识图预览尚未应用，正式配队检查暂缓。</p>` : valid ? "" : `<p class="field-error">${escapeHtml(threeQueueValidationError() ?? "配置无效")}</p>`}
    ${errorMessage === null ? "" : `<p class="field-error">${escapeHtml(errorMessage)}</p>`}
  </div></section>${threeQueueOptimizationResult !== null && threeQueueResultRevision === revisionState.inputRevision
    ? renderThreeQueueOptimizationResult(threeQueueOptimizationResult) : ""}`;
}

function optimizerDimensions(): SearchDimensionsAudit {
  if (optimizerRoute(input.scenarioType) === "rally") return resolveSearchDimensions(input, {
    side: optimizationConfig.candidateSide ?? "A",
    fixedHead: TROOP_TYPES.every((troop) => optimizationConfig.constraints.fixedLeaders?.[troop] !== undefined),
    fixedBody: optimizationConfig.constraints.fixedBodyExact === true,
  });
  return resolveSearchDimensions(input, { side: simpleOptimizerOptions.side,
    fixedHead: simpleOptimizerOptions.fixedHeroes, fixedRatio: simpleOptimizerOptions.fixedRatio });
}

function searchScopeText(audit: SearchDimensionsAudit): string {
  const dimensions = audit.searchDimensions.map((dimension) => ({ head: "车头", ratio: "比例", body: "车身" })[dimension]);
  return `${audit.headSearchEnabled ? "搜索车头" : "当前车头及实际专武固定"} · 本次搜索维度：${dimensions.join(" × ") || "当前配置复验"}`;
}

function currentBestText(audit: SearchDimensionsAudit): string {
  return audit.headSearchEnabled ? "当前方案已是本次搜索空间中的最佳候选" :
    `当前固定车头下，当前${audit.searchDimensions.map((dimension) => ({ head: "车头", ratio: "比例", body: "车身" })[dimension]).join("与") || "配置"}已是本次搜索空间最佳候选`;
}

function renderOptimizerCard(title: string, winRate: number, trials: number,
  details: string, button = ""): string {
  return `<article class="optimizer-result-card"><h3>${title}</h3>
    <div class="optimizer-score">${formatPercent(winRate)}</div>
    <div class="hint">${trials} 场模拟</div>
    <div class="optimizer-card-details">${details}</div>${button}</article>`;
}

function renderOptimizationPerformance(value: { readonly performance?: OptimizationResult["performance"] }): string {
  const stats = value.performance;
  if (stats === undefined) return "";
  return `<details class="mini-details"><summary>高级调试 · 搜索性能</summary><p class="hint">实际评估 ${formatNumber(stats.simulatedTrials)} 个随机样本
    · 提前淘汰 ${stats.prunedCandidates} 个候选 · 节省 ${formatNumber(stats.skippedTrials)} 个样本
    · 模板命中 ${stats.templateHits} 次${stats.workerCount === undefined ? "" :
      ` · ${stats.workerCount === 0 ? "顺序计算" : `${stats.workerCount} 个并行 Worker`}`}
    · 当前方案和最终候选均完整复验</p></details>`;
}

function renderInnerEarthOptimizer(): string {
  const config = getInnerEarthConfig(input), rule = getInnerEarthRule(config.subMode);
  const queued = rule.heroMode === "threeQueues";
  const valid = threeQueueValidationError() === null;
  const field = (label: string, name: string, value: number, scope: string) =>
    `<label>${label}<input data-scope="${scope}" data-field="${name}" type="number" min="1" max="100000" value="${value}"></label>`;
  const fields = queued ? [
    field("粗筛每候选场次", "coarseSimulationCount", threeQueueOptimizerOptions.coarseSimulationCount, "three-queue-optimizer"),
    field("复筛每候选场次", "refinementSimulationCount", threeQueueOptimizerOptions.refinementSimulationCount, "three-queue-optimizer"),
    field("最终每候选场次（至少1000）", "finalValidationCount", Math.max(1000, threeQueueOptimizerOptions.finalValidationCount), "three-queue-optimizer"),
    field("单队候选池", "criterionCandidatesPerQueue", threeQueueOptimizerOptions.criterionCandidatesPerQueue ?? 120, "three-queue-optimizer"),
    field("廉价调度采样次数", "criterionSchedulerTrials", threeQueueOptimizerOptions.criterionSchedulerTrials ?? 100, "three-queue-optimizer"),
    field("Pair 保留上限", "criterionPairLimit", threeQueueOptimizerOptions.criterionPairLimit ?? 2000, "three-queue-optimizer"),
    field("Triple 评价上限", "criterionTripleLimit", threeQueueOptimizerOptions.criterionTripleLimit ?? 1000, "three-queue-optimizer"),
    field("Theory 保留上限", "criterionTheoryLimit", threeQueueOptimizerOptions.criterionTheoryLimit ?? 200, "three-queue-optimizer"),
  ].join("") : [
    field("首轮场次（20–50）", "coarseTrials", Math.max(20, Math.min(50, simpleOptimizerOptions.coarseTrials)), "simple-optimizer"),
    field("最终复验场次（至少1000）", "verificationTrials", Math.max(1000, simpleOptimizerOptions.verificationTrials), "simple-optimizer"),
    field("最终候选数（3–5）", "topN", Math.max(3, Math.min(5, simpleOptimizerOptions.topN)), "simple-optimizer"),
  ].join("");
  const audit = innerEarthOptimizationResult?.audit ?? createInnerEarthAudit(input);
  const resultMarkup = innerEarthOptimizationResult === null || innerEarthResultRevision !== revisionState.inputRevision ? "" : innerEarthOptimizationResult.kind === "ratio"
    ? renderSimpleOptimizationResult(innerEarthOptimizationResult.result, "apply-inner-earth-optimizer", "地心优化结果")
    : renderThreeQueueOptimizationResult(innerEarthOptimizationResult.result, "apply-inner-earth-optimizer", "地心优化结果");
  return `<section class="panel optimizer-panel"><header class="panel-head"><h2>${INNER_EARTH_MODE_LABELS[config.subMode]}优化</h2><span class="tag tag-cyan">${queued ? "英雄与比例" : "仅兵种比例"}</span></header><div class="panel-body">
    ${queued ? renderHeroPool() : ""}
    <p class="hint">${queued ? "随机选择存活队列，优化我方三队英雄及兵种比例；基础属性逐队固定，敌方共享配置固定。" : "固定无英雄模板；全部231个5%比例先计算Criterion与Theory，Top30进行20–50场正式评价，Top10复验300场，最终3–5候选至少1000场，再作1%局部微调。"}</p>
    <div class="optimizer-fields"><label>优化对象<output>我方 A（固定）</output></label>${fields}</div>
    ${queued ? `<div class="queue-grid">${[0, 1, 2].map((index) => `<div class="queue-card"><h4>第${index + 1}队锁定</h4><label>锁定当前英雄<input data-scope="three-queue-optimizer" data-field="lockHeroes" data-queue-index="${index}" type="checkbox" ${threeQueueOptimizerOptions.lockHeroes[index] ? "checked" : ""}></label><label>锁定当前比例<input data-scope="three-queue-optimizer" data-field="lockRatios" data-queue-index="${index}" type="checkbox" ${threeQueueOptimizerOptions.lockRatios[index] ? "checked" : ""}></label></div>`).join("")}</div>` : ""}
    ${renderInnerEarthPets(input)}
    <button class="btn btn-primary" data-action="run-optimizer" ${!valid || optimizationRunning ? "disabled" : ""}>${optimizationRunning ? "搜索中…" : "开始优化"}</button>
    ${optimizationRunning ? '<button class="btn btn-small" data-action="cancel-optimizer">取消搜索</button>' : ""}
    <span class="hint optimizer-progress">${escapeHtml(optimizerProgressText(optimizationProgress, optimizationPerformanceReport))}</span>
    <div class="optimizer-performance-host">${renderOptimizerPerformance(optimizationPerformanceReport)}</div>
    ${valid ? "" : `<p class="field-error">${escapeHtml(threeQueueValidationError() ?? "配置无效")}</p>`}
    <details><summary>高级审计 · 地心规则</summary><pre>${escapeHtml(JSON.stringify(audit, null, 2))}</pre></details>
    </div></section>${resultMarkup}`;
}

function renderThreeQueueOptimizationResult(value: ThreeQueueOptimizationResult,
  applyAction = "apply-three-queue-optimizer", title = "冰火战歌优化结果"): string {
  const heroName = (id: string | null | undefined): string => id === null || id === undefined
    ? "无" : catalog.leaderHeroes.find((hero) => hero.heroId === id)?.name ?? id;
  const ownedWeapons = (value.side === "A" ? input.sideA : input.sideB).simulationWeaponLevels;
  const leaderName = (id: string | null | undefined, weaponLevels?: Readonly<Record<string, number>>): string => {
    const level = id === null || id === undefined ? 0 : weaponLevels?.[id] ?? ownedWeapons?.[id] ?? 0;
    return `${heroName(id)}${level > 0 ? ` (专武 Lv${level})` : ""}`;
  };
  const ratio = (queue: ThreeQueueOptimizationResult["current"]["candidate"]["queues"][number]) =>
    TROOP_TYPES.map((troop) => (queue.ratiosBp[troop] / 100).toFixed(
      queue.ratiosBp[troop] % 100 === 0 ? 0 : 2)).join("/");
  const heroes = (queue: ThreeQueueOptimizationResult["current"]["candidate"]["queues"][number]) =>
    TROOP_TYPES.map((troop) => leaderName(queue.leaderHeroIds[troop], queue.headWeaponLevels)).join(" / ");
  const lineup = (candidate: ThreeQueueOptimizationResult["current"]["candidate"]): string =>
    candidate.queues.map((queue, index) => `<div><strong>第${index + 1}队 · 车头：</strong>
      ${escapeHtml(heroes(queue))}<br><strong>车身：</strong>无车身
      <br><strong>比例：</strong>${ratio(queue)}</div>`).join("");
  const best = value.topCandidates.find((row) => row.validTrials > 0);
  const bestIndex = best === undefined ? -1 : value.topCandidates.indexOf(best);
  const diff = best === undefined ? "" : value.current.candidate.queues.flatMap((queue, index) => {
    const next = best.candidate.queues[index]!;
    return [heroes(queue) === heroes(next) ? "" :
      `<div>Q${index + 1} 车头：${escapeHtml(heroes(queue))} → ${escapeHtml(heroes(next))}</div>`,
    ratio(queue) === ratio(next) ? "" :
      `<div>Q${index + 1} 比例：${ratio(queue)} → ${ratio(next)}</div>`].filter(Boolean);
  }).join("");
  const currentCard = renderOptimizerCard(value.current.permutationAudit ? "当前方案 · 最差换位胜率" : "当前方案", value.current.winRate,
    value.current.trials, lineup(value.current.candidate) + renderIceFirePermutationMetrics(value.current, value.side) + renderIceFireCandidateConversion(value.current));
  const recommendedCard = best === undefined ? "" : renderOptimizerCard(best.permutationAudit ? "推荐方案 · 最差换位胜率" : "推荐方案",
    best.winRate, best.trials,
    `<div class="optimizer-gain">相比当前 +${(100 * (best.winRate - value.current.winRate)).toFixed(2)} pct</div>
      ${lineup(best.candidate)}${renderIceFirePermutationMetrics(best, value.side)}${renderIceFireCandidateConversion(best)}`,
    best.isCurrent ? `<div class="hint">${value.criterionAudit?.ratioSearchExecuted && value.criterionAudit.alternativeRatiosEvaluated && value.criterionAudit.formalFinalistsCompared
      ? "当前方案是本次搜索空间最佳候选" : "本次未产生有效替代候选"}</div>` :
      `<button class="btn btn-primary" data-action="${applyAction}"
        data-index="${bestIndex}">应用推荐方案</button>`);
  return `<section class="panel optimizer-results"><header class="panel-head">
    <h2>${title}</h2><span class="tag tag-cyan">${value.status === "success" ?
      "搜索完成" : "验证失败"}</span></header><div class="panel-body">
    <p class="hint">${value.side === "A" ? "进攻方 A" : "防守方 B"} · Seed ${value.rootSeed}
      · 已搜索 ${value.searchedCandidateCount} 个方案 · 最终验证 ${value.finalValidatedCandidateCount} 个
      · 缓存命中 ${value.cacheHits}</p>
    ${renderOptimizationPerformance(value)}
    <div class="optimizer-card-grid">${currentCard}${recommendedCard}</div>
    ${best === undefined ? `<p class="field-error">没有有效复验结果。</p>` :
      `<div class="optimizer-diff"><h3>相比当前</h3>
        <div>胜率：${formatPercent(value.current.winRate)} → ${formatPercent(best.winRate)}</div>
        ${diff || "车头和比例保持不变"}</div>`}
    <h3>Top ${value.topCandidates.length} 候选</h3>
    ${value.criterionAudit === undefined ? "" : `<p class="hint">整场胜率 · ${value.criterionAudit.schedulerStrategy}
      · 单队候选 ${value.criterionAudit.singleQueueCandidates.join(" / ")}
      · Pair ${value.criterionAudit.pairCandidates} · Triple ${value.criterionAudit.tripleCandidates}
      · Theory ${value.criterionAudit.theoryTripleCandidates} · 正式 ${value.criterionAudit.formalTripleCandidates}</p>
      <details><summary>优化审计 · 调度、候选数量与分阶段模拟</summary><pre>${escapeHtml(JSON.stringify({
        ...value.criterionAudit, formalStages: value.formalStages, formalRacing: value.formalRacingAudit, scheduler: value.schedulerAudit, recommendedScheduler: value.recommendedSchedulerAudit, permutations: value.permutationAudit, sharedExpertAudit: value.sharedExpertAudit, finalWinRate: best?.winRate ?? 0,
        matchSequenceSource: "Criterion estimate", finalSimulationCount: value.finalValidationCount }, null, 2))}</pre></details>`}
    <div class="optimizer-list">${value.topCandidates.map((row, index) =>
      lazyDetails.render(`top-three-queue-${index}`, `#${index + 1} · 胜率 ${formatPercent(row.winRate)}
        · +${(100 * (row.winRate - value.current.winRate)).toFixed(2)} pct
        · Q1 ${escapeHtml(heroes(row.candidate.queues[0]))} · ${ratio(row.candidate.queues[0])}`,
        () => `<div class="optimizer-wave">${lineup(row.candidate)}${renderIceFirePermutationMetrics(row, value.side)}${renderIceFireCandidateConversion(row)}
          <div>模拟 ${row.trials} 场</div>
          ${row.isCurrent ? "<span>当前方案</span>" : `<button class="btn btn-small"
            data-action="${applyAction}" data-index="${index}"
            ${row.validTrials === 0 ? "disabled" : ""}>应用</button>`}
        </div>`)).join("")}</div>
  </div></section>`;
}

function renderSimpleOptimizer(): string {
  const is333 = input.scenarioType === "THREE_THREE_THREE";
  const options = simpleOptimizerOptions;
  const finalReport = input.attributeInputMode !== "prediction";
  const fixedHead = !optimizerDimensions().headSearchEnabled;
  return `<section class="panel optimizer-panel"><header class="panel-head"><h2>${is333 ? "333" : "单撞"}配队优化</h2><span class="tag tag-cyan">最大化整场胜率</span></header><div class="panel-body">
    <p class="hint">${fixedHead ? `${finalReport ? "最终战报属性模式下，" : "固定 / 空车头模式下，"}当前车头及实际专武固定，${is333 ? "兵种固定为 1:1:1，仅复验当前配置" : options.fixedRatio ? "兵种比例固定，仅复验当前配置" : "仅优化兵种比例；全部 231 个 5% 比例完成 Criterion、Theory 与首轮正式评价，再以 1% 局部精搜"}。` : `固定对手和服务器阶段；搜索所选一方的车头英雄${is333 ? "，兵种固定为 1:1:1" : "及盾／矛／射比例"}。全英雄组合覆盖；单撞以 5% 网格扫描全部理论比例，再保护多峰和探索候选，正式结果决定排名，局部微调精度为 1%。`}</p>
    <div class="optimizer-fields">
      <label>优化对象<select data-scope="simple-optimizer" data-field="side"><option value="A" ${options.side === "A" ? "selected" : ""}>A方</option><option value="B" ${options.side === "B" ? "selected" : ""}>B方</option></select></label>
      <label>目标 <output>最大化胜率</output></label>
      ${is333 ? `<label>兵种比例 <output>1:1:1（固定）</output></label>` : `<label>比例搜索精度 <output>理论 ${(options.theory ?? defaultTheoryOptions()).ratioStep}% / 微调 1%</output></label>`}
      <label>M1 首次正式场次<input data-scope="simple-optimizer" data-field="initialBattleTrials" type="number" min="1" max="100000" value="${options.initialBattleTrials ?? 5}"></label>
      <label>M3 每候选场次<input data-scope="simple-optimizer" data-field="intermediateTrials" type="number" min="1" max="100000" value="${options.intermediateTrials ?? 50}"></label>
      <label>M2 每候选场次<input data-scope="simple-optimizer" data-field="coarseTrials" type="number" min="1" max="100000" step="1" value="${options.coarseTrials}"></label>
      <label>M4 累计场次上限<input data-scope="simple-optimizer" data-field="middleTrials" type="number" min="1" max="100000" step="1" value="${options.middleTrials}"></label>
      <label>最终复验场次<input data-scope="simple-optimizer" data-field="verificationTrials" type="number" min="1" max="100000" step="1" value="${options.verificationTrials}"></label>
      <label>随机种子<input data-scope="simple-optimizer" data-field="seed" type="number" step="1" value="${options.seed}"></label>
      <label>最终候选数<input data-scope="simple-optimizer" data-field="topN" type="number" min="1" max="10" step="1" value="${options.topN}"></label>
      ${finalReport ? "" : `<label>固定当前车头<input data-scope="simple-optimizer" data-field="fixedHeroes" type="checkbox" ${options.fixedHeroes ? "checked" : ""}></label>`}
      ${is333 ? "" : `<label>固定当前兵种比例<input data-scope="simple-optimizer" data-field="fixedRatio" type="checkbox" ${options.fixedRatio ? "checked" : ""}></label>`}
    </div>
    ${is333 || !options.fixedRatio ? "" : `<p class="hint">固定比例时，当前三兵种比例须各为整数百分比；手动配置仍支持 0.01%。</p>`}
    <button class="btn btn-primary" data-action="run-optimizer" ${optimizationRunning ? "disabled" : ""}>${optimizationRunning ? "搜索中…" : "开始自动配队"}</button>
    <span class="hint optimizer-progress">${escapeHtml(optimizerProgressText(optimizationProgress, optimizationPerformanceReport))}</span>
    <div class="optimizer-performance-host">${renderOptimizerPerformance(optimizationPerformanceReport)}</div>
    ${errorMessage === null ? "" : `<p class="field-error">${escapeHtml(errorMessage)}</p>`}
  </div></section>${simpleOptimizationResult !== null && simpleResultRevision === revisionState.inputRevision
    ? renderSimpleOptimizationResult(simpleOptimizationResult) : ""}`;
}

function renderRallyOptimizer(): string {
  if (input.scenarioType === "CITY_DEFENSE") return renderPlayerOptimizer();
  const candidateSide = optimizationConfig.candidateSide ?? "A";
  const constraints = optimizationConfig.constraints;
  const joint = resolveJointPipelineOptions(optimizationConfig.jointPipeline);
  const finalReport = input.attributeInputMode !== "prediction";
  return `<section class="panel optimizer-panel">
    <header class="panel-head"><h2>集结自动配队</h2><span class="tag tag-cyan">复用当前战斗配置与引擎</span></header>
    <div class="panel-body">
      <p class="hint">合法 Head × canonical Body 完整求 J 峰值；Global Top10000 ∪ 每 Head Top1 召回，局部 5% Criterion → 1% Criterion → Theory → Formal20/50/100 → 比例复核 A/B → Formal300 → Final 至少1000 场共同种子复验。</p>
      <div class="optimizer-fields">
        <label>优化对象<select data-scope="optimizer" data-field="candidateSide"><option value="A" ${candidateSide === "A" ? "selected" : ""}>集结进攻方</option><option value="B" ${candidateSide === "B" ? "selected" : ""}>集结防守方</option></select></label>
        ${candidateSide === "B" ? '<label>目标<output>最高防守方胜率</output></label>' : `<label>目标<select data-scope="optimizer" data-field="objectiveMode">
          <option value="auto" ${optimizationConfig.objectiveMode === "auto" ? "selected" : ""}>自动选择</option>
          <option value="singleWin" ${optimizationConfig.objectiveMode === "singleWin" ? "selected" : ""}>最高单波胜率</option>
          <option value="minRallies" ${optimizationConfig.objectiveMode === "minRallies" ? "selected" : ""}>最少集结击破</option>
        </select></label>`}
        <label>J 全局保留<output>Top10000 Head × Body</output></label>
        ${([ ["perHeadProtectedK", "每 Head 保护 TopK", joint.perHeadProtectedK], ["criterionKeep", "5% Criterion 保留", joint.criterionKeep], ["criterionFineKeep", "1% Criterion 保留", joint.criterionFineKeep], ["theoryKeep", "Theory 保留", joint.theoryKeep], ["formalRatioKeep", "比例复核后进入 300 场", joint.formalRatioKeep] ] as const).map(([field,label,value]) => `<label>${label}<input data-scope="optimizer" data-field="joint-${field}" type="number" min="1" ${field === "perHeadProtectedK" ? "" : 'max="10000"'} value="${value}"></label>`).join("")}
        ${joint.formalStages.map((stage,i) => `<label>${stage.trials} 场后保留<input data-scope="optimizer" data-field="joint-formal-keep-${i}" type="number" min="1" value="${stage.keep}"></label>`).join("")}
        ${candidateSide === "B" || optimizationConfig.objectiveMode === "singleWin" ? "" : `
          <label>目标击破概率 %<input data-scope="optimizer" data-field="targetDefeatProbability" type="text" inputmode="decimal" value="${optimizationConfig.targetDefeatProbability * 100}"></label>
          <label>最多集结波数<input data-scope="optimizer" data-field="maxWaves" type="number" min="1" max="10" step="1" value="${optimizationConfig.maxWaves}"></label>
          <label>多波粗筛轨迹数<input data-scope="optimizer" data-field="beamTrials" type="number" min="1" max="100000" step="1" value="${optimizationConfig.beamTrials}"></label>
          <label>保留多波路径数<input data-scope="optimizer" data-field="beamWidth" type="number" min="1" max="20" step="1" value="${optimizationConfig.beamWidth}"></label>`}
        <label>Final 复验场次<input data-scope="optimizer" data-field="verificationTrials" type="number" min="1" max="100000" step="1" value="${optimizationConfig.verificationTrials}"></label>
        <label>随机种子<input data-scope="optimizer" data-field="firstSeed" type="number" step="1" value="${optimizationConfig.firstSeed}"></label>
        ${candidateSide === "A" && optimizationConfig.objectiveMode === "auto" ? `<label>自动切多波阈值 %<input data-scope="optimizer" data-field="singleFightThresholdLow" type="text" inputmode="decimal" value="${optimizationConfig.singleFightThresholdLow * 100}"></label>` : ""}
        ${finalReport ? "" : `<label>固定当前车头<input data-scope="optimizer" data-field="fixedLeaders" type="checkbox" ${TROOP_TYPES.every((troop) => constraints.fixedLeaders?.[troop] !== undefined) ? "checked" : ""}></label>`}
        <label>固定当前车身<input data-scope="optimizer" data-field="fixedMemberSkillIds" type="checkbox" ${constraints.fixedBodyExact ? "checked" : ""}></label>
      </div>

      ${candidateSide === "A" && optimizationConfig.objectiveMode === "auto" ? `<p class="hint">自动选择：最终复验最佳单波胜率不高于 ${formatPercent(optimizationConfig.singleFightThresholdLow)} 时进入多波搜索，否则优先单波。</p>` : ""}
      <button class="btn btn-primary" data-action="run-optimizer" ${!rallyDeploymentValid() || optimizationRunning ? "disabled" : ""}>${optimizationRunning ? "搜索中…" : "开始自动配队"}</button>
      <span class="hint optimizer-progress">${escapeHtml(optimizerProgressText(optimizationProgress, optimizationPerformanceReport))}</span>
    <div class="optimizer-performance-host">${renderOptimizerPerformance(optimizationPerformanceReport)}</div>
      ${errorMessage === null ? "" : `<p class="field-error">${escapeHtml(errorMessage)}</p>`}
      <p class="hint">当前搜索预算可配置；Beam 多波搜索为近似搜索，最终候选会用真实逐条随机轨迹复验。</p>
    </div>
  </section>${renderOptimizationResult(optimizationResult)}`;
}

function renderTheoryCoverage(value: TheoryCoverage | undefined): string {
  return value === undefined ? "" : `<p class="hint">理论评估 ${value.theoryCandidateCount.toLocaleString()}
    · 阵容 ${value.legalHeroLineupCount}（理论覆盖 ${value.theoryHeroCoverage}%）
    · 每阵容比例 ${value.ratiosPerHeroLineup} · 检测局部峰 ${value.localPeaksDetected}
    · M1 候选 ${value.battleCandidateCount.toLocaleString()}
    · 正式阵容覆盖 ${value.heroLineupsEnteringBattleEngine}/${value.legalHeroLineupCount}（${value.battleHeroCoverage}%）</p>`;
}

function renderSimpleOptimizationResult(value: SimpleScenarioOptimizationResult,
  applyAction = "apply-simple-optimizer", title?: string): string {
  const audit = value.searchDimensionAudit ?? optimizerDimensions();
  const ownedWeapons = (value.side === "A" ? input.sideA : input.sideB).simulationWeaponLevels;
  const heroes = (candidate: typeof value.current.candidate) =>
    TROOP_TYPES.map((troop) => catalog.leaderHeroes.find((hero) =>
      hero.heroId === candidate.leaderHeroIds[troop])?.name ?? "未配置")
      .map((name, index) => {
        const id = candidate.leaderHeroIds[TROOP_TYPES[index]!];
        const weapon = id === undefined || id === null ? 0 : candidate.headWeaponLevels?.[id] ?? ownedWeapons?.[id] ?? 0;
        return `${name}${weapon > 0 ? ` (专武 Lv${weapon})` : ""}`;
      }).join(" / ");
  const ratio = (candidate: typeof value.current.candidate) =>
    candidate.ratios === undefined ? "1:1:1" :
      TROOP_TYPES.map((troop) => candidate.ratios![troop].toFixed(2)).join("/");
  const details = (candidate: typeof value.current.candidate) =>
    `<div><strong>车头：</strong>${escapeHtml(heroes(candidate))}</div>
      <div><strong>车身：</strong>无车身</div>
      ${value.scenarioType === "SINGLE" ? `<div><strong>兵种比例：</strong>${ratio(candidate)}</div>` :
    "<div><strong>兵种比例：</strong>1:1:1（固定）</div>"}`;
  const best = value.topCandidates[0];
  const currentCard = renderOptimizerCard("当前方案", value.current.winRate,
    value.current.trials, details(value.current.candidate));
  const recommendedCard = best === undefined ? "" : renderOptimizerCard("推荐方案",
    best.winRate, best.trials,
    `<div class="optimizer-gain">相比当前 +${(100 * (best.winRate - value.current.winRate)).toFixed(2)} pct</div>
      ${details(best.candidate)}`,
    best.isCurrent ? `<div class="hint">${escapeHtml(currentBestText(audit))}</div>` :
      `<button class="btn btn-primary" data-action="${applyAction}"
        data-index="0">应用推荐方案</button>`);
  return `<section class="panel optimizer-results"><header class="panel-head">
    <h2>${title ?? `${value.scenarioType === "SINGLE" ? "单撞" : "333"}优化结果`}</h2>
    <span class="tag tag-cyan">${value.status === "success" ? "搜索完成" : "搜索失败"}</span>
    </header><div class="panel-body"><p class="hint">Seed ${value.seed}
      · 搜索候选 ${value.searchedCandidateCount} · 最终复验 ${value.finalValidatedCandidateCount}</p>
    <p class="hint">${escapeHtml(searchScopeText(audit))}</p>
    ${renderOptimizationPerformance(value)}
    ${renderTheoryCoverage(value.theoryCoverage)}
    ${lazyDetails.render("simple-theory-debug", "高级调试 · 理论与候选来源", () => `<pre>${escapeHtml(JSON.stringify({searchDimensions: audit, criterion: value.criterionAudit, coverage: value.theoryCoverage, heroPoolAudit: value.heroPoolAudit, ratioSearchAudit: value.ratioSearchAudit, searchIntegrityReport: value.searchIntegrityReport, candidates: value.topCandidates.map((row) => ({candidate: row.candidate, trials: row.trials}))}, null, 2))}</pre>`)}
    <div class="optimizer-card-grid">${currentCard}${recommendedCard}</div>
    ${best === undefined ? "" : `<div class="optimizer-diff"><h3>相比当前</h3>
      <div>车头：${heroes(value.current.candidate) === heroes(best.candidate) ? "保持当前" : `${escapeHtml(heroes(value.current.candidate))} → ${escapeHtml(heroes(best.candidate))}`}</div>
      ${value.scenarioType === "SINGLE" ? `<div>比例：${ratio(value.current.candidate) === ratio(best.candidate) ? "保持当前" : `${ratio(value.current.candidate)} → ${ratio(best.candidate)}`}</div>` : ""}
      <div>胜率：${formatPercent(value.current.winRate)} → ${formatPercent(best.winRate)}（+${(100 * (best.winRate - value.current.winRate)).toFixed(2)} pct）</div>
      </div>`}
    <h3>Top ${value.topCandidates.length} 候选</h3>
    <div class="optimizer-list">${value.topCandidates.map((row, index) =>
      lazyDetails.render(`top-simple-${index}`, `#${index + 1} · 胜率 ${formatPercent(row.winRate)}
        · +${(100 * (row.winRate - value.current.winRate)).toFixed(2)} pct
        · 车头 ${escapeHtml(heroes(row.candidate))} · 比例 ${ratio(row.candidate)}`,
        () => `<div class="optimizer-wave">${details(row.candidate)}
          <div>模拟 ${row.trials} 场</div>${row.isCurrent ? "当前方案" :
            `<button class="btn btn-small" data-action="${applyAction}"
              data-index="${index}">应用</button>`}</div>`)).join("")}</div>
    </div></section>`;
}

function renderOptimizationResult(value: OptimizationResult | null): string {
  if (value === null) return "";
  const candidateSide=value.optimizationContext?.candidateSide??value.searchDiagnostics?.optimizationTargetSide??"A";
  const audit=value.searchDimensionAudit??optimizerDimensions();
  const own=candidateSide==="A"?input.sideA:input.sideB;
  const candidateLabel=optimizationTargetLabel(input.scenarioType,candidateSide);
  const heroName = (id: string | null | undefined): string =>
    id === null || id === undefined ? "无" : catalog.leaderHeroes.find((hero) => hero.heroId === id)?.name ?? id;
  const leaderName = (id: string | null | undefined, candidate?: CandidateEvaluation["candidate"]): string => {
    const level = id === null ||
      id === undefined ? 0 : candidate?.headWeaponLevels?.[id] ?? own.simulationWeaponLevels?.[id] ?? 0;
    return `${heroName(id)}${level > 0 ? ` (专武 Lv${level})` : ""}`;
  };
  const lineup = (candidate: OptimizationResult["singleWaveTop"][number]["candidate"]): string =>
    `车头 ${TROOP_TYPES.map((troop) => leaderName(candidate.leaderHeroIds[troop], candidate)).join(" / ")}；车身 ${candidate.memberSkillIds.map((id) => {
      const group = catalog.memberSkills.find((skill) => skill.sourceSkillIds.includes(id));
      const source = group?.sourceHeroIds[group.sourceSkillIds.indexOf(id)];
      return heroName(source);
    }).join(" / ")}；盾矛射 ${candidate.ratios.shield}/${candidate.ratios.lancer}/${candidate.ratios.marksman}`;
  const leaders = (candidate: CandidateEvaluation["candidate"]) =>
    TROOP_TYPES.map((troop) => leaderName(candidate.leaderHeroIds[troop], candidate)).join(" / ");
  const bodies = (candidate: CandidateEvaluation["candidate"]) =>
    candidate.memberSkillIds.map((id) => {
      const group = catalog.memberSkills.find((skill) => skill.sourceSkillIds.includes(id));
      const source = group?.sourceHeroIds[group.sourceSkillIds.indexOf(id)];
      return heroName(source);
    }).join(" / ") || "未配置";
  const ratio = (candidate: CandidateEvaluation["candidate"]) =>
    `${candidate.ratios.shield}/${candidate.ratios.lancer}/${candidate.ratios.marksman}`;
  const details = (candidate: CandidateEvaluation["candidate"]) =>
    `<div><strong>车头：</strong>${escapeHtml(leaders(candidate))}</div>
    <div><strong>车身：</strong>${escapeHtml(bodies(candidate))}</div>
    <div><strong>比例：</strong>${ratio(candidate)}</div>`;
  const best = value.singleWaveTop[0];
  const path = value.status === "target_not_met"
    ? [...value.multiWaveTop].sort((a, b) =>
      (b.waves.at(-1)?.defeatProbability ?? 0) -
        (a.waves.at(-1)?.defeatProbability ?? 0))[0]
    : value.multiWaveTop[0];
  const pathIndex = path === undefined ? -1 : value.multiWaveTop.indexOf(path);
  const pathProbability = path?.waves.at(-1)?.defeatProbability ?? 0;
  const pathRecommendation = value.selectedMode === "minRallies" ? path?.sequence[0] : undefined;
  const pathRow = pathRecommendation === undefined ? undefined :
    value.singleWaveTop.find((row) => candidateKey(row.candidate) ===
      candidateKey(pathRecommendation));
  const usePath = pathRecommendation !== undefined && pathRow !== undefined &&
    pathRow.winRate >= value.currentEvaluation.winRate;
  const recommendation = usePath ? pathRecommendation : best?.candidate;
  const recommendationRow = usePath ? pathRow : best;
  const recommendationIsCurrent = recommendation !== undefined &&
    candidateKey(recommendation) === candidateKey(value.currentEvaluation.candidate);
  return `<section class="panel optimizer-results"><header class="panel-head"><h2>${candidateLabel}优化结果</h2><span class="tag tag-cyan">${value.status === "target_not_met" ? "目标未达成" : "搜索完成"}</span></header><div class="panel-body">
    <p class="hint">${value.selectedMode === "singleWin" ? `${candidateLabel}胜率` : "多波击破"} · 最终复验 ${value.currentEvaluation.trials} 场</p>
    <p class="hint">${escapeHtml(searchScopeText(audit))}</p>
    ${renderOptimizationPerformance(value)}
    ${(value.searchDiagnostics?.criterionAudit?.warnings??[]).map((warning)=>`<p class="notice warning">SEARCH_SPACE_EXPLOSION_WARNING：${escapeHtml(warning.stage)} ${warning.actual.toLocaleString()}（警戒值 ${warning.threshold.toLocaleString()}）</p>`).join("")}
    ${renderTheoryCoverage(value.searchDiagnostics?.theoryCoverage)}
    ${value.searchDiagnostics === undefined ? "" : lazyDetails.render("rally-search-debug", "高级调试 · 理论扫描与正式车头搜索", () => `<pre>${escapeHtml(JSON.stringify(value.searchDiagnostics, null, 2))}</pre>`)}
    <div class="optimizer-card-grid">
      ${renderOptimizerCard("当前方案", value.currentEvaluation.winRate,
        value.currentEvaluation.trials, details(value.currentEvaluation.candidate))}
      ${recommendation === undefined || recommendationRow === undefined ? "" :
        renderOptimizerCard(`推荐方案${usePath ? " · 第 1 波" : ""}`,
          recommendationRow.winRate, recommendationRow.trials,
          `<div class="optimizer-gain">相比当前 +${(100 * (recommendationRow.winRate - value.currentEvaluation.winRate)).toFixed(2)} pct</div>
          ${details(recommendation)}`,
          recommendationIsCurrent ? `<div class="hint">${escapeHtml(currentBestText(audit))}</div>` :
            `<button class="btn btn-primary" data-action="${usePath ? "apply-rally-wave" : "apply-rally-optimizer"}"
            data-index="${usePath ? pathIndex : 0}">应用推荐方案</button>`)}
    </div>
    ${recommendation === undefined ? "" : `<div class="optimizer-diff"><h3>相比当前</h3>
      <div>车头：${leaders(value.currentEvaluation.candidate) === leaders(recommendation) ? "保持当前" : `${escapeHtml(leaders(value.currentEvaluation.candidate))} → ${escapeHtml(leaders(recommendation))}`}</div>
      <div>车身：${bodies(value.currentEvaluation.candidate) === bodies(recommendation) ? "保持当前" : `${escapeHtml(bodies(value.currentEvaluation.candidate))} → ${escapeHtml(bodies(recommendation))}`}</div>
      <div>比例：${ratio(value.currentEvaluation.candidate) === ratio(recommendation) ? "保持当前" : `${ratio(value.currentEvaluation.candidate)} → ${ratio(recommendation)}`}</div>
      <div>胜率：${formatPercent(value.currentEvaluation.winRate)} →
        ${formatPercent(recommendationRow?.winRate ?? value.currentEvaluation.winRate)}</div></div>`}
    ${value.status === "target_not_met" ? `<p class="field-error">当前候选范围和最多 ${optimizationConfig.maxWaves} 波条件下，没有方案达到 ${formatPercent(optimizationConfig.targetDefeatProbability)} 目标；最高找到 ${formatPercent(pathProbability)}。以下展示最佳近似路径。</p>` : ""}
    ${value.approximation === null ? "" : `<p class="hint">${escapeHtml(value.approximation)}</p>`}
    <h3>单波 Top ${value.singleWaveTop.length}</h3>
    <div class="optimizer-list">${value.singleWaveTop.map((row, index) => lazyDetails.render(`top-rally-${index}`, `#${index + 1} · 胜率 ${formatPercent(row.winRate)} · +${(100 * (row.winRate - value.currentEvaluation.winRate)).toFixed(2)} pct · 车头 ${escapeHtml(TROOP_TYPES.map((troop) => leaderName(row.candidate.leaderHeroIds[troop], row.candidate)).join(" / "))} · 车身 ${escapeHtml(bodies(row.candidate))} · 比例 ${row.candidate.ratios.shield}/${row.candidate.ratios.lancer}/${row.candidate.ratios.marksman} · ${row.trials}场`,
      () => `<div class="optimizer-wave">${details(row.candidate)}<div>${row.trials} 场模拟</div></div>
      <button class="btn btn-small" data-action="apply-rally-optimizer" data-index="${index}">应用此方案</button>
      ${lazyDetails.render(`rally-distribution-${index}`, "高级调试 · 复验与剩余分布", () =>
      `<button class="btn btn-small" data-action="verify-optimizer" data-index="${index}" ${verificationRunning ? "disabled" : ""}>高精度复验 10000 场</button>
      <div class="optimizer-metrics"><span>胜/负/平/超时：${row.wins}/${row.losses}/${row.draws}/${row.timeouts}</span><span>Wilson 95%：${formatPercent(row.wilson95[0])}～${formatPercent(row.wilson95[1])}；区间重叠不能据此声称显著胜出</span>
      ${(["selfRemaining", "enemyRemaining"] as const).flatMap((side) => TROOP_TYPES.map((troop) => {
        const distribution = row[side][troop];
        return `<span>${side === "selfRemaining" ? candidateSide : candidateSide === "A" ? "B" : "A"} ${troopName(troop)}：均值 ${distribution.mean.toFixed(2)}，P5/P50/P95 ${distribution.p05}/${distribution.p50}/${distribution.p95}</span>`;
      })).join("")}</div>`, 'class="mini-details"')}`)).join("")}</div>
    ${value.selectedMode === "singleWin" || value.multiWaveTop.length === 0 ? "" : `<h3>多波推荐路径 · 目标 ${formatPercent(optimizationConfig.targetDefeatProbability)}</h3><div class="optimizer-list">${value.multiWaveTop.map((plan, index) => lazyDetails.render(`top-rally-wave-${index}`, `#${index + 1} · ${plan.targetWaves === null ? "目标概率未达成" : `最少 ${plan.targetWaves} 波达标`} · 最终估计击破 ${formatPercent(plan.waves.at(-1)?.defeatProbability ?? 0)} · ${plan.trials} 条复验轨迹`,
      () => `${plan.waves.map((wave, waveIndex) => `<div class="optimizer-wave"><strong>第 ${wave.wave} 波</strong>：${escapeHtml(lineup(plan.sequence[waveIndex]!))}<br>累计击破 ${formatPercent(wave.defeatProbability)}</div>`).join("")}<div>总成本：${plan.targetWaves ?? plan.waves.length} 次集结</div><button class="btn btn-small" data-action="apply-rally-wave" data-index="${index}">应用第 1 波方案</button>`)).join("")}</div>`}
  </div></section>`;
}

function renderSide(
  sideId: SideId,
  side: ValidationSideInput,
  preview: ReturnType<typeof createValidationPreviewState> | null,
  expected: ValidationExpectedReportBonus | null,
): string {
  const previewSide = preview === null ? null : sideId === "A" ? preview.sideA : preview.sideB;
  const sideRole = optimizationTargetLabel(input.scenarioType, sideId);
  const prediction = input.attributeInputMode === "prediction";
  const isRally = input.battleContext === "rally" && prediction;
  const is333 = input.scenarioType === "THREE_THREE_THREE";
  const displaySide = is333 ? resolveThreeThreeThreeSide(side) : side;
  return `<article class="panel side-${sideId.toLowerCase()}">
    <header class="panel-head side-heading"><h2>${sideId} 方配置 <small>${sideRole}</small></h2><span class="tag ${sideId === "A" ? "tag-amber" : "tag-cyan"}">${prediction ? "基础面板 → 预测阵容" : "最终战报 → 战斗技能"}</span>${(prediction ? reportApplied[sideId] : finalReportApplied) ? '<span class="tag tag-cyan">识图导入</span>' : ""}</header>
    <div class="panel-body">
      ${renderSideSection(
        "出征部队 · 士兵实力对比",
        `${isRally ? renderRallyDeployment(sideId, side) : ""}${is333 ? render333Deployment(sideId, side) : ""}<div class="troop-cards">${TROOP_TYPES.map((troop) => renderTroopRow(sideId, troop, displaySide.troops[troop], displaySide)).join("")}</div><p class="troop-total">总兵力：${formatNumber(TROOP_TYPES.reduce((sum, troop) => sum + displaySide.troops[troop].count, 0))}</p>`,
      )}
      ${renderSideSection("属性加成 · 战报百分比", renderAttributeInputs(sideId, side))}
      ${renderSideSection(
        prediction ? "历史战报英雄" : "最终战报模式",
        prediction ? `<p class="hint">用于反推历史战报中的英雄与专武属性贡献，不代表当前模拟阵容。</p><div class="hero-slot-grid">${TROOP_TYPES.map((troop) => renderHeroSelect("report-hero", sideId, side, troop)).join("")}</div>` : `<p class="hint">输入已含英雄静态属性、专武、城镇、宠物和专家加成的最终战报数值；仅选择实际生效的战斗英雄技能。兵数为战报中实际进入战斗的数量。</p>`,
      )}
      ${renderSideSection(
        "当前模拟英雄",
        `<p class="hint">盾、矛、射各一名；启用战斗相关远征技能（默认 Lv5）。</p><div class="hero-slot-grid">${TROOP_TYPES.map((troop) => renderHeroSelect("leader", sideId, side, troop)).join("")}</div>`,
      )}
      ${input.battleContext === "rally" ? renderSideSection(
        "车身技能",
        `<p class="hint">按效果分类选择；可搜索英雄、效果、数值或赛季。未选技能按默认 Lv5 展示，当前选择按实际等级展示。同效果只列出最早代代表，四个车身槽可重复选择。</p><div class="member-grid" aria-label="车身技能">${Array.from({ length: 4 }, (_, index) => renderMemberSelect(sideId, side, index)).join("")}</div>`,
      ) : ""}
      ${renderSideSection(
        "T12 兵种技能等级",
        `<div class="inline-fields">${TROOP_TYPES.map((troop) => `
          <label>${troopName(troop)}（0–24）
            <select data-scope="t12" data-side="${sideId}" data-troop="${troop}">${Array.from({ length: maxT12SkillLevel(input, sideId) + 1 }, (_, level) => `<option value="${level}" ${level === (side.troops[troop].t12Level ?? 0) ? "selected" : ""}>${level}</option>`).join("")}</select>
          </label>`).join("")}</div>${lazyDetails.render(`loadout-${sideId}`, "兵种技能预览", () => {
            const state = safePreview();
            return state === null ? "当前输入无法生成技能预览。" :
              renderLoadoutPreview(sideId === "A" ? state.sideA : state.sideB);
          }, 'class="mini-details"')}`,
      )}
      ${prediction ? renderSideSection(
        "历史报告与当前战斗加成",
        `${renderBonusContexts(sideId, side)}${renderExternalBuffs(sideId, side)}<div class="inline-fields"><label>${isRally ? "集结" : "出征"}容量增益 %<input data-scope="capacity" data-side="${sideId}" data-field="${isRally ? "rallyCapacityBonus" : "marchCapacityBonus"}" type="text" inputmode="decimal" value="${((isRally ? side.rallyCapacityBonus : side.marchCapacityBonus) ?? 0) * 100}"></label>${isRally ? `<label>固定容量增益<input data-scope="capacity" data-side="${sideId}" data-field="rallyFixedCapacityBonus" type="number" min="0" step="1" value="${side.rallyFixedCapacityBonus ?? 0}"></label>` : ""}<label>宠物出征容量等级（Lv0–10）<select data-scope="capacity" data-side="${sideId}" data-field="petMarchCapacityLevel">${Array.from({ length: 11 }, (_, level) => `<option value="${level}" ${level === (side.petMarchCapacityLevel ?? 0) ? "selected" : ""}>Lv${level} · +${level * 1500}</option>`).join("")}</select></label></div>`,
      ) : ""}
      ${prediction ? lazyDetails.render(`expected-${sideId}`, "预期战报加成", () => {
        const values = expected ?? safeExpectedPreview()?.[sideId];
        return values === undefined || values === null ? '<p class="hint">当前输入尚未形成有效预览。</p>' :
          renderExpectedReportBonus(values);
      }, 'class="side-section"') : ""}
      ${developerMode && previewSide?.heroStatCorrection !== undefined
        ? renderSideSection("Developer · 英雄与专武修正明细", renderCorrection(previewSide.heroStatCorrection))
        : ""}
    </div>
  </article>`;
}

function renderQueueExternalBuffs(sideId: SideId, index: number,
  queue: ValidationQueueConfig): string {
  const config = queue.externalBuffs ?? DEFAULT_EXTERNAL_BUFF_CONFIG;
  const townFields = [
    ["attack", "我方攻击增加"], ["defense", "我方防御增加"],
    ["penetration", "我方穿透增加"], ["life", "我方生命增加"],
    ["enemyAttackReduction", "敌方攻击降低"],
    ["enemyDefenseReduction", "敌方防御降低"],
  ] as const;
  const petFields = [
    ["attackLevel", "我方攻击", STANDARD_PET_LEVELS],
    ["defenseLevel", "我方防御", STANDARD_PET_LEVELS],
    ["penetrationLevel", "我方穿透", STANDARD_PET_LEVELS],
    ["lifeLevel", "我方生命", STANDARD_PET_LEVELS],
    ["enemyDefenseReductionLevel", "敌方防御降低", PET_DEFENSE_REDUCTION_LEVELS],
    ["enemyPenetrationReductionLevel", "敌方穿透降低", PET_PENETRATION_REDUCTION_LEVELS],
    ["enemyLifeReductionLevel", "敌方生命降低", PET_LIFE_REDUCTION_LEVELS],
  ] as const;
  const town = townFields.map(([field, label]) => `<label>${label}<select
    data-scope="queue-external" data-side="${sideId}" data-queue-index="${index}"
    data-section="town" data-field="${field}">${(["none", "small", "large"] as const)
      .map((size) => `<option value="${size}" ${config.town[field] === size ? "selected" : ""}>
      ${size === "none" ? "无" : size === "small" ? "小药 · 10%" : "大药 · 20%"}</option>`).join("")}
    </select></label>`).join("");
  const pet = petFields.map(([field, label, levels]) => `<label>${label}<select
    data-scope="queue-external" data-side="${sideId}" data-queue-index="${index}"
    data-section="pet" data-field="${field}">${levels.map((rate, level) =>
      `<option value="${level}" ${config.pet[field] === level ? "selected" : ""}>Lv${level} · ${(rate * 100).toFixed(2)}%</option>`).join("")}
    </select></label>`).join("");
  return `<details class="queue-external"><summary>本队外部 BUFF / DEBUFF</summary>
    <p class="hint">${(input.attributeInputMode ?? "finalReport") === "finalReport"
      ? "最终战报属性已包含外部增减益；此处保存队伍配置，切换到预测属性模式后参与计算。"
      : "预测属性模式会将本队外部增减益分别应用于本队战报属性。"}</p>
    <h6>城镇</h6><div class="external-grid">${town}</div>
    <h6>宠物</h6><div class="external-grid">${pet}</div>
    <h6>专家</h6><div class="external-grid"><label>敌方穿透降低<select
      data-scope="queue-external" data-side="${sideId}" data-queue-index="${index}"
      data-section="expert" data-field="garethFourthSkillLevel">${renderExpertSkillOptions(config.expert.garethFourthSkillLevel)}
    </select></label></div>${renderExpertSkillDescription(config.expert.garethFourthSkillLevel)}</details>`;
}

function renderQueueHeroSkillLevels(sideId: SideId, index: number,
  queue: ValidationQueueConfig): string {
  const heroIds = new Set(Object.values(queue.leaderHeroIds).filter(Boolean));
  const skills = catalog.skills.filter((skill) => skill.source === "hero" &&
    skill.category === "expedition" && skill.heroId !== null &&
    heroIds.has(skill.heroId) && skill.expeditionSkillSlot !== null);
  return `<details class="queue-skill-levels"><summary>本队英雄技能等级</summary>
    <div class="external-grid">${skills.map((skill) => `<label>${escapeHtml(
      catalog.leaderHeroes.find((hero) => hero.heroId === skill.heroId)?.name ?? skill.heroId ?? "")}
      · ${escapeHtml(skill.name)}<select data-scope="queue-skill-level" data-side="${sideId}"
      data-queue-index="${index}" data-skill-id="${escapeAttr(skill.id)}">${Object.keys(
        CONFIRMED_HERO_SKILL_DEFINITIONS.find((definition) => definition.id === skill.id)
          ?.levelValues ?? {}).map(Number).sort((a, b) => a - b).map((level) => `<option value="${level}"
        ${(queue.heroSkillLevels?.[skill.id] ?? 5) === level ? "selected" : ""}>Lv${level}</option>`).join("")}
      </select></label>`).join("") || "<p>先选择本队英雄。</p>"}</div></details>`;
}

function renderThreeQueueSide(sideId: SideId, side: ValidationSideInput): string {
  if (isIceFireInput(input)) return renderIceFireSide(input, sideId, (index) => renderQueueHeroSkillLevels(sideId, index, getValidationThreeQueues(side)[index]!));
  const queues = getValidationThreeQueues(side);
  const capacity = side.deploymentCapacity ?? TROOP_TYPES.reduce(
    (sum, troop) => sum + side.troops[troop].count, 0);
  const cards = queues.map((queue, index) => {
    const sum = TROOP_TYPES.reduce((total, troop) => total + queue.ratios[troop], 0);
    let counts: Readonly<Record<TroopType, number>> | null = null;
    try { counts = allocateThreeQueueTroops(capacity,
      toThreeQueueBasisPoints(queue.ratios)); } catch { /* Editing can be partial. */ }
    const heroes = TROOP_TYPES.map((troop) => `<label>${troopName(troop)}车头英雄
      <select data-scope="queue-hero" data-side="${sideId}" data-queue-index="${index}"
        data-troop="${troop}"><option value="">不配置</option>${catalog.leaderHeroes
          .filter((hero) => hero.troopType === troop &&
            isHeroAvailableAtStage(hero, validationStageId(input)))
          .map((hero) => `<option value="${escapeAttr(hero.heroId)}"
            ${queue.leaderHeroIds[troop] === hero.heroId ? "selected" : ""}>
            ${escapeHtml(formatValidationHeroOption(hero))}</option>`).join("")}</select></label>`).join("");
    const attributes = TROOP_TYPES.map((troop) => `<div class="report-attribute-group">
      <h4>${troopName(troop)}</h4>${(["attack", "defense", "penetration", "life"] as const)
        .map((field) => `<label>${troopName(troop)}${attributeName(field)}
          <span class="percent-input"><input data-scope="queue-attribute" data-side="${sideId}"
            data-queue-index="${index}" data-troop="${troop}" data-field="${field}"
            type="text" inputmode="decimal" value="${queue.attributes![troop][field]}"><em>%</em></span>
          </label>`).join("")}</div>`).join("");
    const levels = TROOP_TYPES.map((troop) => `<label>${troopName(troop)}等级
      <select data-scope="queue-level" data-side="${sideId}" data-queue-index="${index}"
        data-troop="${troop}">${getAvailableTroopLevels(validationStageId(input), troop)
          .map((level) => `<option value="${level}" ${level === queue.troopLevels![troop]
            ? "selected" : ""}>${level}</option>`).join("")}</select></label>`).join("");
    const ratios = TROOP_TYPES.map((troop) => `<label>${troopName(troop)}比例 %
      <input data-scope="queue-ratio" data-side="${sideId}" data-queue-index="${index}"
        data-troop="${troop}" type="text" inputmode="decimal"
        value="${queue.ratios[troop]}"></label>`).join("");
    return `<div class="queue-card"><h4>${sideId}${index + 1} 队</h4>
      ${queue.importedReportModifiers === undefined ? "" :
        '<p class="hint">本队历史属性已反推；历史特殊加成默认不沿用到新战斗。</p>'}
      <div class="queue-heroes">${heroes}</div>
      <h5>${input.attributeInputMode === "prediction" ? "本队基础战报属性" :
        "本队最终战报属性"}</h5><div class="report-attributes">${attributes}</div>
      <h5>本队兵种等级</h5><div class="queue-levels">${levels}</div>
      ${TROOP_TYPES.flatMap((troop) => {
        const parts = queue.troopLevelCompositions?.[troop];
        if (parts === undefined || parts.length < 2) return [];
        const total = parts.reduce((sum, part) => sum + part.aliveCount, 0);
        return [`<details><summary>${troopName(troop)}混兵构成（可修改）</summary><div class="inline-fields">${parts.map((part, partIndex) =>
          `<label>第 ${partIndex + 1} 组等级<select data-scope="queue-mixed-level" data-side="${sideId}" data-queue-index="${index}" data-troop="${troop}" data-index="${partIndex}">${getAvailableTroopLevels(validationStageId(input), troop).map((level) => `<option value="${level}" ${part.level === level ? "selected" : ""}>${level}</option>`).join("")}</select></label>
          <label>组内比例 %<input data-scope="queue-mixed-ratio" data-side="${sideId}" data-queue-index="${index}" data-troop="${troop}" data-index="${partIndex}" type="text" inputmode="decimal" value="${total === 0 ? 0 : (part.aliveCount / total * 100).toFixed(2)}"></label>`).join("")}</div></details>`];
      }).join("")}
      ${renderBonusContexts(sideId, queue, index)}
      ${renderQueueExternalBuffs(sideId, index, queue)}
      ${renderQueueHeroSkillLevels(sideId, index, queue)}
      <h5>本队兵种比例</h5><div class="queue-ratios">${ratios}</div>
      <p class="hint">本队合计 <strong class="${counts === null ? "negative" : "positive"}">
        ${sum.toFixed(2)}%</strong> · 实际兵数 ${counts === null ? "待修正比例" :
          TROOP_TYPES.map((troop) => `${troopName(troop)} ${formatNumber(counts[troop])}`).join(" / ")}
        · 总数 ${counts === null ? "—" : formatNumber(capacity)}</p>
      ${counts === null ? `<p class="field-error">本队盾、矛、射比例必须合计 100%。</p>` : ""}
      <details class="advanced-debug"><summary>本队属性来源调试（高级）</summary>
        <pre>${escapeHtml(JSON.stringify(createQueueReportLineageAudit(queue,
          `${sideId === "A" ? "sideA" : "sideB"}.threeQueues[${index}]`), null, 2))}</pre>
      </details>
    </div>`;
  }).join("");
  return `<article class="panel side-${sideId.toLowerCase()}">
    <header class="panel-head side-heading"><h2>${sideId} 方冰火战歌三队配置</h2>
      <span class="tag ${sideId === "A" ? "tag-amber" : "tag-cyan"}">每队独立配置</span>
    </header><div class="panel-body">
      ${renderSideSection("共用出征容量", `<label>单队列出征容量
        <input data-scope="deployment-capacity" data-side="${sideId}" type="number"
          min="1" step="1" value="${capacity}"></label>
        <p class="hint">每队分别占满此容量。比例只在本队内部合计 100%。</p>`)}
      ${renderSideSection("三队配置", `<div class="queue-grid">${cards}</div>`)}
      ${renderSideSection("T12 兵种技能等级", `<div class="inline-fields">${TROOP_TYPES
        .map((troop) => `<label>${troopName(troop)}（0–24）<select data-scope="t12"
          data-side="${sideId}" data-troop="${troop}">${Array.from({ length: 25 },
            (_, level) => `<option value="${level}" ${level === (side.troops[troop].t12Level ?? 0)
              ? "selected" : ""}>${level}</option>`).join("")}</select></label>`).join("")}</div>`)}
    </div></article>`;
}

function render333Deployment(sideId: SideId, side: ValidationSideInput): string {
  const capacity = side.deploymentCapacity ?? TROOP_TYPES.reduce(
    (sum, troop) => sum + side.troops[troop].count, 0);
  const resolved = resolveThreeThreeThreeSide(side);
  return `<div class="rally-deployment"><div class="queue-levels"><label>出征容量 N<input data-scope="deployment-capacity" data-side="${sideId}" type="number" min="0" step="1" value="${capacity}"></label>${TROOP_TYPES.map((troop) => `<label>最高${troopName(troop)}等级<select data-scope="three-queue-level" data-side="${sideId}" data-troop="${troop}">${getAvailableTroopLevels(validationStageId(input), troop).map((candidate) => `<option value="${candidate}" ${candidate === resolved.troops[troop].troopLevel ? "selected" : ""}>${candidate}</option>`).join("")}</select></label>`).join("")}</div><p class="hint">盾：矛：射固定 1：1：1；余数按盾、矛、射顺序分配。每个兵种使用该玩家所选的最高可用等级。</p></div>`;
}

function renderAttributeInputs(sideId: SideId, side: ValidationSideInput): string {
  return `<div class="report-attributes">${TROOP_TYPES.map((troop) =>
    `<div class="report-attribute-group"><h4>${troopName(troop)}</h4>${(["attack", "defense", "penetration", "life"] as const).map((field) =>
      `<label><span>${troopName(troop)}${attributeName(field)}</span><span class="percent-input"><input data-scope="troop" data-side="${sideId}" data-troop="${troop}" data-field="${field}" type="text" inputmode="decimal" value="${editorMode === "simple" && side.troops[troop][field] > 0 ? "+" : ""}${side.troops[troop][field]}"><em>%</em></span></label>`).join("")}</div>`).join("")}</div><p class="hint">输入战报显示的百分比，例如 4527.7%；内部换算由模型完成。</p>`;
}

function renderSideSection(title: string, content: string): string {
  return `<section class="side-section"><h3 class="section-title">${title}</h3>${content}</section>`;
}

function renderRallyDeployment(
  sideId: SideId,
  side: ValidationSideInput,
): string {
  const deployment = side.rallyDeployment ?? {
    totalTroops: TROOP_TYPES.reduce((sum, troop) => sum + side.troops[troop].count, 0),
    ratios: { shield: 34, lancer: 33, marksman: 33 },
  };
  let counts: Readonly<Record<TroopType, number>> | null = null;
  let allocationError: string | null = null;
  try {
    counts = resolveValidationTroopCounts(side, "rally", "prediction");
  } catch (error) {
    allocationError = error instanceof Error ? error.message : String(error);
  }
  const ratioTotal = TROOP_TYPES.reduce(
    (sum, troop) => sum + deployment.ratios[troop], 0,
  );
  const finalCapacity = counts === null ? null : TROOP_TYPES.reduce(
    (sum, troop) => sum + counts![troop], 0);
  return `<div class="rally-deployment">
    <div class="rally-inputs">
      <label>集结总兵力<input data-scope="rally" data-side="${sideId}" data-field="totalTroops" type="number" min="0" step="1" value="${deployment.totalTroops}"></label>
    </div>
    <div class="readonly-grid">
      <span>基础容量 <strong>${formatNumber(deployment.totalTroops)}</strong></span>
      <span>固定容量 <strong>+${formatNumber(side.rallyFixedCapacityBonus ?? 0)}</strong></span>
      <span>宠物容量 <strong>+${formatNumber((side.petMarchCapacityLevel ?? 0) * 1500)}</strong></span>
      <span>百分比容量 <strong>+${(((side.rallyCapacityBonus ?? 0) * 100)).toFixed(2)}%</strong></span>
      <span>最终集结容量 <strong>${finalCapacity === null ? "—" : formatNumber(finalCapacity)}</strong></span>
      <span>比例合计 <strong data-rally-ratio-sum class="${Math.abs(ratioTotal - 100) <= .005 ? "positive" : "negative"}">${ratioTotal.toFixed(2)}%</strong></span>
      ${TROOP_TYPES.map((troop) => `<span>实际${troopName(troop)} <strong data-rally-count="${troop}">${counts?.[troop] ?? "—"}</strong></span>`).join("")}
    </div>
    ${allocationError === null ? "" : `<p class="field-error">${escapeHtml(allocationError)}</p>`}
  </div>`;
}

function renderTroopRow(
  side: SideId,
  troop: TroopType,
  value: ValidationTroopInput,
  sideInput: ValidationSideInput,
  internals = true,
): string {
  const isRally = input.battleContext === "rally" && input.attributeInputMode === "prediction";
  const is333 = input.scenarioType === "THREE_THREE_THREE";
  const ratioOnly = !internals && (scenarioStateKey(input) === "SINGLE" || input.scenarioType === "CITY_DEFENSE");
  const levelMode = isRally ? "single" : value.levelMode ?? "single";
  let rallyCount = value.count;
  if (isRally) {
    try {
      rallyCount = resolveValidationTroopCounts(sideInput, "rally", "prediction")[troop];
    } catch {
      rallyCount = 0;
    }
  }
  const composition = isRally
    ? [{ level: value.troopLevel, aliveCount: rallyCount }]
    : getUiComposition(value);
  const totalAlive = composition.reduce((sum, entry) => sum + entry.aliveCount, 0);
  const effectiveC = totalAlive === 0
    ? getTroopConstant(value.troopLevel)
    : calculateEffectiveTroopConstant(composition).effectiveTroopConstant;
  const numberField = (field: keyof ValidationTroopInput, step = "0.01") =>
    `<input class="compact-input" data-scope="troop" data-side="${side}" data-troop="${troop}" data-field="${field}" ${step === "1" ? "type=\"number\" step=\"1\"" : "type=\"text\" inputmode=\"decimal\""} value="${String(value[field])}">`;
  return `<section class="troop-card">
    <div class="troop-card-head"><div class="troop-image" aria-hidden="true">${({ shield: "🛡", lancer: "⚔", marksman: "🏹" })[troop]}</div><div><h4>${troopName(troop)}</h4><span>${escapeHtml(value.troopLevel)} · ${formatNumber(totalAlive)} 兵</span></div></div>
    <div class="troop-fields">
      ${isRally ? `<label>比例 %<input class="compact-input" data-scope="rally" data-side="${side}" data-field="${troop}" type="text" inputmode="decimal" value="${sideInput.rallyDeployment?.ratios[troop] ?? (troop === "shield" ? 34 : 33)}"></label>` : ""}
      ${isRally || is333 ? "" : `<label>等级模式<select data-scope="troop-level-mode" data-side="${side}" data-troop="${troop}"><option value="single" ${levelMode === "single" ? "selected" : ""}>单等级</option><option value="mixed" ${levelMode === "mixed" ? "selected" : ""}>混等级</option></select></label>`}
      ${levelMode === "single" && !is333 ? `${isRally || ratioOnly ? "" : `<label>数量${numberField("count", "1")}</label>`}<label>${internals ? "等级" : "兵种等级"}<select data-scope="troop" data-side="${side}" data-troop="${troop}" data-field="troopLevel">${getAvailableTroopLevels(validationStageId(input), troop).map((level) => `<option value="${level}" ${level === value.troopLevel ? "selected" : ""}>${level}</option>`).join("")}</select></label>` : ""}
    </div>
    ${levelMode === "mixed" ? `<div class="mixed-composition"><div class="mixed-composition-head"><strong>${troopName(troop)}等级构成</strong><button class="btn btn-small" type="button" data-action="add-mixed-level" data-side="${side}" data-troop="${troop}" ${composition.length >= getAvailableTroopLevels(validationStageId(input), troop).length ? "disabled" : ""}>+ 添加等级</button></div>${composition.map((entry, index) => `<div class="mixed-level-row"><select aria-label="混等级兵种等级" data-scope="mixed-level" data-side="${side}" data-troop="${troop}" data-index="${index}">${getAvailableTroopLevels(validationStageId(input), troop).map((level) => `<option value="${level}" ${level === entry.level ? "selected" : ""} ${level !== entry.level && composition.some((candidate) => candidate.level === level) ? "disabled" : ""}>${level}</option>`).join("")}</select><input aria-label="该等级兵数" data-scope="mixed-count" data-side="${side}" data-troop="${troop}" data-index="${index}" type="number" min="0" step="1" value="${entry.aliveCount}"><button class="btn btn-small" type="button" data-action="remove-mixed-level" data-side="${side}" data-troop="${troop}" data-index="${index}" ${composition.length === 1 ? "disabled" : ""}>移除</button></div>`).join("")}</div>` : ""}
    ${internals ? `<div class="readonly-grid">
      <span>伤害系数 <strong>${TROOP_DAMAGE_COEFFICIENTS[troop]}</strong></span>
      <span>生命系数 <strong>${TROOP_HP_COEFFICIENTS[troop]}</strong></span>
      <span>总兵数 <strong>${totalAlive}</strong></span>
      <span>有效等级常数 C（只读） <strong>${formatTroopConstant(effectiveC)}</strong></span>
    </div>` : ""}
  </section>`;
}

function renderExternalBuffs(sideId: SideId, side: ValidationSideInput): string {
  const config = side.externalBuffs ?? DEFAULT_EXTERNAL_BUFF_CONFIG;
  return `<div class="external-buffs">${renderCombatBuffPresets(sideId)}
    <details open><summary>城镇增益</summary><div class="external-grid">
      ${townBuffSelect(sideId, "attack", "我方攻击增加", config.town.attack)}
      ${townBuffSelect(sideId, "defense", "我方防御增加", config.town.defense)}
      ${townBuffSelect(sideId, "penetration", "我方穿透增加", config.town.penetration)}
      ${townBuffSelect(sideId, "life", "我方生命增加", config.town.life)}
      ${townBuffSelect(sideId, "enemyAttackReduction", "敌方攻击降低", config.town.enemyAttackReduction)}
      ${townBuffSelect(sideId, "enemyDefenseReduction", "敌方防御降低", config.town.enemyDefenseReduction)}
    </div></details>
    <details open><summary>宠物增益</summary><div class="external-grid">
      ${petLevelSelect(sideId, "attackLevel", "我方攻击", config.pet.attackLevel, STANDARD_PET_LEVELS)}
      ${petLevelSelect(sideId, "defenseLevel", "我方防御", config.pet.defenseLevel, STANDARD_PET_LEVELS)}
      ${petLevelSelect(sideId, "penetrationLevel", "我方穿透", config.pet.penetrationLevel, STANDARD_PET_LEVELS)}
      ${petLevelSelect(sideId, "lifeLevel", "我方生命", config.pet.lifeLevel, STANDARD_PET_LEVELS)}
      ${petLevelSelect(sideId, "enemyDefenseReductionLevel", "敌方防御降低", config.pet.enemyDefenseReductionLevel, PET_DEFENSE_REDUCTION_LEVELS)}
      ${petLevelSelect(sideId, "enemyPenetrationReductionLevel", "敌方穿透降低", config.pet.enemyPenetrationReductionLevel, PET_PENETRATION_REDUCTION_LEVELS)}
      ${petLevelSelect(sideId, "enemyLifeReductionLevel", "敌方生命降低", config.pet.enemyLifeReductionLevel, PET_LIFE_REDUCTION_LEVELS)}
    </div></details>
    <details open><summary>专家增益</summary><div class="external-grid">
      <label>加雷斯四技能 · 敌方穿透降低<select data-scope="external" data-side="${sideId}" data-section="expert" data-field="garethFourthSkillLevel">${renderExpertSkillOptions(config.expert.garethFourthSkillLevel)}</select></label>${renderExpertSkillDescription(config.expert.garethFourthSkillLevel)}
    </div></details>
  </div>`;
}

function townBuffSelect(
  side: SideId,
  field: string,
  label: string,
  value: string,
): string {
  return `<label>${label}<select data-scope="external" data-side="${side}" data-section="town" data-field="${field}">
    ${(["none", "small", "large"] as const).map((size) => `<option value="${size}" ${value === size ? "selected" : ""}>${size === "none" ? "无" : size === "small" ? "小药 · 10%" : "大药 · 20%"}</option>`).join("")}
  </select></label>`;
}

function petLevelSelect(
  side: SideId,
  field: string,
  label: string,
  value: number,
  levels: readonly number[],
): string {
  return levelSelect(side, "pet", field, label, value, levels);
}

function levelSelect(
  side: SideId,
  section: "pet" | "expert",
  field: string,
  label: string,
  value: number,
  levels: readonly number[],
): string {
  return `<label>${label}<select data-scope="external" data-side="${side}" data-section="${section}" data-field="${field}">
    ${levels.map((rate, level) => `<option value="${level}" ${value === level ? "selected" : ""}>Lv${level} · ${(rate * 100).toFixed(rate * 100 % 1 === 0 ? 0 : 2)}%</option>`).join("")}
  </select></label>`;
}

function expectedPercent(value: number): string { return `${(value * 100).toFixed(4)}%`; }
function signedExpectedPercent(value: number): string { return `${value > 0 ? "+" : ""}${expectedPercent(value)}`; }
function renderExpectedReportBonus(value: ValidationExpectedReportBonus): string {
  const attributes = ["attack", "defense", "penetration", "life"] as const;
  return `<div class="expected-report">${TROOP_TYPES.map((troop) => `<section class="expected-troop"><h4>${troopName(troop)}</h4><div class="table-scroll"><table class="data-table"><thead><tr><th>属性</th><th>反推原始值</th><th>阵容修正</th><th>当前官职</th><th>当前 Buff</th><th>当前 Debuff</th><th>场景专武</th><th>外部 Buff 合计</th><th>预期战报</th></tr></thead><tbody>
    ${attributes.map((attribute) => {
      const row = value.breakdown[troop][attribute];
      const audit = row.calculationAudit;
      const inconsistent = import.meta.env.DEV && !expectedAttributeAuditIsConsistent(audit);
      if (inconsistent) console.error("预期属性表计算不一致", audit);
      return `<tr><td>${inconsistent ? '<strong class="error">预期属性表计算不一致</strong>' : ""}${attributeName(attribute)}</td><td>${expectedPercent(row.inputReportBonus)}</td><td>${signedExpectedPercent(row.lineupCorrection)}</td><td>${signedExpectedPercent(row.targetAdditive)}</td><td>${signedExpectedPercent(row.targetBuff)}</td><td>${row.targetDebuff === 0 ? "0.0%" : `-${expectedPercent(row.targetDebuff)}`}</td><td>${signedExpectedPercent(row.weaponScenarioContribution)}</td><td>${signedExpectedPercent(row.currentExternalBuffTotal)}</td><td><strong>${expectedPercent(row.finalBonus)}</strong></td></tr>`;
    }).join("")}</tbody></table></div></section>`).join("")}
    <details class="mini-details"><summary>高级调试 · 历史 / 当前加成与来源</summary><pre>${escapeHtml(JSON.stringify({
      units: "breakdown: decimal rates; calculationAudit: percentage points except targetBuff/targetDebuff/currentExternalBuffBase/currentWeaponBuff/currentExternalBuffTotal decimal rates; actualTargetBuffUsed includes the weapon rate", breakdown: value.breakdown,
    }, null, 2))}</pre></details>
    <p class="hint">历史条件仅供独立反推工具使用；当前Buff来自正规配置。公式：(100 + 基础属性 + 阵容修正) × (1 + 当前 Buff + 场景专武 Buff) ÷ (1 + 当前 Debuff) − 100。场景专武列展示来源；同属性的普通 Buff 与专武 Buff 先相加，统一进入外部 Buff 乘区。英雄主动技能在战斗内结算。</p></div>`;
}

function renderBonusContexts(sideId: SideId, side: ValidationSideInput | ValidationQueueConfig,
  queueIndex?: number): string {
  const key = `${sideId}-${queueIndex ?? "side"}`;
  const location = `data-side="${sideId}" ${queueIndex === undefined ? "" : `data-queue-index="${queueIndex}"`}`;
  const attributes = side.sourceReportAttributes ?? ("troops" in side ? side.troops : side.attributes);
  return lazyDetails.render(`source-bonuses-${key}`, "从历史战报反推基础属性", () => `
    ${advancedHelp("历史特殊加成（仅用于还原基础属性）。仅用于旧战报反推，不参与当前战斗。",
      "如果历史战报当时存在临时Buff或Debuff，在这里记录那一战的条件，再点击还原按钮，将结果明确写入基础属性。如果不是在做旧战报反推，这里无需填写。<p>例如：历史战报穿透3000%，当时有穿透Buff +20%、受到穿透Debuff 2%。填写20和2仅用于还原历史基础穿透，不会把这些加成带入今天的新战斗。</p>")}
    <h4>历史最终战报12项属性</h4><div class="report-attributes">${TROOP_TYPES.flatMap((troop) => reportAttributes.map((stat) => `<label>${troopName(troop)}${attributeName(stat)} %<input type="text" inputmode="decimal" data-scope="bonus-context" ${location} data-context="sourceReportAttributes" data-troop="${troop}" data-stat="${stat}" value="${attributes?.[troop][stat] ?? 0}"></label>`)).join("")}</div>
    ${renderHistoricalBonusTable(sideId, side, queueIndex)}
    <button class="btn" data-action="apply-historical-base" ${location}>还原并填入基础属性</button>
    <p class="hint">只有点击还原按钮才会改写当前基础属性；编辑历史记录不会改变当前BattleInput的战斗属性。</p>
    ${developerToolsEnabled && side.historicalBonusMigration ? `<p class="notice warning">旧历史条件有 ${side.historicalBonusMigration.conflicts.length} 项兵种间冲突，请核对原始记录。</p>` : ""}`, 'class="mini-details"');
}

function updateBonusContext(target: HTMLInputElement | HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side), side = getInputSide(sideId);
  const queueIndex = target.dataset.queueIndex;
  const queues = queueIndex === undefined ? undefined : [...getValidationThreeQueues(side)];
  const index = Number(queueIndex), current = queues === undefined ? side : queues[index]!;
  const stat = target.dataset.stat as typeof reportAttributes[number];
  if (!reportAttributes.includes(stat)) throw new Error("无效历史属性。");
  const value = readManualPercent(target as HTMLInputElement);
  let next: ValidationSideInput | ValidationQueueConfig;
  if (target.dataset.context === "sourceReportAttributes") {
    const troop = requireTroop(target.dataset.troop);
    const attributes = current.sourceReportAttributes ?? ("troops" in current ? current.troops : current.attributes!);
    next = { ...current, sourceReportAttributes: { ...attributes, [troop]: { ...attributes[troop], [stat]: value } } };
  } else {
    const field = target.dataset.field;
    if (target.dataset.context !== "sourceReportBonuses" || !["additive", "buff", "debuff"].includes(field ?? "")) throw new Error("无效历史加成。");
    const history = historicalReportBonuses(current);
    next = { ...current, sourceReportBonuses: { ...history, [stat]: { ...history[stat], [field!]: value } } };
  }
  if (queues === undefined) setInputSide(sideId, next as ValidationSideInput);
  else { queues[index] = next as ValidationQueueConfig; setInputSide(sideId, { ...side,
    threeQueues: queues as unknown as NonNullable<ValidationSideInput["threeQueues"]> }); }
}

function applyHistoricalBase(sideId: SideId, queueIndex?: string): void {
  const side = getInputSide(sideId), queues = queueIndex === undefined ? undefined : [...getValidationThreeQueues(side)];
  const index = Number(queueIndex), current = queues === undefined ? side : queues[index]!;
  const attributes = current.sourceReportAttributes ?? ("troops" in current ? current.troops : current.attributes!);
  const historical = { ...side, ...current, reportAttributeBasis: "historicalReport" as const,
    troops: Object.fromEntries(TROOP_TYPES.map((troop) => [troop, { ...side.troops[troop], ...attributes[troop] }])) as ValidationSideInput["troops"] };
  const raw = rawReportSide(historical as ValidationSideInput);
  if (!queues) setInputSide(sideId, { ...side, troops: raw.troops, sourceReportAttributes: attributes, reportAttributeBasis: "raw" });
  else {
    const converted = Object.fromEntries(TROOP_TYPES.map((troop) =>
      [troop, Object.fromEntries(reportAttributes.map((stat) => [stat, raw.troops[troop][stat]]))])) as NonNullable<ValidationQueueConfig["attributes"]>;
    queues[index] = { ...captureQueueReportBaseline(current as ValidationQueueConfig), attributes: converted,
      sourceReportAttributes: attributes, reportAttributeBasis: "raw", reportLineage: { source: "historicalReport",
        historicalLineageConfirmed: true, attributeSnapshot: structuredClone(converted) } };
    setInputSide(sideId, { ...side, threeQueues: queues as unknown as NonNullable<ValidationSideInput["threeQueues"]> });
  }
  input = { ...input, attributeInputMode: "prediction" };
}

function renderHeroSelect(
  scope: "report-hero" | "leader",
  sideId: SideId,
  side: ValidationSideInput,
  troop: TroopType,
): string {
  const selected = scope === "report-hero"
    ? side.reportHeroByTroop?.[troop] ?? null
    : side.leaderHeroIds?.[troop] ?? null;
  const heroes = (scope === "report-hero" ? catalog.reportHeroes : catalog.leaderHeroes)
    .filter((hero) => hero.troopType === troop &&
      isHeroAvailableAtStage(hero, validationStageId(input)));
  return `<div class="hero-option">${renderHeroPortrait(selected)}<label>${troopName(troop)}英雄
    <select data-scope="${scope}" data-side="${sideId}" data-troop="${troop}">
      <option value="">不配置</option>
      ${heroes.map((hero) => `<option value="${escapeAttr(hero.heroId)}" ${selected === hero.heroId ? "selected" : ""}>${escapeHtml(formatValidationHeroOption(hero))}</option>`).join("")}
    </select>
  </label>${selected === null ? "" : renderSelectedHeroWeapon(scope, sideId, side, selected)}</div>`;
}

function renderSelectedHeroWeapon(
  scope: "report-hero" | "leader",
  sideId: SideId,
  side: ValidationSideInput,
  heroId: string,
): string {
  if ((input.attributeInputMode ?? "finalReport") === "finalReport") return "";
  const hero = catalog.reportHeroes.find((candidate) => candidate.heroId === heroId);
  if (hero?.weaponMaxStat === null || hero === undefined) return "";
  const weaponScope = scope === "report-hero" ? "report-weapon" : "simulation-weapon";
  const level = scope === "report-hero"
    ? side.reportWeaponLevels?.[heroId] ?? 0
    : side.simulationWeaponLevels?.[heroId] ?? 0;
  return `<div class="hero-weapon">${renderWeaponLevelInput(weaponScope, sideId, heroId, "专武等级", level)}${renderWeaponEffectDescription(heroId, level, sideId, scope === "report-hero")}</div>`;
}

function renderWeaponEffectDescription(
  heroId: string,
  level: number,
  sideId: SideId,
  reportReference: boolean,
): string {
  const definition = CONFIRMED_HERO_SKILL_DEFINITIONS.find((candidate) =>
    candidate.heroId === heroId && candidate.positionRule.kind === "exclusiveWeapon");
  if (definition === undefined) return `<p class="hint">专武基础属性随等级提升；无场景技能。</p>`;
  const tier = getExclusiveWeaponSkillTier(level);
  const effect = definition.levelValues[tier]?.effects.find((candidate) =>
    candidate.kind === "attributeModifier");
  const scene = definition.battleContexts?.includes("rallyAttack")
    ? "集结进攻" : "集结防守/守城";
  if (effect?.kind !== "attributeModifier") {
    return `<p class="hint">${scene}：场景技能未解锁</p>`;
  }
  const active = !reportReference && input.battleContext === "rally" &&
    (sideId === "A" ? definition.battleContexts?.includes("rallyAttack")
      : definition.battleContexts?.some((context) =>
        context === "rallyDefense" || context === "garrisonDefense"));
  return `<p class="hint">${scene}：${attributeName(effect.attribute)} +${formatReportPercent(effect.value)}${reportReference ? " · 战报阵容参照，场景技能以模拟阵容为准" : active ? "" : " · 当前场景不生效"}</p>`;
}

function renderWeaponLevelInput(
  scope: "report-weapon" | "simulation-weapon",
  sideId: SideId,
  heroId: string,
  label: string,
  level: number,
): string {
  const weaponArt = renderWeaponArt(heroId);
  return `<div class="weapon-art-field">${weaponArt}<label>${escapeHtml(label)}<select data-scope="${scope}" data-side="${sideId}" data-hero="${escapeAttr(heroId)}">${Array.from({ length: 11 }, (_, weaponLevel) => `<option value="${weaponLevel}" ${weaponLevel === level ? "selected" : ""}>Lv${weaponLevel}</option>`).join("")}</select></label></div>`;
}

function renderMemberSelect(sideId: SideId, side: ValidationSideInput, index: number): string {
  const selected = side.bodySkills?.[index]?.skillId ??
    side.selectedMemberSkillIds[index] ?? "";
  const selectedLevel = side.bodySkills?.[index]?.skillLevel ?? 5;
  return renderBodySlotCard({ side: sideId, index, stage: validationStageId(input),
    developer: developerToolsEnabled,
    roleLabel: optimizationTargetLabel(input.scenarioType, sideId),
    selectedSkillId: selected, selectedLevel, query: memberSearchQueries.get(`${sideId}:${index}`) ?? "" });
}

function renderLoadoutPreview(side: ReturnType<typeof createValidationPreviewState>["sideA"]): string {
  return `<div>
    ${TROOP_TYPES.map((troop) => {
      const runtimes = side.troops[troop].skillStates;
      return `<div class="effect-line"><strong>${troopName(troop)}</strong> · ${runtimes.map((runtime) => {
        const display = getValidationTroopSkillDisplay(runtime);
        if (developerMode) {
          return `${escapeHtml(runtime.skillId)} · runtimeLevel=${runtime.level} · version=${escapeHtml(display.versionLabel)}`;
        }
        return `${escapeHtml(display.name)}${display.levelLabel === null ? "" : ` · ${display.levelLabel}`}`;
      }).join(" · ") || "无"}</div>`;
    }).join("")}
  </div>`;
}

function renderCorrection(correction: HeroStatCorrection): string {
  return `<div class="table-scroll"><table class="data-table">
    <thead><tr><th>兵种</th><th>属性</th><th>战报英雄</th><th>模拟英雄</th><th>战报专武</th><th>模拟专武</th><th>修正值</th></tr></thead>
    <tbody>${TROOP_TYPES.flatMap((troop) => (["attack", "defense", "penetration", "life"] as const).map((attribute) => {
      const delta = correction.delta[troop][attribute];
      return `<tr><td>${troopName(troop)}</td><td>${attributeName(attribute)}</td><td class="metric">${formatPercent(correction.reportHeroContribution[troop][attribute])}</td><td class="metric">${formatPercent(correction.simulationHeroContribution[troop][attribute])}</td><td class="metric">${formatPercent(correction.reportWeaponContribution[troop][attribute])}</td><td class="metric">${formatPercent(correction.simulationWeaponContribution[troop][attribute])}</td><td class="metric ${delta > 0 ? "positive" : delta < 0 ? "negative" : ""}">${signedPercent(delta)}</td></tr>`;
    })).join("")}</tbody>
  </table></div>`;
}

function renderDebugPanel(activeSkills: readonly ValidationActiveSkillOption[]): string {
  const sortedSkills = sortActiveSkillsForUi(activeSkills);
  const probabilitySkills = sortedSkills.filter((skill) => skill.probability !== null);
  return `<div class="panel-body">
      <button class="btn btn-small" data-action="disable-random">禁用全部概率技能</button>
      <button class="btn btn-small" data-action="auto-random">全部自动</button>
      <p class="hint">仅用于基础公式调试，不适用于真实战报复现。</p>
      <h3 class="section-title">概率判定覆盖</h3>
      ${renderActiveSkillGroups(probabilitySkills, (skill) => {
        const side = skill.side;
        if (skill.perTroop) {
          return skill.applicableTroops.map((troop) =>
            renderOverride(
              side,
              `${side}:${troop}:${skill.id}`,
              `${skill.name} · ${troopName(troop)}`,
              skill.probability,
              skill.uiSummary,
            )
          ).join("");
        }
        return renderOverride(
          side,
          `${side}:${skill.id}`,
          skill.name,
          skill.probability,
          skill.uiSummary,
        );
      }, "当前配置没有可判定的概率技能。")}

      <h3 class="section-title">禁用技能 / 效果来源</h3>
      <p class="hint">仅影响本次模拟；不改写定义目录与默认 RNG 行为。</p>
      ${renderActiveSkillGroups(sortedSkills, (skill) => `<label class="check-row"><input type="checkbox" data-scope="disable" value="${escapeAttr(skill.id)}" ${input.disabledSkillIds.includes(skill.id) ? "checked" : ""}><span><strong>${escapeHtml(skill.name)}</strong><small>${escapeHtml(skill.uiSummary)}</small><span class="tag">${skill.source === "hero" ? "英雄" : "兵种"}/${skillCategoryName(skill.category)}</span></span></label>`, "当前配置没有已加载技能。", "disable-list", "disabled")}

      ${developerMode ? `<h3 class="section-title">Developer · 实际战报逐回合数据</h3>
        <div class="table-scroll"><table class="data-table"><thead><tr><th>回合</th><th>实际 A → B</th><th>实际 B → A</th></tr></thead><tbody>
          ${Array.from({ length: Math.min(input.maxRounds, 30) }, (_, index) => renderActualRow(index + 1)).join("")}
        </tbody></table></div>` : ""}
    </div>
  `;
}

function renderOverride(
  side: SideId,
  key: string,
  label: string,
  probability: number | null,
  uiSummary: string,
): string {
  const current = input.triggerOverrides[key] ?? "AUTO";
  return `<div class="override-card"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(uiSummary)}</small><label>概率=${probability === null ? "—" : formatPercent(probability)}
    <select data-scope="override" data-side="${side}" data-key="${escapeAttr(key)}">
      ${(["AUTO", "FORCE_TRIGGER", "FORCE_NOT_TRIGGER"] as const).map((mode) => `<option value="${mode}" ${current === mode ? "selected" : ""}>${overrideModeName(mode)}</option>`).join("")}
  </select></label></div>`;
}

function renderActiveSkillGroups(
  skills: readonly ValidationActiveSkillOption[],
  renderSkill: (skill: ValidationActiveSkillOption) => string,
  emptyMessage: string,
  itemClass = "override-grid",
  sectionPrefix: "probability" | "disabled" = "probability",
): string {
  if (skills.length === 0) return `<p class="hint">${emptyMessage}</p>`;
  return `<div class="active-skill-sides">${(["A", "B"] as const).map((side) => {
    const sideSkills = skills.filter((skill) => skill.side === side);
    if (sideSkills.length === 0) return "";
    const groups = new Map<string, ValidationActiveSkillOption[]>();
    for (const skill of sideSkills) {
      const label = activeSkillGroupName(skill);
      groups.set(label, [...(groups.get(label) ?? []), skill]);
    }
    const expandedKey = `${sectionPrefix}-${side}` as ExpandedSectionKey;
    return `<details class="active-skill-side" data-expanded-section="${expandedKey}" ${expandedSections.has(expandedKey) ? "open" : ""}><summary>${side} 方技能</summary>${[...groups.entries()].map(([label, entries]) => `<section class="active-skill-group"><h4>${label}</h4><div class="${itemClass}">${entries.map(renderSkill).join("")}</div></section>`).join("")}</details>`;
  }).join("")}</div>`;
}

function activeSkillGroupName(skill: ValidationActiveSkillOption): string {
  if (skill.source === "troop") {
    return skill.category === "T12"
      ? `T12 ${troopName(skill.troopType)}技能`
      : `${troopName(skill.troopType)}兵种技能`;
  }
  if (skill.category === "exclusiveWeapon") return "专武场景技能";
  if (skill.position === "member") return "车身技能";
  return `${troopName(skill.troopType)}英雄技能`;
}

function renderActualRow(round: number): string {
  const row = input.actualRounds.find((candidate) => candidate.round === round);
  return `<tr><td>R${round}</td><td><input data-scope="actual" data-round="${round}" data-direction="AtoB" type="number" min="0" value="${row?.AtoB ?? ""}" placeholder="可选"></td><td><input data-scope="actual" data-round="${round}" data-direction="BtoA" type="number" min="0" value="${row?.BtoA ?? ""}" placeholder="可选"></td></tr>`;
}

function renderBatchStatistics(value: BatchSimulationResult | ThreeQueueBatchResult | null): string {
  if (value !== null && "attackerWins" in value) return renderThreeQueueBatchStatistics(value);
  return `<section class="panel batch-statistics">
    <header class="panel-head"><h2>批量统计</h2><span class="tag tag-cyan">仅保存聚合结果，不保留批量 Trace</span></header>
    <div class="panel-body">${value === null
      ? `<div class="empty">设置模拟场次后点击“开始批量模拟”。单场完整 BattleTrace 不受影响。</div>`
      : `<div class="batch-overview">
          <div class="batch-metric"><span>模拟次数</span><strong>${value.simulationCount}</strong></div>
          <div class="batch-metric"><span>A 胜</span><strong>${value.outcomes.A}</strong><small>${formatReportPercent(value.winRates.A)}</small></div>
          <div class="batch-metric"><span>B 胜</span><strong>${value.outcomes.B}</strong><small>${formatReportPercent(value.winRates.B)}</small></div>
          <div class="batch-metric"><span>平局</span><strong>${value.outcomes.draw}</strong></div>
          <div class="batch-metric"><span>达到回合上限</span><strong>${value.outcomes.timeout}</strong></div>
          ${renderBatchDistributionMetric("战斗回合数", value.distributions.roundCount)}
          <div class="batch-metric"><span>A 平均结算前取整伤害（含溢出）</span><strong>${formatNumber(value.averageDamage.A)}</strong></div>
          <div class="batch-metric"><span>B 平均结算前取整伤害（含溢出）</span><strong>${formatNumber(value.averageDamage.B)}</strong></div>
        </div>
        <p class="hint">${value.simulationMode === "fixedSeed" ? "固定种子批量" : "随机批量"} · 首个 seed=${value.firstSeed} · 末个 seed=${value.lastSeed}；每场使用不同 seed。</p>
        <h3 class="section-title">剩余兵数期望与 90%模拟区间</h3>
        <div class="batch-remaining-sides">${(["A", "B"] as const).map((side) => {
          const remaining = value.expectedRemaining[side];
          const distribution = value.distributions.sides[side];
          return `<section><h4>${side} 方</h4><div class="batch-overview">
            ${renderBatchDistributionMetric("期望剩余总兵力", distribution.remaining.total, remaining.total)}
            ${renderBatchDistributionMetric("期望剩余盾兵", distribution.remaining.shield, remaining.shield)}
            ${renderBatchDistributionMetric("期望剩余矛兵", distribution.remaining.lancer, remaining.lancer)}
            ${renderBatchDistributionMetric("期望剩余射手", distribution.remaining.marksman, remaining.marksman)}
          </div></section>`;
        }).join("")}</div>
        <h3 class="section-title">技能退出与击败归因</h3>
        ${renderBatchSkillDamageStatistics(value)}
        <h3 class="section-title">概率技能统计</h3>
        <div class="batch-skill-sides">${(["A", "B"] as const).map((side) => {
          const entries = value.skillStatistics.filter((entry) => entry.side === side);
          return `<section><h4>${side} 方</h4>${entries.length === 0
            ? `<p class="hint">当前配置没有发生概率判定的技能。</p>`
            : `<div class="batch-skill-list">${entries.map((entry) => `<article class="batch-skill-row"><div><strong>${escapeHtml(entry.skillName)}</strong><small>${escapeHtml(entry.uiSummary)}</small></div><dl><div><dt>检查次数</dt><dd>${entry.probabilityCheckCount}</dd></div><div><dt>触发次数</dt><dd>${getBattleReportSkillTriggerCount(entry)}</dd></div><div><dt>实际触发率</dt><dd>${entry.actualTriggerRate === null ? "—" : formatReportPercent(entry.actualTriggerRate)}</dd></div><div><dt>理论概率</dt><dd>${formatReportPercent(entry.theoreticalProbability)}</dd></div></dl>${developerMode ? `<code>${escapeHtml(entry.skillId)}</code>` : ""}</article>`).join("")}</div>`}</section>`;
        }).join("")}</div>`}</div>
  </section>`;
}

function renderThreeQueueBatchStatistics(value: ThreeQueueBatchResult): string {
  return `<section class="panel batch-statistics"><header class="panel-head"><h2>${input.scenarioType === "INNER_EARTH" ? INNER_EARTH_MODE_LABELS[getInnerEarthConfig(input).subMode] : "冰火战歌"}批量统计</h2><span class="tag tag-cyan">每次模拟均运行完整三队淘汰赛</span></header><div class="panel-body">
    <p class="hint">${value.threeQueueMode === "ICE_FIRE_LEAGUE" ? "冰火战歌 · 双方循环指针" : "地心三队闯关 · 随机存活队列"}</p>
    ${value.schedulerSample === null ? "" : `<p class="hint">首个完成样本（seed ${value.schedulerSample.trialSeed}）：${escapeHtml(value.schedulerSample.audit.matchSequence.join(" → "))}</p>`}
    <div class="batch-overview">
      <div class="batch-metric"><span>模拟次数</span><strong>${value.simulationCount}</strong></div>
      <div class="batch-metric"><span>A 胜</span><strong>${value.attackerWins}</strong><small>${formatReportPercent(value.attackerWinRate)}</small></div>
      <div class="batch-metric"><span>B 胜</span><strong>${value.defenderWins}</strong><small>${formatReportPercent(value.defenderWinRate)}</small></div>
      <div class="batch-metric"><span>未决 / 失败</span><strong>${value.failedTrials}</strong></div>
      <div class="batch-metric"><span>平均子战斗场数</span><strong>${formatBatchExpectation(value.averageBattleCount)}</strong></div>
      <div class="batch-metric"><span>A 平均剩余队列</span><strong>${formatBatchExpectation(value.avgAttackerRemainingQueues)}</strong></div>
      <div class="batch-metric"><span>B 平均剩余队列</span><strong>${formatBatchExpectation(value.avgDefenderRemainingQueues)}</strong></div>
      <div class="batch-metric"><span>A 平均生还兵数</span><strong>${formatBatchExpectation(value.avgAttackerSurvivors)}</strong></div>
      <div class="batch-metric"><span>B 平均生还兵数</span><strong>${formatBatchExpectation(value.avgDefenderSurvivors)}</strong></div>
    </div><p class="hint">root seed ${value.rootSeed} · 首次 trial seed ${value.firstTrialSeed} · 末次 trial seed ${value.lastTrialSeed}。胜率分母为全部 ${value.simulationCount} 次；下列平均值分母为 ${value.completedTrials} 次已完成模拟。</p>
    <details><summary>正式调度统计（完成整场为比例分母）</summary><pre>${escapeHtml(JSON.stringify(value.schedulerStatistics ?? "等待新的模拟统计",null,2))}</pre></details>
    ${value.failedTrials === 0 ? "" : `<p class="field-error">有 ${value.failedTrials} 次整场包含未决子战斗；请导出方案并按失败 seed 诊断，暂不提高回合上限。首个失败 seed：${value.failedTrialSeeds.slice(0, 5).join("、")}</p>`}
    <div class="summary-troops">${(["A", "B"] as const).map((side) => `<div class="side-summary"><h3>${side} 方平均战后伤亡</h3><div class="summary-totals"><span>损失<strong>${formatBatchExpectation(value.averageLoss[side])}</strong></span><span>受伤<strong>${formatBatchExpectation(value.averageInjured[side])}</strong></span><span>轻伤<strong>${formatBatchExpectation(value.averageLightlyWounded[side])}</strong></span></div></div>`).join("")}</div>
  </div></section>`;
}

function renderBatchDistributionMetric(
  label: string,
  distribution: BatchMetricDistribution,
  establishedMean = distribution.mean,
): string {
  return `<div class="batch-metric"><span>${label}</span><strong>均值：${formatBatchExpectation(establishedMean)}</strong>
    <small>90%模拟区间：[${distribution.p05}, ${distribution.p95}]</small>
    <details><summary>展开分布</summary><small>中位数 P50：${distribution.p50} · 最小值：${distribution.min} · 最大值：${distribution.max}</small></details></div>`;
}

function renderThreeQueueResults(value: ThreeQueueScenarioResult, stale: boolean): string {
  const counts = (population: Readonly<Record<TroopType, number>>) =>
    TROOP_TYPES.map((troop) => `${troopName(troop)} ${formatNumber(population[troop])}`).join(" / ");
  return `<section class="results ${stale ? "stale-result" : ""}" aria-label="三队列结果">
    ${stale ? `<div class="stale-banner" role="status">⚠ 当前输入已修改，下方结果来自上一次三队列模拟。</div>` : ""}
    <div class="outcome"><span class="label">${input.scenarioType === "INNER_EARTH" ? INNER_EARTH_MODE_LABELS[getInnerEarthConfig(input).subMode] : "冰火战歌"}战斗结果</span><span class="value">${value.winner} 方胜</span><span class="meta">共 ${value.totalBattles} 场 · 调度种子 ${value.scenarioTrace.threeQueueScheduler.seed} · ${value.scenarioTrace.threeQueueScheduler.schedulerType}</span></div>
    <p class="hint">实际交战顺序：${escapeHtml(value.scenarioTrace.threeQueueScheduler.matchSequence.join(" → "))}</p>
    <section class="panel"><header class="panel-head"><h2>对战顺序与剩余队列</h2></header><div class="panel-body"><p class="hint">${value.scenarioTrace.threeQueueScheduler.threeQueueMode === "ICE_FIRE_LEAGUE" ? "双方独立循环指针，每场后从本场队伍的下一位置寻找存活队伍，跳过已淘汰队伍。" : "每场使用统一 seeded RNG，分别从双方存活队列中均匀随机抽取。"}胜方保留本场实际剩余兵数。</p><p>A 剩余：${value.remainingAttackerQueues.length === 0 ? "无" : value.remainingAttackerQueues.map((queue) => `${queue.id}（${counts(queue.survivors)}）`).join("；")}</p><p>B 剩余：${value.remainingDefenderQueues.length === 0 ? "无" : value.remainingDefenderQueues.map((queue) => `${queue.id}（${counts(queue.survivors)}）`).join("；")}</p></div></section>
    ${value.battleResults.map((row) => {
      const trace = value.scenarioTrace.battles[row.battleNumber - 1]!;
      return lazyDetails.render(`queue-battle-${row.battleNumber}`, `<h2>第 ${row.battleNumber} 场 · ${row.attackerQueueId} 对 ${row.defenderQueueId}</h2><span class="tag tag-cyan">${row.winner} 胜 · seed ${row.battleSeed}</span>`,
        () => `<div class="panel-body"><p class="hint">战前 A：${counts(trace.attackerBefore)}；B：${counts(trace.defenderBefore)}</p><p class="hint">战后 A：${counts(trace.attackerAfter)}；B：${counts(trace.defenderAfter)}</p>${lazyDetails.render(`queue-trace-${row.battleNumber}`, `完整 BattleTrace · ${row.battle.simulation.trace.rounds.length} 回合`,
          () => `<pre>${escapeHtml(row.battle.readableTrace.slice(0, DEBUG_PREVIEW.chars))}</pre>`, 'class="mini-details"')}</div>`,
        'class="panel trace-panel"');
    }).join("")}
    <section class="panel"><header class="panel-head"><h2>战后伤亡汇总</h2></header><div class="panel-body"><div class="summary-troops">${(["A", "B"] as const).map((side) => {
      const casualty = value.aggregateCasualties[side];
      return `<div class="side-summary"><h3>${side} 方 · ${casualty.mode === "NORMAL" ? "普通" : "掏炉子"}</h3><p class="hint">初始 ${formatNumber(casualty.total.initial)} · 损失 ${formatNumber(casualty.total.loss)} · 受伤 ${formatNumber(casualty.total.injured)} · 轻伤 ${formatNumber(casualty.total.lightlyWounded)} · 生还 ${formatNumber(casualty.total.survivors)} · 击败 ${formatNumber(casualty.total.defeated)}</p><div class="table-scroll"><table class="data-table"><thead><tr><th>兵种</th><th>初始</th><th>损失</th><th>受伤</th><th>轻伤</th><th>生还</th><th>击败</th></tr></thead><tbody>${TROOP_TYPES.map((troop) => { const line = casualty.byTroop[troop]; return `<tr><td>${troopName(troop)}</td><td>${formatNumber(line.initial)}</td><td>${formatNumber(line.loss)}</td><td>${formatNumber(line.injured)}</td><td>${formatNumber(line.lightlyWounded)}</td><td>${formatNumber(line.survivors)}</td><td>${formatNumber(line.defeated)}</td></tr>`; }).join("")}</tbody></table></div></div>`;
    }).join("")}</div></div></section>
    ${renderGradeCasualties(value.aggregateCasualties)}
  </section>`;
}

function renderResults(
  value: ValidationBattleResult,
  stale: boolean,
): string {
  return `<section class="results ${stale ? "stale-result" : ""}" aria-label="战斗结果">
    ${stale ? `<div class="stale-banner" role="status">⚠ 当前输入已修改，下方结果来自上一次模拟，请重新运行。旧结果固定 N0=${value.initialState.fixedInitialMinTroops}。</div>` : ""}
    ${renderSummary(value)}
    ${renderGradeCasualties(value.postBattleCasualties)}
    ${renderSkillSummary(value)}
    ${lazyDetails.render("battle-trace", '<h2>详细逐回合战斗日志</h2><span class="tag tag-cyan">默认折叠 · 回合 → 行动 → 事件</span>',
      () => `<div class="panel-body"><div class="trace-range"><label>开始回合<input type="number" min="1" max="${value.summary.rounds}" data-scope="trace-range" data-field="start" value="${traceStartRound}"></label><label>结束回合<input type="number" min="1" max="${value.summary.rounds}" data-scope="trace-range" data-field="end" value="${traceEndRound}"></label></div><p class="hint">每次最多预览 ${DEBUG_PREVIEW.rounds} 回合、每回合 ${DEBUG_PREVIEW.events} 个事件；更改回合范围查看后续内容。</p>${value.trace.rounds.filter((round) => round.round >= traceStartRound && round.round <= traceEndRound).slice(0, DEBUG_PREVIEW.rounds).map((round) => renderRoundTrace(value, round)).join("")}</div>`,
      'class="panel trace-panel"')}
  </section>`;
}

function renderGradeCasualties(casualties: Readonly<Record<SideId, PostBattleCasualtyResult>>): string {
  if (!casualties.A.byGrade && !casualties.B.byGrade) return "";
  const sides = (["A", "B"] as const).map((side) => {
    const result = casualties[side];
    const differences = TROOP_TYPES.flatMap((troop) => {
      const delta = result.gradeRoundingDifference?.[troop];
      if (delta === undefined || ![delta.loss, delta.injured, delta.lightlyWounded, delta.survivors].some((value) => value !== 0)) return [];
      return [`${troopName(troop)}：损失 ${formatNumber(delta.loss)} / 受伤 ${formatNumber(delta.injured)} / 轻伤 ${formatNumber(delta.lightlyWounded)} / 生还 ${formatNumber(delta.survivors)}`];
    });
    const rows = TROOP_TYPES.flatMap((troop) => (result.byGrade?.[troop] ?? []).map((line) =>
      `<tr><td>${troopName(troop)} ${escapeHtml(line.level)}</td><td>${formatNumber(line.initial)}</td><td>${formatNumber(line.loss)}</td><td>${formatNumber(line.injured)}</td><td>${formatNumber(line.lightlyWounded)}</td><td>${formatNumber(line.survivors)}</td><td>${formatNumber(line.defeated)}</td><td>${formatNumber(line.roundingDifference)}</td></tr>`)).join("");
    return `<div class="side-summary"><h3>${side} 方</h3><div class="table-scroll"><table class="data-table"><thead><tr><th>兵种等级</th><th>初始</th><th>损失</th><th>受伤</th><th>轻伤</th><th>生还</th><th>击败</th><th title="损失+受伤+轻伤+生还减去初始兵数">明细差额</th></tr></thead><tbody>${rows}</tbody></table></div>${differences.length ? `<p class="hint">等级明细合计与兵种总数的差额：${differences.join("；")}</p>` : ""}</div>`;
  }).join("");
  return `<details class="panel trace-panel"><summary class="panel-head"><h2>按兵种等级拆分伤亡</h2></summary><div class="panel-body"><p class="hint">各项按初始混兵比例独立向上取整；不足的等级可为 0。等级明细可能产生取整差额，战斗总兵数与总伤亡仍守恒。</p><div class="summary-troops">${sides}</div></div></details>`;
}

function renderSummary(value: ValidationBattleResult): string {
  const outcome = value.summary.outcome === "timeout"
    ? "达到回合上限"
    : value.summary.outcome === "draw"
      ? "平局"
      : `${value.summary.outcome} 方胜`;
  return `<section class="summary-grid">
    <div class="outcome"><span class="label">战斗结果</span><span class="value">${outcome}</span><span class="meta">总回合数 ${value.summary.rounds} · 本次随机种子 ${value.input.randomSeed} · ${battleContextName(value.scenario.battleContext ?? "unspecified")}</span><button class="btn btn-small" data-action="replay-seed">使用此种子复现</button></div>
    <div class="summary-troops" aria-label="A、B 方最终状态对照">${(["A", "B"] as const).map((side) => {
      const role = optimizationTargetLabel(value.input.scenarioType, side);
      const casualty = value.postBattleCasualties[side];
      return `<div class="side-summary side-summary-${side.toLowerCase()}"><h3>${side} 方战报 <small>${role}</small></h3><div class="summary-totals casualty-totals"><span>部队<strong>${formatNumber(casualty.total.initial)}</strong></span><span>损失<strong>${formatNumber(casualty.total.loss)}</strong></span><span>受伤<strong>${formatNumber(casualty.total.injured)}</strong></span><span>轻伤<strong>${formatNumber(casualty.total.lightlyWounded)}</strong></span><span>生还<strong>${formatNumber(casualty.total.survivors)}</strong></span><span>击败<strong>${formatNumber(casualty.total.defeated)}</strong></span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>兵种</th><th>初始</th><th>损失</th><th>受伤</th><th>轻伤</th><th>生还</th><th>击败</th></tr></thead><tbody>${TROOP_TYPES.map((troop) => { const row = casualty.byTroop[troop]; return `<tr><td>${troopName(troop)}</td><td>${formatNumber(row.initial)}</td><td>${formatNumber(row.loss)}</td><td>${formatNumber(row.injured)}</td><td>${formatNumber(row.lightlyWounded)}</td><td>${formatNumber(row.survivors)}</td><td>${formatNumber(row.defeated)}</td></tr>`; }).join("")}</tbody></table></div><p class="hint">本场退出战斗 ${formatNumber(casualty.total.exited)}；战后按${casualty.mode === "FURNACE" ? "掏炉子 35/10/55" : "普通 0/35/65"}规则整数分配。击败＝损失＋受伤。</p></div>`;
    }).join("")}</div>
  </section>`;
}

function renderSkillSummary(value: ValidationBattleResult): string {
  return `<section class="panel skill-summary"><header class="panel-head"><h2>技能生效次数与击败归因</h2><span class="tag">保留退出人数</span></header><div class="panel-body">${renderSingleSkillDamageStatistics(value)}</div><div class="panel-body skill-summary-grid">${(["A", "B"] as const).map((side) => {
    const entries = value.skillSummary.filter((entry) => entry.side === side);
    return `<div><h3>${side} 方技能详情</h3>${entries.length === 0 ? `<p class="hint">本场没有技能生效或概率判定。</p>` : entries.map((entry) => `<details class="skill-summary-row"><summary><span><strong>${escapeHtml(entry.skillName)}</strong><small>${escapeHtml(entry.uiSummary)}</small></span><b>${entry.actualActivationCount}</b></summary><div class="kv-grid">
      <div class="kv"><span>判定次数</span><strong>${entry.probabilityCheckCount}</strong></div>
      <div class="kv"><span>成功次数</span><strong>${entry.procSuccessCount}</strong></div>
      <div class="kv"><span>extraDamage事件</span><strong>${entry.extraDamageEventCount}</strong></div>
      <div class="kv"><span>暴击 / 闪避 / 眩晕 / 跳过</span><strong>${entry.criticalCount} / ${entry.dodgeCount} / ${entry.stunCount} / ${entry.skippedActionCount}</strong></div>
    </div><p class="hint">来源：${formatTroopCounts(entry.activationBySourceTroop)}；目标：${formatTroopCounts(entry.activationByTargetTroop)}</p>${developerMode ? `<code>${escapeHtml(entry.skillId)}</code>` : ""}</details>`).join("")}</div>`;
  }).join("")}</div></section>`;
}

function renderRoundDamage(value: ValidationBattleResult): string {
  return `<section class="panel"><header class="panel-head"><h2>每回合模型伤害</h2></header><div class="panel-body"><table class="data-table"><thead><tr><th>回合</th><th>A → B</th><th>B → A</th></tr></thead><tbody>${value.roundDamage.slice(0, DEBUG_PREVIEW.rounds).map((row) => `<tr><td>R${row.round}</td><td class="metric">${formatNumber(row.AtoB)}</td><td class="metric">${formatNumber(row.BtoA)}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function renderComparisons(value: ValidationBattleResult): string {
  return `<section class="panel"><header class="panel-head"><h2>模型与实际战报对比</h2></header><div class="panel-body"><table class="data-table"><thead><tr><th>回合</th><th>方向</th><th>模型值</th><th>实际值</th><th>差值</th><th>误差率</th></tr></thead><tbody>${value.comparisons.slice(0, DEBUG_PREVIEW.events).map((row) => `<tr><td>R${row.round}</td><td>${row.direction === "AtoB" ? "A → B" : "B → A"}</td><td class="metric">${formatNumber(row.model)}</td><td class="metric">${formatNumber(row.actual)}</td><td class="metric ${row.difference > 0 ? "positive" : row.difference < 0 ? "negative" : ""}">${signed(row.difference)}</td><td class="metric">${row.errorRate === null ? "不适用" : formatPercent(row.errorRate)}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function renderRoundTrace(value: ValidationBattleResult, round: RoundBattleTrace): string {
  const effects = value.activeEffects.filter((effect) => effect.round === round.round).slice(0, DEBUG_PREVIEW.events);
  const previewEvents = round.damageEvents.slice(0, DEBUG_PREVIEW.events);
  const actionOrders = [...new Set(previewEvents.map((event) => event.actionOrder))]
    .sort((left, right) => left - right);
  return lazyDetails.render(`trace-round-${round.round}`, `<span>第 ${round.round} 回合</span><span class="tag">${battleContextName(round.roundStart.battleContext)} · N0=${round.roundStart.fixedInitialMinTroops} · ${round.damageEvents.length} 个事件（最多预览 ${DEBUG_PREVIEW.events} 个）</span>`, () => `<div class="round-content">
      <div class="snapshot-grid">${(["A", "B"] as const).map((side) => renderSnapshot(side, round)).join("")}</div>
      <details class="mini-details"><summary>生效中的效果 · ${effects.length}</summary><div>${effects.length === 0 ? `<p class="hint">无生效效果</p>` : effects.map((effect) => `<div class="effect-line"><strong>${effect.side}.${effect.holder === "army" ? "全军" : troopName(effect.holder)}</strong>${developerMode ? ` · effectId=${escapeHtml(effect.effectId)}` : ""} · ${effectKindName(effect.kind)}${developerMode && effect.group !== null ? ` · group=${effect.group}` : ""} · 数值=${effect.value === null ? "不适用" : formatPercent(effect.value)} · 层数=${effect.stacks} · 剩余=${effect.remainingDuration ?? "永久"} · 生效=R${effect.effectiveFromRound} · 到期=${effect.expiresAfterRound === null ? "永久" : `R${effect.expiresAfterRound}`}${developerMode ? ` · timing=${effect.activationTiming} · periodic=${effect.periodRounds === null ? "no" : `R${effect.firstActiveRound}/${effect.activeWindowRounds}of${effect.periodRounds}`}` : ""}</div>`).join("")}</div></details>
      ${renderHeroMechanicEvents(round)}
      <div>${actionOrders.map((actionOrder) => {
        const events = previewEvents.filter(
          (event) => event.actionOrder === actionOrder,
        );
        const primary = events.find((event) => event.parentEventId === undefined) ?? events[0]!;
        return `<details class="trace-action">
          <summary><span>行动 ${actionOrder} · ${primary.sourceSide}.${troopName(primary.sourceTroop)}</span><span class="tag">${events.length} 个伤害事件</span></summary>
          <div class="action-events">${events.map((event) => lazyDetails.render(`trace-event-${event.id}`, `${event.sourceSide}.${troopName(event.sourceTroop)} → ${event.targetSide}.${troopName(event.targetTroop)} · ${formatNumber(event.finalDamage)}`, () => renderDamageEvent(value, round, event), 'class="trace-event-preview"')).join("")}</div>
        </details>`;
      }).join("")}</div>
      ${renderRoundEnd(round)}
    </div>`, 'class="trace-round"');
}

function renderSnapshot(side: SideId, round: RoundBattleTrace): string {
  return `<div class="snapshot"><h4>回合开始快照 · ${side}</h4><table class="data-table"><thead><tr><th>兵种</th><th>等级构成</th><th>总存活</th><th>有效 C</th><th>加权分子</th><th>前排生命</th><th>单兵最大生命</th></tr></thead><tbody>${TROOP_TYPES.map((troop) => {
    const state = round.roundStart.sides[side][troop];
    return `<tr><td>${troopName(troop)}</td><td>${formatLevelComposition(state.levelCompositionAtRoundStart)}</td><td>${state.totalAliveCount}</td><td class="metric">${formatNumber(state.effectiveTroopConstant)}</td><td class="metric">${formatNumber(state.weightedConstantNumerator)}</td><td class="metric">${formatNumber(state.frontUnitHp)}</td><td class="metric">${formatNumber(state.maxHpPerUnit)}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}

function renderDamageEvent(
  value: ValidationBattleResult,
  round: RoundBattleTrace,
  rawEvent: RoundDamageEventTrace,
): string {
  // Bound every event-level collection before map/join builds the rich preview.
  const event = { ...rawEvent, ...Object.fromEntries(Object.entries(rawEvent)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => [key, (value as readonly unknown[]).slice(0, DEBUG_PREVIEW.events)])) };
  const source = round.roundStart.sides[event.sourceSide][event.sourceTroop];
  const target = round.roundStart.sides[event.targetSide][event.targetTroop];
  const end = round.roundEnd.troops.find(
    (troop) => troop.side === event.targetSide && troop.troop === event.targetTroop,
  );
  const relatedEventIds = new Set([
    event.id,
    event.rootEventId,
    ...(event.parentEventId === undefined ? [] : [event.parentEventId]),
  ]);
  const probabilistic = [
    ...round.troopSkills.filter((trace) =>
      trace.probability !== null &&
      (trace.parentEventId === undefined
        ? trace.side === event.sourceSide && trace.troop === event.sourceTroop
        : relatedEventIds.has(trace.parentEventId))
    ).map((trace) => ({
      name: trace.skillName,
      summary: trace.uiSummary,
      side: trace.side,
      troop: trace.troop,
      probability: trace.probability,
      roll: trace.rngRoll,
      triggered: trace.triggered,
      targetTroop: undefined,
      effectiveFromRound: undefined,
      expiresAfterRound: undefined,
    })),
    ...round.heroSkills.filter((trace) =>
      trace.probability !== null &&
      (trace.parentEventId === undefined
        ? trace.side === event.sourceSide &&
          (trace.sourceTroop === undefined || trace.sourceTroop === event.sourceTroop)
        : relatedEventIds.has(trace.parentEventId))
    ).map((trace) => ({
      name: trace.skillName,
      summary: trace.uiSummary,
      side: trace.side,
      troop: trace.sourceTroop ?? event.sourceTroop,
      probability: trace.probability,
      roll: trace.rngRoll,
      triggered: trace.triggered,
      targetTroop: trace.appliedDebuffTargetTroop,
      effectiveFromRound: trace.effectiveFromRound,
      expiresAfterRound: trace.expiresAfterRound,
    })),
  ];
  return debugHtmlPreview`<details class="event">
    <summary><span class="event-order">${event.actionOrder}</span><span class="event-title">${event.sourceSide}.${troopName(event.sourceTroop)} → ${event.targetSide}.${troopName(event.targetTroop)}</span><span class="tag">${damageTypeName(event.damageType, event.damageSubtype)}</span><span class="damage-pill">${formatNumber(event.finalDamage)}</span></summary>
    <div class="event-body">
      ${auditSection("战报验证摘要", kvs({ 回合: round.round, 攻击方兵种: `${event.sourceSide}.${troopName(event.sourceTroop)}`, 目标兵种: `${event.targetSide}.${troopName(event.targetTroop)}`, 原始伤害: formatNumber(event.rawDamage), 效果修正后: formatNumber(event.modifiedDamage), 取整伤害: formatNumber(event.roundedDamage), ...(event.primaryRoundedDamage === undefined ? {} : { 主普攻: event.mainHitCancelled ? "闪避 · 0" : formatNumber(event.primaryRoundedDamage) }), ...(event.internalSegments?.length ? { 连射内部伤害: formatNumber(event.internalSegments.reduce((sum, segment) => sum + segment.roundedDamage, 0)) } : {}), 实际承伤: formatNumber(event.appliedDamage), 攻击方有效C: formatNumber(source.effectiveTroopConstant), 回合末目标剩余: end?.aliveCount ?? "—", 回合末前排生命: end === undefined ? "—" : formatNumber(end.frontUnitHp), 概率判定数: probabilistic.length }))}
      ${auditSection("事件基础信息", kvs({
        来源: `${event.sourceSide}.${troopName(event.sourceTroop)}`,
        目标: `${event.targetSide}.${troopName(event.targetTroop)}`,
        伤害类型: damageTypeName(event.damageType, event.damageSubtype),
        ...(developerMode ? { eventId: event.id, parentEventId: event.parentEventId ?? "—", rootEventId: event.rootEventId, sourceSkillId: event.sourceSkillId ?? "—" } : {}),
      }))}
      ${auditSection("兵力信息", kvs({ 固定N0: round.roundStart.fixedInitialMinTroops, 攻击方存活: source.aliveCount, 目标回合初存活: target.aliveCount, 目标回合初前排生命: formatNumber(target.frontUnitHp), 目标单兵最大生命: formatNumber(target.maxHpPerUnit) }))}
      ${renderFormula(event)}
      ${renderEventCorrection(value, event)}
      ${auditSection("属性修正", event.baseDamageAttributeEffects.length === 0 ? `<p class="hint">无</p>` : event.baseDamageAttributeEffects.map((effect) => `<div class="effect-line">${developerMode ? `${escapeHtml(effect.effectId)} · ` : ""}${attributeName(effect.attribute)} · ${formatPercent(effect.effectiveValue)}${developerMode ? ` · ${effect.operation} · group=${effect.group}` : ""}</div>`).join(""))}
      ${auditSection("属性减益", event.attributeResolutions?.map(renderAttributeResolution).join("") || `<p class="hint">无</p>`)}
      ${renderGroups("增伤小乘区", event.increaseGroups, event.appliedIncreaseEffects)}
      ${renderGroups("减防小乘区", event.defenseReductionGroups, event.appliedDefenseReductionEffects)}
      ${renderGroups("减伤小乘区", event.reductionGroups, [...event.appliedReductionEffects, ...event.appliedDefenseEffects])}
      ${auditSection("受到伤害降低", `<div class="effect-line">${event.receivedDamageReductionSources.length === 0 ? "无来源" : event.receivedDamageReductionSources.map((effect) => `${escapeHtml(effect.sourceSkillId)}：${formatPercent(effect.effectiveValue)}`).join(" + ")} · 同组总计=${formatPercent(event.receivedDamageReductionTotal)} · 分母=${formatNumber(event.receivedDamageReductionDenominator)} · 应用前=${formatNumber(event.damageBeforeReceivedReduction)} · 应用后=${formatNumber(event.damageAfterReceivedReduction)}</div>`)}
      ${renderGroups("直接抵消", event.directCancellationGroups, event.appliedDirectCancellationEffects)}
      ${auditSection("临时护盾", event.temporaryShield.length === 0 ? `<p class="hint">本次伤害未经过临时护盾。</p>` : event.temporaryShield.map((shield) => `<div class="effect-line"><strong>${shield.ruleStatus === "TENTATIVE" ? "待定规则" : "临时护盾"}</strong> · ${shield.gatotShield === undefined ? `减伤前原始伤害基准=${formatNumber(shield.rawDamageBasis ?? 0)}` : `加托自身攻击力X=${formatNumber(shield.gatotShield.calculatedAttackX)}`} · 生成护盾=${formatNumber(shield.generatedShieldHp)} · 承伤前护盾=${formatNumber(shield.shieldHpBeforeHit)} · 吸收=${formatNumber(shield.absorbedDamage)} · 承伤后护盾=${formatNumber(shield.shieldHpAfterHit)}${developerMode ? ` · sourceSkill=${escapeHtml(shield.shieldSourceSkill)} · status=${shield.ruleStatus}` : ""}</div>`).join(""))}
      ${auditSection("概率技能", probabilistic.length === 0 ? `<p class="hint">该攻击事件没有关联的概率判定。</p>` : probabilistic.map((trace) => `<div class="effect-line"><strong>第 ${round.round} 回合 · ${event.sourceSide}.${troopName(event.sourceTroop)}攻击${event.targetSide}.${troopName(event.targetTroop)}</strong> · ${trace.side}.${troopName(trace.troop)} ${escapeHtml(trace.name)} · ${escapeHtml(trace.summary)} · 概率=${formatPercent(trace.probability ?? 0)} · ${developerMode ? `RNG=${trace.roll ?? "强制覆盖"} · ` : ""}${trace.triggered ? "触发" : "未触发"} · 减伤前=${formatNumber(event.rawDamage)} · 减伤后=${formatNumber(event.modifiedDamage)}${trace.targetTroop === undefined ? "" : ` · 状态目标=${troopName(trace.targetTroop)} · 生效=R${trace.effectiveFromRound}–R${trace.expiresAfterRound}`}</div>`).join(""))}
      ${developerMode && round.procEffectFamilies?.some((family) => family.parentEventId === event.id)
        ? auditSection("同机制技能概率与唯一效果", `<pre>${escapeHtml(debugJsonPreview(round.procEffectFamilies.filter((family) => family.parentEventId === event.id)))}</pre>`) : ""}
      ${auditSection("最终结算链", `<div class="chain"><span class="chain-step">原始 ${formatNumber(event.rawDamage)}</span><span class="arrow">→</span><span class="chain-step">效果修正 ${formatNumber(event.modifiedDamage)}</span><span class="arrow">→</span><span class="chain-step">取整 ${formatNumber(event.roundedDamage)}</span><span class="arrow">→</span><span class="chain-step">实际承伤 ${formatNumber(event.appliedDamage)}</span></div>${end === undefined ? "" : `<div class="kv-grid" style="margin-top:8px">${kvs({ 实际吸收: formatNumber(event.appliedDamage), 丢弃溢出: formatNumber(event.overflowDiscarded), 本回合退出战斗: end.casualties, 新存活数: end.aliveCount, 新前排生命: formatNumber(end.frontUnitHp) })}</div>`}`)}
    </div>
  </details>`;
}

function renderHeroMechanicEvents(round: RoundBattleTrace): string {
  const entries = round.heroSkills.filter((trace) =>
    trace.poisonTarget !== undefined ||
    trace.stunTarget !== undefined ||
    trace.temporaryShieldGenerated === true ||
    trace.defenseBuffActivation !== undefined ||
    trace.dreamMarkDamageCoefficient !== undefined ||
    (trace.multiTargetExtraDamageEvents?.length ?? 0) > 0 ||
    trace.vulnerabilityActivationRound !== undefined
  ).slice(0, DEBUG_PREVIEW.events);
  if (entries.length === 0) return "";
  return `<details class="mini-details" open><summary>英雄机制事件 · ${entries.length}</summary><div>${entries.map((trace) => {
    const target = trace.targetTroop === undefined
      ? ""
      : ` · 实际目标=${troopName(trace.targetTroop)}`;
    const counter = trace.attackCountAfter === undefined
      ? ""
      : ` · 主攻击计数=${trace.attackCountAfter}`;
    const proc = trace.probability === null
      ? ""
      : ` · 判定=${trace.triggered ? "触发" : "未触发"}${developerMode ? `（RNG=${trace.rngRoll ?? "强制覆盖"}）` : ""}`;
    const poison = trace.poisonTarget === undefined
      ? ""
      : ` · 中毒目标=${troopName(trace.poisonTarget)} · R${trace.poisonActivationRound}生效`;
    const stun = trace.stunTarget === undefined
      ? ""
      : ` · 眩晕目标=${troopName(trace.stunTarget)} · R${trace.skippedRound}跳过整次行动`;
    const shield = trace.temporaryShieldGenerated !== true
      ? ""
      : trace.gatotShield === undefined
        ? ` · <strong>待定规则</strong>：按减伤前原始伤害 ${formatNumber(trace.rawDamageBasis ?? 0)} 的30%生成临时护盾 ${formatNumber(trace.generatedShieldHp ?? 0)}`
        : ` · 加托护盾Lv${trace.gatotShield.skillLevel}：R${trace.triggerRound}触发、R${trace.activationRound}生效；100 × C(${formatNumber(trace.gatotShield.troopConstant)}) × √n(${trace.gatotShield.currentShieldCount}) × 战报攻击因子(${formatNumber(trace.gatotShield.reportAttackFactor)}) = X ${formatNumber(trace.gatotShield.calculatedAttackX)}；护盾=${formatPercent(trace.gatotShield.shieldRatio)} × X = ${formatNumber(trace.gatotShield.generatedShield)}；原护盾=${formatNumber(trace.gatotShield.previousShield)}，刷新后=${formatNumber(trace.gatotShield.refreshedShield)}`;
    const bounty = trace.lancerCompletedAttackCount === undefined ? "" :
      ` · 矛主攻累计${trace.lancerCompletedAttackCount}次${trace.bountyExtraDamageCoefficient === undefined ? "" : `；本轮追加${formatNumber(trace.bountyExtraDamageCoefficient)}B、攻击增益R${trace.bountyAttackBuffActivationRound}生效`}`;
    const torrent = trace.torrentTriggerRound === undefined ? "" :
      ` · 激流R${trace.torrentTriggerRound}触发，目标${trace.stunTarget === undefined ? "未知" : troopName(trace.stunTarget)}于R${trace.stunActivationRound}跳过行动`;
    const defense = trace.defenseBuffActivation === undefined
      ? ""
      : " · 防御增益本回合立即生效";
    const vulnerability = trace.vulnerabilityActivationRound === undefined
      ? ""
      : ` · 易伤从R${trace.vulnerabilityActivationRound}生效`;
    const multi = trace.multiTargetExtraDamageEvents === undefined
      ? ""
      : ` · 对${trace.multiTargetExtraDamageEvents.length}个存活兵种栈分别生成额外伤害`;
    const mark = trace.dreamMarkDamageCoefficient === undefined ? "" :
      ` · 梦之痕合并${trace.dreamMarkSourceCount}来源 → ${trace.dreamMarkDamageCoefficient}B（战报支持，暂定）；这是伤害结算，战报触发次数+0`;
    return `<div class="effect-line"><strong>R${round.round} · ${escapeHtml(trace.skillName)}</strong> · ${escapeHtml(trace.uiSummary)}${developerMode ? ` · skillId=${escapeHtml(trace.skillId)}` : ""}${counter}${target}${proc}${poison}${stun}${shield}${bounty}${torrent}${defense}${vulnerability}${multi}${mark}</div>`;
  }).join("")}</div></details>`;
}

function renderFormula(event: DamageEvent): string {
  const formula = event.baseDamageFormula;
  if (formula === undefined) {
    return auditSection("基础伤害公式拆解", `<p class="hint">该事件由另一伤害事件触发。${developerMode ? "基础值来自 parentEvent/sourceSkill。" : ""}</p>`);
  }
  if (!developerMode) {
    return auditSection("基础伤害公式拆解", kvs({
      固定N0: formula.fixedInitialMinTroops,
      实时存活数: formula.aliveCount,
      兵种伤害系数: formula.damageCoefficient,
      等级常数C: formula.troopConstant,
      基础伤害: formatNumber(event.rawDamage),
    }));
  }
  return auditSection("基础伤害公式拆解", kvs({
    "sqrt(N0)": formatNumber(formula.fixedInitialCountFactor),
    "sqrt(n)": formatNumber(formula.aliveCountFactor),
    damageCoefficient: formula.damageCoefficient,
    troopConstant: formula.troopConstant,
    attackMultiplier: formatNumber(formula.attackMultiplier),
    penetrationMultiplier: formatNumber(formula.penetrationMultiplier),
    rawDamage: formatNumber(event.rawDamage),
  }));
}

function renderEventCorrection(
  value: ValidationBattleResult,
  event: DamageEvent,
): string {
  const sourceCorrection = value.heroStatCorrections[event.sourceSide];
  const targetCorrection = value.heroStatCorrections[event.targetSide];
  const row = (label: string, correction: HeroStatCorrection | undefined, troop: TroopType) =>
    correction === undefined
      ? `<div class="effect-line">${label}：无英雄属性修正</div>`
      : `<div class="effect-line"><strong>${label}.${troopName(troop)}</strong> · 攻击 ${signedPercent(correction.delta[troop].attack)} · 防御 ${signedPercent(correction.delta[troop].defense)} · 穿透 ${signedPercent(correction.delta[troop].penetration)} · 生命 ${signedPercent(correction.delta[troop].life)}${developerMode ? ` · internal=${escapeHtml(JSON.stringify(correction.delta[troop]))}` : ""}</div>`;
  return auditSection("英雄属性修正", row("攻击方", sourceCorrection, event.sourceTroop) + row("防守方", targetCorrection, event.targetTroop));
}

function renderAttributeResolution(resolution: AttributeResolutionTrace): string {
  if (!developerMode) {
    return `<div class="effect-line"><strong>${attributeName(resolution.attribute)}</strong> · 基础 ${formatPercent(resolution.baseAttribute)} · 修正后 ${formatPercent(resolution.finalAttribute)} · ${resolution.reductionGroups.length} 个减益小乘区</div>`;
  }
  return `<div class="effect-line"><strong>${resolution.attribute}</strong> · base=${formatNumber(resolution.baseAttribute)} · modifiers=${resolution.modifierGroups.map((group) => `${group.group}[${group.operation}]: sum=${formatNumber(group.summedValue)}, factor=${formatNumber(group.multiplier)}`).join(" | ") || "none"} · beforeReduction=${formatNumber(resolution.buffedAttribute)} · reductions=${resolution.reductionGroups.map((group) => `${group.group}: sum=${formatNumber(group.summedValue)}, divide=${formatNumber(group.divisionFactor)}`).join(" | ") || "none"} · divisionFactor=${formatNumber(resolution.divisionFactor)} · after=${formatNumber(resolution.finalAttribute)}</div>`;
}

function renderGroups(
  title: string,
  groups: readonly MultiplierGroupResult[],
  effects: DamageEvent["appliedIncreaseEffects"],
): string {
  if (groups.length === 0) return auditSection(title, `<p class="hint">无</p>`);
  return auditSection(title, groups.map((group, index) => {
    const contributors = effects.filter((effect) => effect.group === group.group);
    return `<div class="effect-line"><strong>${developerMode ? group.group : `第 ${index + 1} 乘区`}</strong> · 来源=${contributors.map((effect) => `${developerMode ? effect.effectId : effectKindName(effect.effectKind)}(${formatPercent(effect.effectiveValue)})`).join(" + ") || "引擎计算"} · 组内合计=${formatPercent(group.summedValue)} · 系数=${formatNumber(group.multiplier)}</div>`;
  }).join(""));
}

function renderRoundEnd(round: RoundBattleTrace): string {
  return `<details class="mini-details"><summary>回合末统一结算</summary><div class="table-scroll"><table class="data-table"><thead><tr><th>目标</th><th>待结算伤害</th><th>实际承伤</th><th title="模型中失去战斗能力，不等同于邮件永久损失。">本场退出</th><th>按等级退出（向上取整）</th><th>退出明细差额</th><th>回合末构成</th><th>存活</th><th>有效 C</th><th>前排生命</th><th>溢出</th></tr></thead><tbody>${round.roundEnd.troops.map((troop) => `<tr><td>${troop.side}.${troopName(troop.troop)}</td><td class="metric">${formatNumber(troop.receivedDamage)}</td><td class="metric">${formatNumber(troop.absorbedDamage)}</td><td>${troop.totalDeaths}</td><td>${troop.casualtyAllocationByLevel.map((entry) => `${entry.level}: ${entry.ceilingDeaths}`).join(" / ")}</td><td>${formatNumber(troop.casualtyAllocationRoundingDifference.deaths)}</td><td>${formatLevelComposition(troop.levelCompositionAtRoundEnd)}</td><td>${troop.totalAliveCount}</td><td class="metric">${formatNumber(troop.effectiveTroopConstant)}</td><td class="metric">${formatNumber(troop.frontUnitHp)}</td><td class="metric">${formatNumber(troop.discardedOverflowDamage)}</td></tr>`).join("")}</tbody></table><p class="hint">“本场退出”不等同于游戏邮件中的永久损失。等级退出明细按初始比例向上取整；明细差额不额外扣兵，回合末构成保留守恒人数。</p></div></details>`;
}

function formatLevelComposition(
  composition: readonly ValidationLevelCompositionEntry[],
): string {
  return composition.map((entry) => `${entry.level}: ${entry.aliveCount}`).join(" / ");
}

function renderDebugPreview(value: unknown, downloadable = false): string {
  return `<p class="hint">限量预览：最多 ${DEBUG_PREVIEW.events} 条/层、${DEBUG_PREVIEW.chars} 字符；完整数据请点击${downloadable ? " Copy JSON 或导出 JSON，大数据推荐导出文件" : "复制 JSON"}。</p><pre>${escapeHtml(debugJsonPreview(value))}</pre>`;
}

function renderDeveloperMode(value: ValidationBattleResult): string {
  return `<section class="panel"><header class="panel-head"><h2>开发者模式</h2><label class="check-row"><input type="checkbox" data-scope="developer" ${developerMode ? "checked" : ""}>显示内部 ID、小数与原始 JSON</label></header>${developerMode ? `<div class="panel-body">
    ${renderRoundDamage(value)}
    ${value.comparisons.length === 0 ? "" : renderComparisons(value)}
    ${lazyDetails.render("raw-battle-input", "Raw BattleInput", () => `<div class="inline-fields"><button class="btn btn-small" data-action="copy-battle-input">Copy JSON</button><button class="btn btn-small" data-action="export-battle-input">导出 JSON</button></div>${renderDebugPreview(value.input, true)}`, 'class="mini-details"')}
    ${lazyDetails.render("raw-battle-result", "Raw BattleResult", () => `<div class="inline-fields"><button class="btn btn-small" data-action="copy-result">Copy JSON</button><button class="btn btn-small" data-action="export-battle-result">导出 JSON</button></div>${renderDebugPreview(value.simulation, true)}`, 'class="mini-details"')}
    ${lazyDetails.render("raw-battle-trace", "Raw BattleTrace", () => `<button class="btn btn-small" data-action="copy-trace">Copy JSON</button>${renderDebugPreview(value.trace)}`, 'class="mini-details"')}
  </div>` : ""}</section>`;
}

function auditSection(title: string, body: string): string {
  return `<section class="audit-section"><h5>${title}</h5>${body}</section>`;
}

function kvs(values: Readonly<Record<string, string | number>>): string {
  return `<div class="kv-grid">${Object.entries(values).map(([key, value]) => `<div class="kv"><span>${escapeHtml(key)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join("")}</div>`;
}

function safePreview(): ReturnType<typeof createValidationPreviewState> | null {
  if (pendingRecognitionSides().length > 0 || isThreeQueueBattleInput(input)) return null;
  if (previewCache.has(input)) return previewCache.get(input)!;
  let value: ReturnType<typeof createValidationPreviewState> | null = null;
  try {
    value = timeUiSection("battle input preview", () => createValidationPreviewState(input));
  } catch { /* Incomplete inputs remain editable. */ }
  previewCache.set(input, value);
  return value;
}

function safeExpectedPreview(): ReturnType<typeof previewExpectedReportBonuses> | null {
  if (pendingRecognitionSides().length > 0 || isThreeQueueBattleInput(input)) return null;
  if (expectedCache.has(input)) return expectedCache.get(input)!;
  let value: ReturnType<typeof previewExpectedReportBonuses> | null = null;
  try {
    const state = safePreview();
    if (state !== null) value = timeUiSection("expected attributes preview", () =>
      previewExpectedReportBonuses(input, state));
  } catch { /* Incomplete inputs remain editable. */ }
  expectedCache.set(input, value);
  return value;
}

function previewInitialTroopCount(): number | null {
  try {
    if (input.scenarioType === "INNER_EARTH") {
      const config = getInnerEarthConfig(input);
      const allyCount = getInnerEarthRule(config.subMode).heroMode === "threeQueues" ? config.ally.shared.capacity :
        TROOP_TYPES.reduce((sum, troop) => sum + config.ally.counts[troop], 0);
      return Math.min(allyCount, config.enemy.shared.capacity);
    }
    return Math.min(...[input.sideA, input.sideB].map((side) => {
      if (isThreeQueueBattleInput(input)) return side.deploymentCapacity ??
        TROOP_TYPES.reduce((sum, troop) => sum + side.troops[troop].count, 0);
      const counts = resolveValidationTroopCounts(side, input.battleContext ?? "challenge",
        input.attributeInputMode ?? "finalReport");
      return TROOP_TYPES.reduce((sum, troop) => sum + counts[troop], 0);
    }));
  } catch { return null; }
}

function runBattle(): void {
  try {
    if (pendingRecognitionSides().length > 0)
      throw new Error("请先确认并应用识图预览，再运行战斗。");
    const preparedInput = prepareValidationRunInput(input);
    if (preparedInput.randomSeed !== input.randomSeed) {
      input = preparedInput;
      revisionState = markValidationInputChanged(revisionState);
      batchResult = null;
      optimizationResult = null;
    }
    if (isThreeQueueBattleInput(input)) {
      threeQueueResult = runValidationThreeQueueScenario(input);
      result = null;
    } else {
      result = runValidationBattle(input);
      threeQueueResult = null;
    }
    revisionState = markValidationResultCurrent(revisionState);
    errorMessage = null;
  } catch (error) {
    result = null;
    threeQueueResult = null;
    revisionState = clearValidationResultRevision(revisionState);
    errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  render();
}

async function runBatch(): Promise<void> {
  if (batchRunning) return;
  if (editorMode === "simple" && (["A", "B"] as const).some((side) =>
    simpleTroopModes[side] === "ratio" && simpleRatioDrafts[side] !== null && !validSimpleRatios(simpleRatioDrafts[side]))) return;
  if (pendingRecognitionSides().length > 0) {
    errorMessage = "请先确认并应用识图预览，再运行批量模拟。";
    render();
    return;
  }
  batchRunning = true;
  batchProgress = 0;
  errorMessage = null;
  const revisionAtStart = revisionState.inputRevision;
  const countAtStart = batchCount;
  const inputAtStart = input;
  render();
  try {
    const completed = await runBatchInWorker(inputAtStart, countAtStart, (progress) => {
      batchProgress = progress;
      const button = app.querySelector<HTMLButtonElement>('[data-action="run-batch"]');
      if (button !== null) button.textContent = `批量模拟中… ${progress}/${countAtStart}`;
      const bar = app.querySelector<HTMLProgressElement>(".simple-progress progress");
      if (bar !== null) bar.value = progress;
      const status = app.querySelector<HTMLElement>("[data-simple-progress]");
      if (status !== null) status.textContent = `已完成 ${progress.toLocaleString()} / ${countAtStart.toLocaleString()} 场`;
    });
    batchResult = revisionState.inputRevision === revisionAtStart && batchCount === countAtStart
      ? completed : null;
    errorMessage = null;
  } catch (error) {
    batchResult = null;
    errorMessage = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
  } finally {
    batchRunning = false;
    render();
  }
}

async function runOptimizer(): Promise<void> {
  if (optimizationRunning) return;
  if (pendingRecognitionSides().length > 0) {
    errorMessage = "请先确认并应用识图预览，再开始配队优化。";
    render();
    return;
  }
  optimizationRunning = true;
  optimizationProgress = null;
  optimizationPerformanceReport = null;
  optimizationProgressReceivedAt = performance.now();
  optimizationResult = null;
  simpleOptimizationResult = null;
  threeQueueOptimizationResult = null;
  innerEarthOptimizationResult = null;
  errorMessage = null;
  const revisionAtStart = revisionState.inputRevision;
  const configAtStart = optimizationConfig;
  const simpleOptionsAtStart = simpleOptimizerOptions;
  const threeQueueOptionsAtStart = threeQueueOptimizerOptions;
  const inputAtStart = input;
  const route = optimizerRoute(input.scenarioType);
  const refreshTiming = () => {
    for (const label of app.querySelectorAll<HTMLElement>(".optimizer-progress")) label.textContent = label.closest(".player-optimizer")
      ? playerOptimizationProgress(optimizationProgress, optimizationPerformanceReport, performance.now() - optimizationProgressReceivedAt)
      : optimizerProgressText(optimizationProgress, optimizationPerformanceReport, performance.now() - optimizationProgressReceivedAt);
    const host = app.querySelector<HTMLElement>(".optimizer-performance-host");
    if (host !== null && optimizationPerformanceReport !== null) {
      const body = host.querySelector<HTMLElement>(".optimizer-timing-body");
      if (body === null) host.innerHTML = renderOptimizerPerformance(optimizationPerformanceReport);
      else body.innerHTML = performanceReportBody(optimizationPerformanceReport);
    }
  };
  const timingRefresh = setInterval(refreshTiming, 350);
  if (route === "threeQueue") threeQueueSearchStatus = "running";
  render();
  try {
  if (route === "rally") {
    const candidateSide=configAtStart.candidateSide??"A";
    const policy = jointHeadPolicy(inputAtStart, configAtStart), dimensions = policy.dimensions;
    const settings = resolveJointPipelineOptions(configAtStart.jointPipeline);
    const choices = dimensions.headSearchEnabled ? availableHeadHeroesByTroop(inputAtStart, policy.headConstraints, undefined, candidateSide) : null;
    const headAudit = dimensions.headSearchEnabled ? headFormationGenerationAudit(inputAtStart, policy.headConstraints, undefined, candidateSide) : null;
    const headCandidateCount = headAudit?.recentEligibleHeadCount ?? 1;
    console.info("Rally optimizer search start", {
      ...optimizationContextAudit(createOptimizationContext(inputAtStart,candidateSide)),
      ...headAudit,
      ...dimensions,
      fixedHead: !dimensions.headSearchEnabled,
      availableHeadHeroesByTroop: choices,
      shieldCandidateCount: choices?.shield.length ?? 0, lancerCandidateCount: choices?.lancer.length ?? 0,
      marksmanCandidateCount: choices?.marksman.length ?? 0,
      headCandidateCount, globalTopJLimit: 10000, perHeadProtectedK: settings.perHeadProtectedK,
      legalHeadCandidateCount: headCandidateCount,
      stage1Trials: settings.formalStages[0]!.trials, formalStages: settings.formalStages,
      fixedBody: !dimensions.bodySearchEnabled,
      availableBodyCandidateCount: "reportedByWorkerAfterEnumeration",
      theoryOptions: configAtStart.theory ?? defaultTheoryOptions(),
      recall: "Global Top10000 union PerHead TopK",
      optimizationTargetSide: candidateSide, candidateChangedSide: candidateSide,
    });
  }

    const completed = await new Promise<OptimizationResult | SimpleScenarioOptimizationResult | ThreeQueueOptimizationResult | InnerEarthOptimizationResult>((resolve, reject) => {
      const worker = new Worker(new URL("./optimizerWorker.ts", import.meta.url), { type: "module" });
      if (route === "threeQueue" || route === "innerEarth") {
        cancelOptimizerRun = () => {
          worker.terminate();
          reject(new Error("OPTIMIZER_CANCELLED"));
        };
      }
      worker.onmessage = (event: MessageEvent<
        | { readonly type: "progress"; readonly progress: OptimizationProgress }
        | { readonly type: "complete"; readonly result: OptimizationResult }
        | { readonly type: "complete-simple"; readonly result: SimpleScenarioOptimizationResult }
        | { readonly type: "complete-three-queue"; readonly result: ThreeQueueOptimizationResult }
        | { readonly type: "complete-inner-earth"; readonly result: InnerEarthOptimizationResult }
        | { readonly type: "error"; readonly message: string }
      >) => {
        const message = event.data;
        if (message.type === "progress") {
          optimizationProgress = message.progress;
          optimizationProgressReceivedAt = performance.now();
          if (message.progress.performanceReport) optimizationPerformanceReport = message.progress.performanceReport;
        } else {
          worker.terminate();
          if (message.type === "complete" || message.type === "complete-simple" ||
            message.type === "complete-three-queue" || message.type === "complete-inner-earth") resolve(message.result);
          else reject(new Error(message.message));
        }
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message));
      };
      worker.postMessage(route === "rally"
        ? { task: "optimize", input: inputAtStart, config: configAtStart }
        : route === "innerEarth"
          ? { task: "optimizeInnerEarth", input: inputAtStart,
            options: { simple: simpleOptionsAtStart, threeQueue: threeQueueOptionsAtStart } }
        : route === "threeQueue"
          ? { task: "optimizeThreeQueue", input: inputAtStart,
            options: threeQueueOptionsAtStart }
          : { task: "optimizeSimple", input: inputAtStart,
            options: simpleOptionsAtStart });
    });
    optimizationPerformanceReport = ("kind" in completed ? completed.result : completed).searchPerformanceReport ?? optimizationPerformanceReport;
    if (revisionState.inputRevision !== revisionAtStart ||
      (route === "rally" ? optimizationConfig !== configAtStart :
        route === "innerEarth" ? threeQueueOptimizerOptions !== threeQueueOptionsAtStart || simpleOptimizerOptions !== simpleOptionsAtStart :
        route === "threeQueue" ? threeQueueOptimizerOptions !== threeQueueOptionsAtStart :
          simpleOptimizerOptions !== simpleOptionsAtStart)) {
      storageNotice = "搜索期间配置已更改，结果已作废；请重新搜索。";
    } else if ("kind" in completed) {
      innerEarthOptimizationResult = completed;
      innerEarthResultRevision = revisionAtStart;
    } else if ("singleWaveTop" in completed) {
      optimizationResult = completed;
    } else if (completed.scenarioType === "THREE_QUEUE") {
      threeQueueOptimizationResult = completed;
      threeQueueResultRevision = revisionAtStart;
    } else {
      simpleOptimizationResult = completed;
      simpleResultRevision = revisionAtStart;
    }
  } catch (error) {
    if (optimizationPerformanceReport !== null) optimizationPerformanceReport = stopPerformanceReport(
      optimizationPerformanceReport, error instanceof Error && error.message === "OPTIMIZER_CANCELLED" ? "cancelled" : "error",
      optimizationPerformanceReport.totalElapsedMs + performance.now() - optimizationProgressReceivedAt);
    if (error instanceof Error && error.message === "OPTIMIZER_CANCELLED") {
      storageNotice = `${battleSceneLabel(inputAtStart)}搜索已取消。`;
      threeQueueSearchStatus = "cancelled";
    } else {
      errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
  } finally {
    clearInterval(timingRefresh);
    cancelOptimizerRun = null;
    optimizationRunning = false;
    if (route === "threeQueue" && threeQueueSearchStatus === "running") {
      threeQueueSearchStatus = "idle";
    }
    render();
    if (optimizationResult !== null || simpleOptimizationResult !== null ||
      threeQueueOptimizationResult !== null || innerEarthOptimizationResult !== null) {
      app.querySelector(".optimizer-results")?.scrollIntoView({
        behavior: "smooth", block: "start" });
    }
  }
}

async function verifyOptimizerCandidate(target: HTMLElement): Promise<void> {
  if (verificationRunning || optimizationResult === null) return;
  const index = Number(target.dataset.index);
  const original = optimizationResult.singleWaveTop[index];
  if (original === undefined) return;
  verificationRunning = true;
  const revisionAtStart = revisionState.inputRevision;
  const resultAtStart = optimizationResult;
  render();
  try {
    const evaluation = await new Promise<CandidateEvaluation>((resolve, reject) => {
      const worker = new Worker(new URL("./optimizerWorker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<
        | { readonly type: "verified"; readonly evaluation: CandidateEvaluation }
        | { readonly type: "error"; readonly message: string }
      >) => {
        worker.terminate();
        if (event.data.type === "verified") resolve(event.data.evaluation);
        else reject(new Error(event.data.message));
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message));
      };
      worker.postMessage({ task: "verify", input,
        candidateSide: resultAtStart.optimizationContext?.candidateSide ?? resultAtStart.searchDiagnostics?.optimizationTargetSide ?? "A",
        candidate: original.candidate, trials: 10_000, firstSeed: optimizationConfig.firstSeed });
    });
    if (revisionState.inputRevision === revisionAtStart && optimizationResult === resultAtStart) {
      const updated = [...resultAtStart.singleWaveTop];
      updated[index] = evaluation;
      optimizationResult = { ...resultAtStart, singleWaveTop: updated };
    }
  } catch (error) {
    errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  } finally {
    verificationRunning = false;
    render();
  }
}

/** Manual percent fields accept hundredths without native number-input stepping. */
function readManualPercent(target: HTMLInputElement, allowNegative = false): number {
  const raw = target.value.trim();
  const pattern = allowNegative ? /^-?\d+(?:\.\d{0,2})?$/ : /^\d+(?:\.\d{0,2})?$/;
  const value = Number(raw);
  if (!pattern.test(raw) || !Number.isFinite(value)) {
    throw new RangeError("百分比请输入最多两位小数的数字。");
  }
  return value;
}

function updateOptimizerField(target: HTMLInputElement | HTMLSelectElement): void {
  const field = target.dataset.field;
  if (field === undefined) return;
  const current = optimizationConfig;
  const candidateSide=current.candidateSide??"A", own=candidateSide==="A"?input.sideA:input.sideB;
  if (field === "candidateSide") {
    const nextSide=requireSide(target.value);
    optimizationConfig=updateRallyOptimizationSide(input,current,nextSide);
    heroPoolSide=nextSide;
  } else if (field === "objectiveMode") {
    optimizationConfig = { ...current, objectiveMode: target.value as OptimizationConfig["objectiveMode"] };
  } else if (field === "fixedLeaders") {
    const checked = (target as HTMLInputElement).checked;
    const rest = { ...current.constraints };
    delete rest.fixedLeaders;
    optimizationConfig = { ...current, constraints: checked ? { ...rest, fixedLeaders: Object.fromEntries(TROOP_TYPES.map((troop) => [troop, own.leaderHeroIds?.[troop] ?? null])) } : rest };
  } else if (field === "fixedMemberSkillIds") {
    const checked = (target as HTMLInputElement).checked;
    const rest = { ...current.constraints };
    delete rest.fixedMemberSkillIds;
    delete rest.fixedBodyExact;
    optimizationConfig = { ...current, constraints: checked ? { ...rest,
      fixedMemberSkillIds: own.bodySkills?.map((body)=>body.skillId)??own.selectedMemberSkillIds,
      fixedBodyExact: true } : rest };
  } else {
    const value = field === "targetDefeatProbability" || field === "singleFightThresholdLow"
      ? readManualPercent(target as HTMLInputElement) : Number(target.value);
    if (!Number.isFinite(value)) throw new RangeError("优化参数必须是有限数字。");
    if ((field === "targetDefeatProbability" || field === "singleFightThresholdLow") &&
      value > 100) throw new RangeError("优化概率必须在 0% 至 100% 之间。");
    if (field === "targetDefeatProbability") optimizationConfig = { ...current, targetDefeatProbability: value / 100 };
    else if (field === "singleFightThresholdLow") optimizationConfig = { ...current, singleFightThresholdLow: value / 100 };
    else if (field === "maxWaves") optimizationConfig = { ...current, maxWaves: value };
    else if (field === "beamTrials") optimizationConfig = { ...current, beamTrials: value };
    else if (field === "beamWidth") optimizationConfig = { ...current, beamWidth: value };
    else if (field === "verificationTrials") optimizationConfig = { ...current, verificationTrials: Math.max(1000, value) };
    else if (field === "firstSeed") optimizationConfig = { ...current, firstSeed: value };
    else if (field === "verificationTop") optimizationConfig = { ...current, verificationTop: value };
    else if (field.startsWith("joint-formal-keep-")) optimizationConfig = { ...current, jointPipeline: { ...current.jointPipeline,
      formalStages: resolveJointPipelineOptions(current.jointPipeline).formalStages.map((s, i) => i === Number(field.slice("joint-formal-keep-".length)) ? { ...s, keep: value } : s) } };
    else if (field.startsWith("joint-")) optimizationConfig = { ...current, jointPipeline: { ...current.jointPipeline, [field.slice(6)]: value } };
  }
  optimizationResult = null;
}

function updateSimpleOptimizerField(target: HTMLInputElement | HTMLSelectElement): void {
  const field = target.dataset.field;
  if (field === "side") {
    simpleOptimizerOptions = { ...simpleOptimizerOptions,
      side: target.value === "B" ? "B" : "A" };
    heroPoolSide=simpleOptimizerOptions.side;
  } else if (field === "fixedHeroes" || field === "fixedRatio") {
    simpleOptimizerOptions = { ...simpleOptimizerOptions,
      [field]: (target as HTMLInputElement).checked };
  } else if (field === "coarseTrials" || field === "middleTrials" ||
    field === "initialBattleTrials" || field === "intermediateTrials" ||
    field === "verificationTrials" || field === "topN" || field === "seed") {
    const value = Number(target.value);
    if (!Number.isSafeInteger(value) || (field !== "seed" &&
      (value < 1 || value > (field === "topN" ? 10 : 100_000)))) {
      throw new RangeError("优化参数必须是允许范围内的整数。");
    }
    simpleOptimizerOptions = { ...simpleOptimizerOptions, [field]: value };
  }
  simpleOptimizationResult = null;
  innerEarthOptimizationResult = null;
}

function updateThreeQueueOptimizerField(target: HTMLInputElement | HTMLSelectElement): void {
  const field = target.dataset.field;
  if (field === "side") {
    threeQueueOptimizerOptions = { ...threeQueueOptimizerOptions,
      side: target.value === "B" ? "B" : "A" };
  } else if (field === "enemyPermutationMode") {
    if (!["fixedCurrent", "allPermutations", "worstCase"].includes(target.value)) throw new Error("敌方变阵模式无效。");
    threeQueueOptimizerOptions = { ...threeQueueOptimizerOptions, enemyPermutationMode: target.value as ThreeQueueOptimizationOptions["enemyPermutationMode"] & string };
  } else if (field === "fixedOwnQueueOrder") {
    threeQueueOptimizerOptions = { ...threeQueueOptimizerOptions, fixedOwnQueueOrder: (target as HTMLInputElement).checked };
  } else if (field === "lockHeroes" || field === "lockRatios") {
    const index = Number(target.dataset.queueIndex);
    if (!Number.isInteger(index) || index < 0 || index > 2) {
      throw new RangeError("队列序号无效。");
    }
    const locks = [...threeQueueOptimizerOptions[field]] as [boolean, boolean, boolean];
    locks[index] = (target as HTMLInputElement).checked;
    threeQueueOptimizerOptions = { ...threeQueueOptimizerOptions, [field]: locks };
  } else if (field !== undefined && field in defaultThreeQueueOptimizationOptions(input.randomSeed)) {
    const value = Number(target.value);
    const min = field === "rootSeed" ? Number.MIN_SAFE_INTEGER : 1;
    const max = field === "criterionCandidatesPerQueue" ? 300 : field === "criterionSchedulerTrials" ? 1000 :
      ["criterionPairLimit", "criterionTripleLimit", "criterionTheoryLimit"].includes(field) ? 10000 :
      field === "beamWidth" ? 50 : field === "beamRounds" ? 20 :
      field === "expansionsPerState" ? 100 : field === "finalCandidateCount" ? 20 :
        field === "initialCandidateCount" || field === "refinementCandidateCount" ? 500 :
          field === "rootSeed" ? Number.MAX_SAFE_INTEGER : 100_000;
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new RangeError(`${field} 必须是 ${min}～${max} 的整数。`);
    }
    threeQueueOptimizerOptions = { ...threeQueueOptimizerOptions, [field]: value };
  }
  threeQueueOptimizationResult = null;
  innerEarthOptimizationResult = null;
}

function applyOptimizedInput(next: typeof input, message: string): void {
  const cleaned = next.scenarioType === "INNER_EARTH" ? normalizeInnerEarthInput(next) :
    sanitizeConfigForStage(next, validationStageId(next)).input;
  if (cleaned.scenarioType === "INNER_EARTH") assertInnerEarthInput(cleaned);
  else if (isThreeQueueBattleInput(cleaned)) toValidationThreeQueueConfig(cleaned);
  else createValidationPreviewState(cleaned);
  input = cleaned;
  revisionState = markValidationInputChanged(revisionState);
  result = null;
  threeQueueResult = null;
  batchResult = null;
  optimizationResult = null;
  simpleOptimizationResult = null;
  threeQueueOptimizationResult = null;
  innerEarthOptimizationResult = null;
  errorMessage = null;
  storageNotice = message;
  render();
}

function applyThreeQueueOptimizationCandidate(index: number): void {
  try {
    const evaluation = threeQueueOptimizationResult?.topCandidates[index];
    if (evaluation === undefined || evaluation.validTrials === 0 ||
      threeQueueResultRevision !== revisionState.inputRevision) {
      throw new Error("推荐方案已过期或验证失败，请重新搜索。");
    }
    if (evaluation.isCurrent) { storageNotice = "当前方案已经是本轮最优候选。"; render(); return; }
    applyOptimizedInput(applyThreeQueueCandidate(input,
      threeQueueOptimizationResult!.side, evaluation.candidate), "已应用三队列推荐方案。");
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    render();
  }
}

function applySimpleOptimizationCandidate(index: number): void {
  try {
    const evaluation = simpleOptimizationResult?.topCandidates[index];
    if (evaluation === undefined || simpleResultRevision !== revisionState.inputRevision) {
      throw new Error("推荐方案已过期，请重新搜索。");
    }
    if (evaluation.isCurrent) { storageNotice = "当前方案已经是本轮最优候选。"; render(); return; }
    applyOptimizedInput(applySimpleScenarioCandidate(input,
      simpleOptimizationResult!.side, evaluation.candidate), "已应用推荐方案。");
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    render();
  }
}

function applyRallyCandidate(candidate: OptimizationResult["singleWaveTop"][number]["candidate"],
  message: string): void {
  try {
    const candidateSide=optimizationResult?.optimizationContext?.candidateSide??optimizationResult?.searchDiagnostics?.optimizationTargetSide??optimizationConfig.candidateSide??"A";
    applyOptimizedInput(candidateToInput(input, candidate,candidateSide), message);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    render();
  }
}

function applyRallyOptimizationCandidate(index: number): void {
  const candidate = optimizationResult?.singleWaveTop[index]?.candidate;
  if (candidate !== undefined) applyRallyCandidate(candidate, "已应用推荐方案。");
}

function applyRallyOptimizationWave(index: number): void {
  const candidate = optimizationResult?.multiWaveTop[index]?.sequence[0];
  if (candidate !== undefined) {
    applyRallyCandidate(candidate, "已应用推荐路径的第 1 波方案。");
  }
}

function runBatchInWorker(
  battleInput: typeof input,
  count: number,
  onProgress: (completed: number) => void,
): Promise<BatchSimulationResult | ThreeQueueBatchResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./batchWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<
      | { readonly type: "progress"; readonly completed: number }
      | { readonly type: "complete"; readonly result: BatchSimulationResult | ThreeQueueBatchResult }
      | { readonly type: "error"; readonly message: string }
    >) => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress(message.completed);
      } else {
        worker.terminate();
        if (message.type === "complete") resolve(message.result);
        else reject(new Error(message.message));
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({ input: battleInput, count });
  });
}

function updateBatchCount(target: HTMLInputElement): void {
  const value = Number(target.value);
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_BATCH_SIMULATION_COUNT ||
    value > MAX_BATCH_SIMULATION_COUNT
  ) {
    throw new RangeError(
      `模拟场次必须是 ${MIN_BATCH_SIMULATION_COUNT} 到 ${MAX_BATCH_SIMULATION_COUNT} 的整数。`,
    );
  }
  batchCount = value;
  batchResult = null;
}

function updateSimpleTroops(target: HTMLInputElement | HTMLSelectElement): void {
  if (batchRunning) return;
  const side = requireSide(target.dataset.side), value = target.value.trim() === "" ? NaN : Number(target.value);
  if (target.dataset.scope === "simple-ratio") {
    const troop = requireTroop(target.dataset.troop);
    const ratios = { ...(simpleRatioDrafts[side] ?? simpleTroopRatios(input, side)), [troop]: value };
    simpleRatioDrafts[side] = ratios;
    // Incomplete percentages are UI drafts and never become a second battle configuration.
    if (validSimpleRatios(ratios)) input = setSimpleRatios(input, side, simpleTroopTotal(input, side), ratios);
  } else if (target.dataset.scope === "simple-total") {
    const ratios = simpleRatioDrafts[side] ?? simpleTroopRatios(input, side);
    input = setSimpleRatios(input, side, value, ratios);
  } else {
    const troop = requireTroop(target.dataset.troop), current = getInputSide(side);
    const counts = Object.fromEntries(TROOP_TYPES.map((type) => [type, type === troop ? value : current.troops[type].count])) as Record<TroopType, number>;
    input = setSimpleCounts(input, side, counts); simpleRatioDrafts[side] = null;
  }
}

function renderSimpleMoreBuffs(sideId: SideId, side: ValidationSideInput): string {
  const prediction = input.attributeInputMode === "prediction";
  return `${prediction ? `<h4>历史战报与当前增益</h4>${renderBonusContexts(sideId, side)}<div class="hero-slot-grid">${TROOP_TYPES.map((troop) => renderHeroSelect("report-hero", sideId, side, troop)).join("")}</div>` : '<p class="hint">最终战报属性已包含外部增益与专武静态属性。</p>'}
    <h4>英雄专武</h4>${TROOP_TYPES.map((troop) => {
      const id = side.leaderHeroIds?.[troop]; return id ? renderWeaponLevelInput("simulation-weapon", sideId, id, `${catalog.leaderHeroes.find((hero) => hero.heroId === id)?.name ?? "英雄"}专武`, side.simulationWeaponLevels?.[id] ?? 0) : "";
    }).join("") || '<p class="hint">选择英雄后可设置专武。</p>'}
    <h4>车身英雄</h4>${input.battleContext === "rally" ? `<div class="member-grid">${Array.from({ length: 4 }, (_, index) => renderMemberSelect(sideId, side, index)).join("")}</div>` : '<p class="hint">车身英雄仅在集结场景中生效。</p>'}
    <button class="simple-text-button" data-action="editor-mode" data-mode="advanced">其他配置，在高级模式中查看 →</button>`;
}

function renderSimpleResultDrawer(): string {
  // Reuse the presentation renderer with the same result reference; no rerun on open.
  return renderSimpleDetailsOnly(batchResult);
}

function updateRallyField(target: HTMLInputElement): void {
  const sideId = requireSide(target.dataset.side);
  const field = target.dataset.field;
  if (field === undefined) throw new Error("Missing rally field.");
  const value = field === "totalTroops" ? Number(target.value) : readManualPercent(target);
  if (field === "totalTroops" ? !Number.isSafeInteger(value) || value < 0 : value > 100) {
    throw new RangeError("集结兵数或比例超出允许范围。");
  }
  const side = getInputSide(sideId);
  const deployment = side.rallyDeployment ?? {
    totalTroops: TROOP_TYPES.reduce((sum, troop) => sum + side.troops[troop].count, 0),
    ratios: { shield: 34, lancer: 33, marksman: 33 },
  };
  setInputSide(sideId, {
    ...side,
    rallyDeployment: field === "totalTroops"
      ? { ...deployment, totalTroops: value }
      : {
          ...deployment,
          ratios: { ...deployment.ratios, [requireTroop(field)]: value },
        },
  });
}

function updateExternalBuff(target: HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side);
  const section = target.dataset.section;
  const field = target.dataset.field;
  if (field === undefined || (section !== "town" && section !== "pet" && section !== "expert")) {
    throw new Error("Invalid external buff field.");
  }
  const side = getInputSide(sideId);
  const external = side.externalBuffs ?? DEFAULT_EXTERNAL_BUFF_CONFIG;
  if (section === "town") {
    setInputSide(sideId, {
      ...side,
      externalBuffs: {
        ...external,
        town: { ...external.town, [field]: target.value },
      },
    });
    return;
  }
  const level = Number(target.value);
  setInputSide(sideId, {
    ...side,
    externalBuffs: {
      ...external,
      [section]: { ...external[section], [field]: level },
    },
  });
}

function updateCapacity(target: HTMLInputElement): void {
  const sideId = requireSide(target.dataset.side);
  const field = target.dataset.field;
  if (field === "rallyFixedCapacityBonus" || field === "petMarchCapacityLevel") {
    const value = Number(target.value);
    if (!Number.isSafeInteger(value) || value < 0 ||
      (field === "petMarchCapacityLevel" && value > 10)) {
      throw new RangeError("容量增益必须是有效的非负整数。");
    }
    setInputSide(sideId, { ...getInputSide(sideId), [field]: value });
    return;
  }
  if (field !== "marchCapacityBonus" && field !== "rallyCapacityBonus") {
    throw new Error("Invalid capacity field.");
  }
  const bonus = readManualPercent(target) / 100;
  if (!Number.isFinite(bonus) || bonus < 0) throw new RangeError("Capacity bonus must be non-negative.");
  setInputSide(sideId, { ...getInputSide(sideId), [field]: bonus });
}

function updateDeploymentCapacity(target: HTMLInputElement): void {
  const sideId = requireSide(target.dataset.side);
  const capacity = Number(target.value);
  if (!Number.isSafeInteger(capacity) || capacity < 0) {
    throw new RangeError("出征容量必须是非负整数。");
  }
  setInputSide(sideId, { ...getInputSide(sideId), deploymentCapacity: capacity });
}

function updateAvailableLevel(target: HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side);
  if (!isTroopLevelAvailableAtStage(target.value, validationStageId(input))) {
    throw new RangeError("兵种等级超过当前服务器阶段。");
  }
  setInputSide(sideId, { ...getInputSide(sideId), availableTroopLevels: [target.value] });
}

function updateThreeQueueLevel(target: HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side);
  const troop = requireTroop(target.dataset.troop);
  if (!isTroopLevelAvailableAtStage(target.value, validationStageId(input))) {
    throw new RangeError("兵种等级超过当前服务器阶段。");
  }
  const side = getInputSide(sideId);
  const legacy = side.availableTroopLevels === undefined ? null
    : highestConfiguredTroopLevel(side.availableTroopLevels);
  const current = side.highestTroopLevels ?? Object.fromEntries(TROOP_TYPES.map(
    (type) => [type, legacy ?? side.troops[type].troopLevel])) as Record<TroopType, string>;
  setInputSide(sideId, { ...side,
    highestTroopLevels: { ...current, [troop]: target.value } });
}

function updateQueueRatio(target: HTMLInputElement): void {
  const sideId = requireSide(target.dataset.side);
  const troop = requireTroop(target.dataset.troop);
  const index = Number(target.dataset.queueIndex);
  const value = readManualPercent(target);
  if (!Number.isInteger(index) || index < 0 || index > 2 ||
    !Number.isFinite(value) || value < 0 || value > 100 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 1e-8) {
    throw new RangeError("队列比例须为 0.00% 到 100.00%，步长 0.01%。");
  }
  const side = getInputSide(sideId);
  const queues = [...getValidationThreeQueues(side)] as [ValidationQueueConfig, ValidationQueueConfig, ValidationQueueConfig];
  const queue = queues[index]!;
  queues[index] = { ...queue, ratios: { ...queue.ratios, [troop]: value } };
  setInputSide(sideId, { ...side, threeQueues: queues });
}

function updateQueueHero(target: HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side);
  const troop = requireTroop(target.dataset.troop);
  const index = Number(target.dataset.queueIndex);
  if (!Number.isInteger(index) || index < 0 || index > 2) throw new RangeError("无效队列编号。");
  const heroId = target.value || null;
  if (heroId !== null && !catalog.leaderHeroes.some((hero) =>
    hero.heroId === heroId && hero.troopType === troop &&
    isHeroAvailableAtStage(hero, validationStageId(input)))) {
    throw new RangeError("英雄与兵种不匹配。");
  }
  const side = getInputSide(sideId);
  const queues = [...getValidationThreeQueues(side)] as [ValidationQueueConfig, ValidationQueueConfig, ValidationQueueConfig];
  const queue = queues[index]!;
  queues[index] = isIceFireInput(input) ? (target.dataset.scope === "queue-report-hero" ? changeIceFireReportHero : changeIceFireExpectedHero)(queue, troop, heroId) : changeQueueHero(queue, troop, heroId);
  setInputSide(sideId, { ...side, threeQueues: queues });
}

function updateIceFireSharedField(target: HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side), side = getInputSide(sideId), shared = iceFireSharedContext(side);
  const group = target.dataset.group, field = target.dataset.field, value = Number(target.value);
  if (!isIceFireInput(input) || (group !== "petContext" && group !== "expertContext") ||
    !field || !(field in shared[group]) || !Number.isInteger(value) || value < 0 || value > 20)
    throw new Error("冰火共享配置无效。");
  setInputSide(sideId, { ...side, shared: { ...shared, [group]: { ...shared[group], [field]: value } } });
  input = normalizeIceFireShared(input);
  // Resolve the ordinary validated external context before accepting the edit.
  toValidationThreeQueueConfig(input);
}

function updateIceFireQueueSetting(target: HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side), side = getInputSide(sideId), index = Number(target.dataset.queueIndex);
  const value = Number(target.value), scope = target.dataset.scope;
  if (!isIceFireInput(input) || !Number.isInteger(index) || index < 0 || index > 2 ||
    !Number.isInteger(value) || value < 0 || value > (scope === "queue-t12" ? maxT12SkillLevel(input) : 10)) throw new Error("队列设置无效。");
  const queues = [...getValidationThreeQueues(side)] as [ValidationQueueConfig, ValidationQueueConfig, ValidationQueueConfig];
  const queue = queues[index]!;
  if (scope === "queue-t12") {
    const troop = requireTroop(target.dataset.troop);
    queues[index] = { ...queue, t12Levels: { shield: side.troops.shield.t12Level ?? 0,
      lancer: side.troops.lancer.t12Level ?? 0, marksman: side.troops.marksman.t12Level ?? 0,
      ...queue.t12Levels, [troop]: value } };
  } else {
    const id = target.dataset.heroId;
    const baseline = captureQueueReportBaseline(queue);
    const heroes = scope === "queue-report-weapon" ? baseline.reportHeroByTroop : queue.leaderHeroIds;
    if (!id || !Object.values(heroes ?? {}).includes(id)) throw new Error("专武必须属于对应英雄。");
    const field = scope === "queue-report-weapon" ? "reportWeaponLevels" : "weaponLevels";
    queues[index] = { ...baseline, reportLineage: { ...baseline.reportLineage!, source: "historicalReport" },
      [field]: { ...baseline[field], [id]: value } };
  }
  setInputSide(sideId, { ...side, threeQueues: queues });
}

function updateQueueAttribute(target: HTMLInputElement): void {
  const sideId = requireSide(target.dataset.side);
  const troop = requireTroop(target.dataset.troop);
  const index = Number(target.dataset.queueIndex);
  const field = target.dataset.field;
  const value = readManualPercent(target, true);
  if (!Number.isInteger(index) || index < 0 || index > 2 ||
    !["attack", "defense", "penetration", "life"].includes(field ?? "") ||
    !Number.isFinite(value)) throw new RangeError("队列战报属性无效。");
  const side = getInputSide(sideId);
  const queues = [...getValidationThreeQueues(side)] as
    [ValidationQueueConfig, ValidationQueueConfig, ValidationQueueConfig];
  const queue = queues[index]!;
  const history = Object.fromEntries(["sourceReportBonuses", "sourceReportAttributes", "historicalBonusMigration"].flatMap((key) => {
    const value = queue[key as keyof ValidationQueueConfig]; return value === undefined ? [] : [[key, value]];
  }));
  const changed = changeQueueAttribute({ ...queue, reportAttributeBasis: "raw" }, troop, field as typeof reportAttributes[number], value);
  queues[index] = isIceFireInput(input) && queue.reportLineage && queue.reportHeroByTroop
    ? { ...queue, attributes: changed.attributes!, attributeSource: "manualInput", reportAttributeBasis: "raw",
      reportLineage: { ...queue.reportLineage, historicalLineageConfirmed: true, attributeSnapshot: structuredClone(changed.attributes!) }, ...history }
    : { ...changed, ...history };
  setInputSide(sideId, { ...side, threeQueues: queues });
}

function updateQueueLevel(target: HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side);
  const troop = requireTroop(target.dataset.troop);
  const index = Number(target.dataset.queueIndex);
  if (!Number.isInteger(index) || index < 0 || index > 2 ||
    !isTroopLevelAvailableAtStage(target.value, validationStageId(input))) {
    throw new RangeError("队列兵种等级超过当前服务器阶段。");
  }
  const side = getInputSide(sideId);
  const queues = [...getValidationThreeQueues(side)] as
    [ValidationQueueConfig, ValidationQueueConfig, ValidationQueueConfig];
  const queue = queues[index]!;
  const { [troop]: _oldComposition, ...remainingCompositions } = queue.troopLevelCompositions ?? {};
  void _oldComposition;
  queues[index] = { ...queue,
    troopLevels: { ...queue.troopLevels!, [troop]: target.value },
    troopLevelCompositions: remainingCompositions,
    troopResolutionSources: { ...queue.troopResolutionSources, [troop]: "userOverride" } };
  setInputSide(sideId, { ...side, threeQueues: queues });
}

function updateQueueImportedComposition(target: HTMLInputElement | HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side), troop = requireTroop(target.dataset.troop);
  const queueIndex = Number(target.dataset.queueIndex), partIndex = Number(target.dataset.index);
  const side = getInputSide(sideId);
  const queues = [...getValidationThreeQueues(side)] as [ValidationQueueConfig, ValidationQueueConfig, ValidationQueueConfig];
  const queue = queues[queueIndex];
  const parts = queue?.troopLevelCompositions?.[troop];
  if (queue === undefined || parts?.[partIndex] === undefined || parts.length !== 2)
    throw new Error("导入混兵配置无效。");
  let updated: readonly ValidationLevelCompositionEntry[];
  if (target.dataset.scope === "queue-mixed-level") {
    if (!isTroopLevelAvailableAtStage(target.value, validationStageId(input)))
      throw new Error("混兵等级超过当前服务器阶段。");
    updated = parts.map((part, index) => index === partIndex ? { ...part, level: target.value } : part);
    if (new Set(updated.map((part) => part.level)).size !== updated.length)
      throw new Error("混兵等级不能重复；改为单等级可使用上方兵种等级选择。");
  } else {
    const ratio = readManualPercent(target as HTMLInputElement);
    if (ratio < 0 || ratio > 100) throw new Error("混兵比例须为 0–100%。");
    const amount = Math.round(ratio * 100);
    updated = parts.map((part, index) => ({ ...part, aliveCount: index === partIndex ? amount : 10_000 - amount }));
  }
  queues[queueIndex] = { ...queue, troopLevelCompositions: { ...queue.troopLevelCompositions, [troop]: updated },
    troopLevels: { ...queue.troopLevels!, [troop]: updated[0]!.level },
    troopResolutionSources: { ...queue.troopResolutionSources, [troop]: "userOverride" } };
  setInputSide(sideId, { ...side, threeQueues: queues });
}

function updateQueueExternalBuff(target: HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side);
  const index = Number(target.dataset.queueIndex);
  const section = target.dataset.section;
  const field = target.dataset.field;
  if (!Number.isInteger(index) || index < 0 || index > 2 ||
    !field || (section !== "town" && section !== "pet" && section !== "expert")) {
    throw new RangeError("三队列外部增减益输入无效。");
  }
  const side = getInputSide(sideId);
  const queues = [...getValidationThreeQueues(side)] as
    [ValidationQueueConfig, ValidationQueueConfig, ValidationQueueConfig];
  const queue = queues[index]!;
  const external = queue.externalBuffs ?? DEFAULT_EXTERNAL_BUFF_CONFIG;
  const value = section === "town" ? target.value : Number(target.value);
  if (section !== "town" && (!Number.isSafeInteger(value) || Number(value) < 0)) {
    throw new RangeError("外部增减益等级无效。");
  }
  queues[index] = { ...queue, externalBuffs: { ...external,
    [section]: { ...external[section], [field]: value } } };
  setInputSide(sideId, { ...side, threeQueues: queues });
}

function updateQueueHeroSkillLevel(target: HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side);
  const index = Number(target.dataset.queueIndex);
  const skillId = target.dataset.skillId;
  const level = Number(target.value);
  const side = getInputSide(sideId);
  const queues = [...getValidationThreeQueues(side)] as
    [ValidationQueueConfig, ValidationQueueConfig, ValidationQueueConfig];
  const queue = queues[index];
  const definition = CONFIRMED_HERO_SKILL_DEFINITIONS.find((skill) => skill.id === skillId);
  if (queue === undefined || definition === undefined ||
    !Object.values(queue.leaderHeroIds).includes(definition.heroId) ||
    definition.positionRule.kind !== "expeditionSkillSlot" ||
    definition.levelValues[level] === undefined) {
    throw new RangeError("本队英雄技能等级无效。");
  }
  queues[index] = { ...queue,
    heroSkillLevels: { ...queue.heroSkillLevels, [skillId!]: level } };
  setInputSide(sideId, { ...side, threeQueues: queues });
}

function updateTroopField(target: HTMLInputElement | HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side);
  const troop = requireTroop(target.dataset.troop);
  const field = target.dataset.field as keyof ValidationTroopInput | undefined;
  if (field === undefined) throw new Error("Missing troop field.");
  const currentSide = getInputSide(sideId);
  const currentTroop = currentSide.troops[troop];
  if (["attack", "defense", "penetration", "life"].includes(field)) {
    target.value = target.value.trim().replace(/^\+/, "").replace(/[%％]$/, "").trim();
  }
  const nextValue = field === "troopLevel" ? target.value :
    ["attack", "defense", "penetration", "life"].includes(field)
      ? readManualPercent(target as HTMLInputElement, true) : Number(target.value);
  if (field === "troopLevel" &&
    !isTroopLevelAvailableAtStage(target.value, validationStageId(input))) {
    throw new RangeError("兵种等级超过当前服务器阶段。");
  }
  const nextTroop = { ...currentTroop, [field]: nextValue } as ValidationTroopInput;
  setInputSide(sideId, {
    ...currentSide,
    troops: { ...currentSide.troops, [troop]: field === "troopLevel" || field === "count" ?
      { ...nextTroop, resolutionSource: "userOverride" } : nextTroop },
  });
}

function updateTroopLevelMode(target: HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side);
  const troop = requireTroop(target.dataset.troop);
  const currentSide = getInputSide(sideId);
  const current = currentSide.troops[troop];
  if (target.value === "mixed") {
    setTroopInput(sideId, troop, {
      ...current,
      levelMode: "mixed",
      levelComposition: [{
        level: current.troopLevel,
        aliveCount: current.count,
      }],
    });
    return;
  }
  const composition = getUiComposition(current);
  setTroopInput(sideId, troop, {
    ...current,
    levelMode: "single",
    troopLevel: composition[0]?.level ?? current.troopLevel,
    count: composition.reduce((sum, entry) => sum + entry.aliveCount, 0),
  });
}

function updateMixedLevel(target: HTMLSelectElement): void {
  if (!isTroopLevelAvailableAtStage(target.value, validationStageId(input))) {
    throw new RangeError("兵种等级超过当前服务器阶段。");
  }
  updateMixedCompositionEntry(target, (entry) => ({
    ...entry,
    level: target.value,
  }));
}

function updateMixedCount(target: HTMLInputElement): void {
  const aliveCount = Number(target.value);
  if (!Number.isSafeInteger(aliveCount) || aliveCount < 0) {
    throw new RangeError("混等级兵数必须是非负整数。");
  }
  updateMixedCompositionEntry(target, (entry) => ({ ...entry, aliveCount }));
}

function updateMixedCompositionEntry(
  target: HTMLInputElement | HTMLSelectElement,
  update: (
    entry: ValidationLevelCompositionEntry,
  ) => ValidationLevelCompositionEntry,
): void {
  const sideId = requireSide(target.dataset.side);
  const troop = requireTroop(target.dataset.troop);
  const index = requireCompositionIndex(target.dataset.index);
  const current = getInputSide(sideId).troops[troop];
  const composition = getUiComposition(current).map((entry, entryIndex) =>
    entryIndex === index ? update(entry) : entry
  );
  if (new Set(composition.map((entry) => entry.level)).size !== composition.length) {
    throw new Error("同一兵种内不能重复添加同一个等级。");
  }
  setTroopInput(sideId, troop, withComposition(current, composition));
}

function addMixedLevel(target: HTMLElement): void {
  const sideId = requireSide(target.dataset.side);
  const troop = requireTroop(target.dataset.troop);
  const current = getInputSide(sideId).troops[troop];
  const composition = getUiComposition(current);
  const used = new Set(composition.map((entry) => entry.level));
  const nextLevel = getAvailableTroopLevels(validationStageId(input), troop)
    .find((level) => !used.has(level));
  if (nextLevel === undefined) return;
  setTroopInput(
    sideId,
    troop,
    withComposition(current, [
      ...composition,
      { level: nextLevel, aliveCount: 0 },
    ]),
  );
}

function removeMixedLevel(target: HTMLElement): void {
  const sideId = requireSide(target.dataset.side);
  const troop = requireTroop(target.dataset.troop);
  const index = requireCompositionIndex(target.dataset.index);
  const current = getInputSide(sideId).troops[troop];
  const composition = getUiComposition(current);
  if (composition.length <= 1) return;
  setTroopInput(
    sideId,
    troop,
    withComposition(
      current,
      composition.filter((_, entryIndex) => entryIndex !== index),
    ),
  );
}

function getUiComposition(
  troop: ValidationTroopInput,
): readonly ValidationLevelCompositionEntry[] {
  if ((troop.levelMode ?? "single") === "mixed") {
    return troop.levelComposition ?? [{
      level: troop.troopLevel,
      aliveCount: troop.count,
    }];
  }
  return [{ level: troop.troopLevel, aliveCount: troop.count }];
}

function withComposition(
  troop: ValidationTroopInput,
  levelComposition: readonly ValidationLevelCompositionEntry[],
): ValidationTroopInput {
  return {
    ...troop,
    resolutionSource: "userOverride",
    levelMode: "mixed",
    levelComposition,
    count: levelComposition.reduce((sum, entry) => sum + entry.aliveCount, 0),
  };
}

function setTroopInput(
  sideId: SideId,
  troop: TroopType,
  value: ValidationTroopInput,
): void {
  const currentSide = getInputSide(sideId);
  setInputSide(sideId, {
    ...currentSide,
    troops: { ...currentSide.troops, [troop]: { ...value, resolutionSource: "userOverride" } },
  });
}

function requireCompositionIndex(value: string | undefined): number {
  const index = Number(value);
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error("Invalid mixed-level composition index.");
  }
  return index;
}

function updateReportHero(target: HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side);
  const troop = requireTroop(target.dataset.troop);
  if (target.value && !catalog.reportHeroes.some((hero) => hero.heroId === target.value &&
    hero.troopType === troop && isHeroAvailableAtStage(hero, validationStageId(input)))) {
    throw new RangeError("英雄超过当前服务器阶段或兵种不匹配。");
  }
  const side = getInputSide(sideId);
  setInputSide(sideId, {
    ...side,
    reportHeroByTroop: { ...side.reportHeroByTroop, [troop]: target.value || null },
  });
}

function updateReportWeapon(target: HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side);
  const heroId = target.dataset.hero;
  if (heroId === undefined) throw new Error("Missing report weapon hero id.");
  if (!isHeroAvailableAtStage(heroId, validationStageId(input))) {
    throw new RangeError("英雄超过当前服务器阶段。");
  }
  const level = parseWeaponLevel(target.value);
  const side = getInputSide(sideId);
  setInputSide(sideId, {
    ...side,
    reportWeaponLevels: { ...side.reportWeaponLevels, [heroId]: level },
  });
}

function updateSimulationWeapon(target: HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side);
  const heroId = target.dataset.hero;
  if (heroId === undefined) throw new Error("Missing simulation weapon hero id.");
  if (!isHeroAvailableAtStage(heroId, validationStageId(input))) {
    throw new RangeError("英雄超过当前服务器阶段。");
  }
  const level = parseWeaponLevel(target.value);
  const side = getInputSide(sideId);
  setInputSide(sideId, {
    ...side,
    simulationWeaponLevels: { ...side.simulationWeaponLevels, [heroId]: level },
  });
}

function updateLeader(target: HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side);
  const troop = requireTroop(target.dataset.troop);
  if (target.value && !catalog.leaderHeroes.some((hero) => hero.heroId === target.value &&
    hero.troopType === troop && isHeroAvailableAtStage(hero, validationStageId(input)))) {
    throw new RangeError("英雄超过当前服务器阶段或兵种不匹配。");
  }
  const side = getInputSide(sideId);
  setInputSide(sideId, selectSimulationHero(side, troop, target.value || null));
  if (target.value && heroOwnershipScope(input) === "owned" && !ownedHeroIds(input).includes(target.value))
    input = setOwnedHero(input, target.value, true);
}

function updateMember(target: HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side);
  if (target.value && !getAvailableMemberSkills(validationStageId(input)).some((option) =>
    option.sourceSkillIds.includes(target.value))) {
    throw new RangeError("车身技能代表英雄超过当前服务器阶段。");
  }
  const index = Number(target.dataset.index);
  const side = getInputSide(sideId);
  const slots = Array.from({ length: 4 }, (_, slot) =>
    slot === index ? target.value : side.bodySkills?.[slot]?.skillId ??
      side.selectedMemberSkillIds[slot] ?? "",
  );
  const selectedIds = slots.filter((skillId) => skillId !== "");
  const leaderIds = side.leaderHeroIds === undefined
    ? (side.leaderHeroId === null ? [] : [side.leaderHeroId])
    : Object.values(side.leaderHeroIds).filter((id): id is string => !!id);
  const bodySkills = resolveBodySkillConfigs(selectedIds, leaderIds,
    validationStageId(input)).map((body) => ({ ...body,
    skillLevel: side.bodySkills?.find((old) => old.skillId === body.skillId)?.skillLevel ??
      body.skillLevel }));
  setInputSide(sideId, {
    ...side,
    selectedMemberSkillIds: selectedIds,
    bodySkills,
  });
}

function updateControl(target: HTMLInputElement): void {
  const value = Number(target.value);
  if (target.dataset.field === "randomSeed") input = { ...input, randomSeed: value };
  if (target.dataset.field === "maxRounds") input = { ...input, maxRounds: value };
}

function updateT12(target: HTMLInputElement | HTMLSelectElement): void {
  const sideId = requireSide(target.dataset.side);
  const troop = requireTroop(target.dataset.troop);
  const level = Number(target.value);
  if (!Number.isSafeInteger(level) || level < 0 || level > maxT12SkillLevel(input, sideId)) {
    throw new Error(`T12 兵种技能等级必须是0到${maxT12SkillLevel(input, sideId)}的整数。`);
  }
  const side = getInputSide(sideId);
  setInputSide(sideId, {
    ...side,
    troops: {
      ...side.troops,
      [troop]: {
        ...side.troops[troop],
        t12Level: level,
      },
    },
  });
}

function updateTraceRange(target: HTMLInputElement): void {
  const value = Math.max(1, Number(target.value));
  if (target.dataset.field === "start") traceStartRound = value;
  if (target.dataset.field === "end") traceEndRound = value;
}

function updateOverride(target: HTMLSelectElement): void {
  const key = target.dataset.key;
  if (key === undefined) throw new Error("Missing override key.");
  input = {
    ...input,
    triggerOverrides: {
      ...input.triggerOverrides,
      [key]: target.value as DebugOverrideMode,
    },
  };
}

function updateDisabledSkill(target: HTMLInputElement): void {
  input = {
    ...input,
    disabledSkillIds: target.checked
      ? [...input.disabledSkillIds, target.value]
      : input.disabledSkillIds.filter((id) => id !== target.value),
  };
}

function updateActual(target: HTMLInputElement): void {
  const round = Number(target.dataset.round);
  const direction = target.dataset.direction as "AtoB" | "BtoA";
  const rows = input.actualRounds.filter((row) => row.round !== round);
  const previous = input.actualRounds.find((row) => row.round === round);
  const value = target.value === "" ? undefined : Number(target.value);
  const next = {
    round,
    ...(previous?.AtoB === undefined ? {} : { AtoB: previous.AtoB }),
    ...(previous?.BtoA === undefined ? {} : { BtoA: previous.BtoA }),
    ...(value === undefined ? {} : { [direction]: value }),
  };
  if (value === undefined) delete (next as { AtoB?: number; BtoA?: number })[direction];
  input = {
    ...input,
    actualRounds: Object.keys(next).length === 1
      ? rows
      : [...rows, next].sort((a, b) => a.round - b.round),
  };
}

function allRandomOverridesOff(): Readonly<Record<string, DebugOverrideMode>> {
  const output: Record<string, DebugOverrideMode> = {};
  const preview = safePreview();
  if (preview === null) return output;
  for (const skill of getActiveSkillUniverse(preview).filter(
    (candidate) => candidate.probability !== null,
  )) {
    if (skill.perTroop) {
      for (const troop of skill.applicableTroops) {
        output[`${skill.side}:${troop}:${skill.id}`] = "FORCE_NOT_TRIGGER";
      }
    } else {
      output[`${skill.side}:${skill.id}`] = "FORCE_NOT_TRIGGER";
    }
  }
  return output;
}

function parseWeaponLevel(value: string): number {
  const level = Number(value);
  if (!Number.isSafeInteger(level) || level < 0 || level > 10) {
    throw new RangeError("专武等级必须是 0 到 10 的整数。");
  }
  return level;
}

function getInputSide(side: SideId): ValidationSideInput {
  return side === "A" ? input.sideA : input.sideB;
}

function setInputSide(side: SideId, value: ValidationSideInput): void {
  input = normalizeIceFireReportLineage(side === "A" ? { ...input, sideA: value } : { ...input, sideB: value });
}

function requireSide(value: string | undefined): SideId {
  if (value !== "A" && value !== "B") throw new Error("Invalid side id.");
  return value;
}

function requireTroop(value: string | undefined): TroopType {
  if (value !== "shield" && value !== "lancer" && value !== "marksman") {
    throw new Error("Invalid troop type.");
  }
  return value;
}

async function copyText(text: string, success: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(success);
  } catch {
    showToast("复制失败，请使用 Developer Mode 手动复制");
  }
}

function showToast(message: string): void {
  if (toastTimer !== null) clearTimeout(toastTimer);
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.append(toast);
  toastTimer = setTimeout(() => toast.remove(), 1800);
}

function troopName(troop: TroopType): string {
  return troop === "shield" ? "盾兵" : troop === "lancer" ? "矛兵" : "射手";
}

function formatNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function formatTroopConstant(value: number): string {
  return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function formatBatchExpectation(value: number): string {
  return value.toFixed(2);
}

function formatReportPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatTroopCounts(
  counts: Readonly<Partial<Record<TroopType, number>>>,
): string {
  const rows = TROOP_TYPES.flatMap((troop) =>
    counts[troop] === undefined ? [] : [`${troopName(troop)} ${counts[troop]}`]
  );
  return rows.join("、") || "无";
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function signedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function attributeName(value: "attack" | "defense" | "penetration" | "life"): string {
  return value === "attack" ? "攻击" : value === "defense" ? "防御" : value === "penetration" ? "穿透" : "生命";
}

function battleContextName(value: string): string {
  return value === "challenge"
    ? "单撞 / 挑战"
    : value === "rally"
      ? "集结"
    : value === "rallyAttack"
      ? "集结进攻"
      : value === "rallyDefense"
        ? "集结防御"
        : value === "garrisonDefense"
          ? "守城"
          : "未指定";
}

function damageTypeName(type: string, subtype: string): string {
  if (subtype === "extraDamage") return "技能伤害 / 额外伤害";
  return type === "normalAttack" ? "普通攻击" : "技能伤害";
}

function overrideModeName(mode: DebugOverrideMode): string {
  return mode === "AUTO" ? "自动判定" : mode === "FORCE_TRIGGER" ? "强制触发" : "强制不触发";
}

function skillCategoryName(category: string): string {
  return category === "exclusiveWeapon" ? "专武" : category === "expedition" ? "远征" : category === "fireCrystal" ? "火晶" : category === "base" ? "基础" : category === "tier" ? "等级解锁" : category;
}

function effectKindName(kind: string): string {
  const names: Readonly<Record<string, string>> = {
    damageIncrease: "增伤",
    damageReduction: "受到伤害降低",
    outgoingDamageReduction: "造成伤害降低",
    attributeModifier: "属性增益",
    attributeReduction: "属性减益",
    defenseModifier: "防御修正",
    defenseReduction: "减防",
    incomingDamageIncrease: "易伤",
    targetingOverride: "索敌覆盖",
    directDamageCancellation: "直接伤害抵消",
    skipNextRoundAction: "下一回合跳过行动",
  };
  return names[kind] ?? kind;
}

function ruleUnknownDescription(rule: string): string {
  const descriptions: Readonly<Record<string, string>> = {
    futureEffectActivationTiming: "未来效果生效时序——待具体技能确认立即、下一行动或下一回合。",
    targetingOverrideConflictPrecedence: "多个索敌覆盖的优先级——当前仅奇袭会改变索敌。",
    reservedTriggerScheduling: "预留触发调度顺序——待真实技能接入后确认。",
    complexInitiativeOrdering: "复杂行动顺序——抢先手、打断和插入行动尚无规则。",
  };
  return descriptions[rule] ?? rule;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
