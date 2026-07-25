/* 全局错误兜底：避免单点脚本错误导致整页白屏（"闪退"）。
   任何未捕获的同步错误 / 未处理的 Promise rejection 都会显示到 #errorBox，
   便于定位问题而不是静默崩溃。 */
(function installGlobalErrorGuard() {
  function showError(label, detail) {
    const box = document.getElementById("errorBox");
    if (!box) return;
    box.classList.remove("hidden");
    box.textContent = `${label}：${detail}`;
  }
  window.addEventListener("error", (event) => {
    /* 资源加载错误（img/script 404 等）通常没有 message，跳过以免噪音刷屏 */
    if (!event.message) return;
    showError("⚠️ 页面脚本错误", event.message + (event.filename ? ` @ ${event.filename}:${event.lineno}` : ""));
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const text = reason && reason.message ? reason.message : String(reason);
    showError("⚠️ 未处理的异步错误", text);
  });
})();

const elements = {
  modeOptions: [...document.querySelectorAll(".mode-option")],
  standardGoalSwitch: document.querySelector("#standardGoalSwitch"),
  goalOptions: [...document.querySelectorAll(".goal-option")],
  standardWorkspaces: [...document.querySelectorAll(".standard-workspace")],
  productionTopbar: document.querySelector("#productionTopbar"),
  commerceTopbar: document.querySelector("#commerceTopbar"),
  commerceTopbarEyebrow: document.querySelector("#commerceTopbarEyebrow"),
  commerceTopbarTitle: document.querySelector("#commerceTopbarTitle"),
  commerceTopbarDescription: document.querySelector("#commerceTopbarDescription"),
  operatorBadge: document.querySelector("#operatorBadge"),
  operatorName: document.querySelector("#operatorName"),
  switchOperatorButton: document.querySelector("#switchOperatorButton"),
  operatorModal: document.querySelector("#operatorModal"),
  operatorOptions: document.querySelector("#operatorOptions"),
  closeOperatorModalButton: document.querySelector("#closeOperatorModalButton"),
  commercePrimaryAction: document.querySelector("#commercePrimaryAction"),
  commerceSecondaryAction: document.querySelector("#commerceSecondaryAction"),
  dailyPriorityTask: document.querySelector("#dailyPriorityTask"),
  dailyProgressText: document.querySelector("#dailyProgressText"),
  dailyTotalTime: document.querySelector("#dailyTotalTime"),
  dailyIssueCount: document.querySelector("#dailyIssueCount"),
  dailyWaitingAlert: document.querySelector("#dailyWaitingAlert"),
  dailyWaitingViewAll: document.querySelector("#dailyWaitingViewAll"),
  dailyTaskProgressBadge: document.querySelector("#dailyTaskProgressBadge"),
  dailyTaskList: document.querySelector("#dailyTaskList"),
  dailyCurrentTaskName: document.querySelector("#dailyCurrentTaskName"),
  dailyCurrentTaskStatus: document.querySelector("#dailyCurrentTaskStatus"),
  dailyCurrentTaskReason: document.querySelector("#dailyCurrentTaskReason"),
  dailyTaskFacts: document.querySelector("#dailyTaskFacts"),
  dailyCheckObjects: document.querySelector("#dailyCheckObjects"),
  dailyStepList: document.querySelector("#dailyStepList"),
  dailyAbnormalList: document.querySelector("#dailyAbnormalList"),
  dailyDoneList: document.querySelector("#dailyDoneList"),
  dailyRiskLevelPills: document.querySelector("#dailyRiskLevelPills"),
  dailyPossibleOutputs: document.querySelector("#dailyPossibleOutputs"),
  dailyStepWaitingButton: document.querySelector("#dailyStepWaitingButton"),
  dailyCurrentElapsed: document.querySelector("#dailyCurrentElapsed"),
  dailyStartButton: document.querySelector("#dailyStartButton"),
  dailyPauseButton: document.querySelector("#dailyPauseButton"),
  dailyCompleteButton: document.querySelector("#dailyCompleteButton"),
  dailyActionInput: document.querySelector("#dailyActionInput"),
  dailyIssueInput: document.querySelector("#dailyIssueInput"),
  dailyNoActionInput: document.querySelector("#dailyNoActionInput"),
  dailyFollowupInput: document.querySelector("#dailyFollowupInput"),
  dailyEvidenceHints: document.querySelector("#dailyEvidenceHints"),
  dailyTaskWaitingCount: document.querySelector("#dailyTaskWaitingCount"),
  dailyTaskWaitingDue: document.querySelector("#dailyTaskWaitingDue"),
  dailyTaskWaitingActions: document.querySelector("#dailyTaskWaitingActions"),
  dailyWaitingToggleForm: document.querySelector("#dailyWaitingToggleForm"),
  dailyWaitingSummary: document.querySelector("#dailyWaitingSummary"),
  dailyWaitingForm: document.querySelector("#dailyWaitingForm"),
  dailyWaitingStoreName: document.querySelector("#dailyWaitingStoreName"),
  dailyWaitingStoreId: document.querySelector("#dailyWaitingStoreId"),
  dailyWaitingTaskId: document.querySelector("#dailyWaitingTaskId"),
  dailyWaitingType: document.querySelector("#dailyWaitingType"),
  dailyWaitingOwner: document.querySelector("#dailyWaitingOwner"),
  dailyWaitingOwnerRole: document.querySelector("#dailyWaitingOwnerRole"),
  dailyWaitingDescription: document.querySelector("#dailyWaitingDescription"),
  dailyWaitingDueAt: document.querySelector("#dailyWaitingDueAt"),
  dailyWaitingNextFollowUpAt: document.querySelector("#dailyWaitingNextFollowUpAt"),
  dailyWaitingNote: document.querySelector("#dailyWaitingNote"),
  dailyWaitingSubmit: document.querySelector("#dailyWaitingSubmit"),
  dailyWaitingCancelForm: document.querySelector("#dailyWaitingCancelForm"),
  dailyWaitingFormError: document.querySelector("#dailyWaitingFormError"),
  dailyWaitingContext: document.querySelector("#dailyWaitingContext"),
  dailyWaitingListDetails: document.querySelector("#dailyWaitingListDetails"),
  dailyWaitingGroups: document.querySelector("#dailyWaitingGroups"),
  dailyReportSummary: document.querySelector("#dailyReportSummary"),
  dailyReportPreview: document.querySelector("#dailyReportPreview"),
  insertWorkspace: document.querySelector("#insertWorkspace"),
  workspacePanel: document.querySelector("#workspacePanel"),
  workspacePanelTitle: document.querySelector("#workspacePanelTitle"),
  workspacePanelSubtitle: document.querySelector("#workspacePanelSubtitle"),
  workspaceSwitcher: document.querySelector("#workspaceSwitcher"),
  workspaceMenu: document.querySelector("#workspaceMenu"),
  navItems: [...document.querySelectorAll(".nav-item")],
  workspaceTabs: [...document.querySelectorAll(".workspace-tab")],
  workspaceMenus: [...document.querySelectorAll(".workspace-menu")],
  providerOptions: [...document.querySelectorAll(".provider-option")],
  providerHeading: document.querySelector("#providerHeading"),
  providerDescription: document.querySelector("#providerDescription"),
  viewPanels: [...document.querySelectorAll("[data-view-panel]")],
  settingsButton: document.querySelector("#settingsButton"),
  settingsDrawer: document.querySelector("#settingsDrawer"),
  settingsBackdrop: document.querySelector("#settingsBackdrop"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  promptLibraryCount: document.querySelector("#promptLibraryCount"),
  promptLibraryList: document.querySelector("#promptLibraryList"),
  taskDock: document.querySelector("#taskDock"),
  taskDockIndicator: document.querySelector("#taskDockIndicator"),
  taskDockToggle: document.querySelector("#taskDockToggle"),
  taskDockDetails: document.querySelector("#taskDockDetails"),
  taskDockMessage: document.querySelector("#taskDockMessage"),
  taskImageNumber: document.querySelector("#taskImageNumber"),
  taskAwake: document.querySelector("#taskAwake"),
  dockSyncButton: document.querySelector("#dockSyncButton"),
  dockPauseButton: document.querySelector("#dockPauseButton"),
  dockRollbackButton: document.querySelector("#dockRollbackButton"),
  dockAbandonButton: document.querySelector("#dockAbandonButton"),
  chatStatus: document.querySelector("#chatStatus"),
  awakeStatus: document.querySelector("#awakeStatus"),
  metricImageCount: document.querySelector("#metricImageCount"),
  metricPhase: document.querySelector("#metricPhase"),
  metricGenerated: document.querySelector("#metricGenerated"),
  overallProgressText: document.querySelector("#overallProgressText"),
  folderInput: document.querySelector("#folderInput"),
  imageDropZone: document.querySelector("#imageDropZone"),
  folderHint: document.querySelector("#folderHint"),
  urlImportPanel: document.querySelector("#urlImportPanel"),
  imageUrls: document.querySelector("#imageUrls"),
  importUrlsButton: document.querySelector("#importUrlsButton"),
  urlImportHint: document.querySelector("#urlImportHint"),
  objectiveInfoPanel: document.querySelector("#objectiveInfoPanel"),
  objectiveInfoInput: document.querySelector("#objectiveInfoInput"),
  objectiveInfoStatus: document.querySelector("#objectiveInfoStatus"),
  launchButton: document.querySelector("#launchButton"),
  checkButton: document.querySelector("#checkButton"),
  runAllButton: document.querySelector("#runAllButton"),
  heroKicker: document.querySelector("#heroKicker"),
  heroTitle: document.querySelector("#heroTitle"),
  heroDescription: document.querySelector("#heroDescription"),
  runButton: document.querySelector("#runButton"),
  planningButton: document.querySelector("#planningButton"),
  planningSkipNotice: document.querySelector("#planningSkipNotice"),
  imagesButton: document.querySelector("#imagesButton"),
  imagesSkipNotice: document.querySelector("#imagesSkipNotice"),
  seoListingButton: document.querySelector("#seoListingButton"),
  openOutputButton: document.querySelector("#openOutputButton"),
  nextProductButton: document.querySelector("#nextProductButton"),
  archiveHint: document.querySelector("#archiveHint"),
  generationSteps: document.querySelector("#generationSteps"),
  outputGallery: document.querySelector("#outputGallery"),
  researchPrompt: document.querySelector("#researchPrompt"),
  planningPrompt: document.querySelector("#planningPrompt"),
  seoKeywordsPrompt: document.querySelector("#seoKeywordsPrompt"),
  listingContentPrompt: document.querySelector("#listingContentPrompt"),
  luxuryInsertPrompt: document.querySelector("#luxuryInsertPrompt"),
  insertMarketRadarPrompt: document.querySelector("#insertMarketRadarPrompt"),
  insertListingContentPrompt: document.querySelector("#insertListingContentPrompt"),
  listingVisualProductFactsInput: document.querySelector("#listingVisualProductFactsInput"),
  listingVisualMarketAuditPrompt: document.querySelector("#listingVisualMarketAuditPrompt"),
  listingVisualMarketAuditResult: document.querySelector("#listingVisualMarketAuditResult"),
  listingVisualStrategyPrompt: document.querySelector("#listingVisualStrategyPrompt"),
  listingVisualStrategyResult: document.querySelector("#listingVisualStrategyResult"),
  listingVisualPlanPrompt: document.querySelector("#listingVisualPlanPrompt"),
  listingVisualPlanResult: document.querySelector("#listingVisualPlanResult"),
  listingVisualImageNumber: document.querySelector("#listingVisualImageNumber"),
  listingVisualSinglePromptText: document.querySelector("#listingVisualSinglePromptText"),
  researchPromptStatus: document.querySelector("#researchPromptStatus"),
  planningPromptStatus: document.querySelector("#planningPromptStatus"),
  seoKeywordsPromptStatus: document.querySelector("#seoKeywordsPromptStatus"),
  listingContentPromptStatus: document.querySelector(
    "#listingContentPromptStatus"
  ),
  luxuryInsertPromptStatus: document.querySelector("#luxuryInsertPromptStatus"),
  insertMarketRadarPromptStatus: document.querySelector(
    "#insertMarketRadarPromptStatus"
  ),
  insertListingContentPromptStatus: document.querySelector(
    "#insertListingContentPromptStatus"
  ),
  saveResearchPrompt: document.querySelector("#saveResearchPrompt"),
  savePlanningPrompt: document.querySelector("#savePlanningPrompt"),
  saveSeoKeywordsPrompt: document.querySelector("#saveSeoKeywordsPrompt"),
  saveListingContentPrompt: document.querySelector(
    "#saveListingContentPrompt"
  ),
  saveLuxuryInsertPrompt: document.querySelector("#saveLuxuryInsertPrompt"),
  saveInsertMarketRadarPrompt: document.querySelector(
    "#saveInsertMarketRadarPrompt"
  ),
  saveInsertListingContentPrompt: document.querySelector(
    "#saveInsertListingContentPrompt"
  ),
  contentDownloads: document.querySelector("#contentDownloads"),
  seoResultBox: document.querySelector("#seoResultBox"),
  seoResultText: document.querySelector("#seoResultText"),
  listingResultBox: document.querySelector("#listingResultBox"),
  listingResultText: document.querySelector("#listingResultText"),
  productDirectory: document.querySelector("#productDirectory"),
  imageCount: document.querySelector("#imageCount"),
  imageList: document.querySelector("#imageList"),
  clearImagesButton: document.querySelector("#clearImagesButton"),
  imageLockHint: document.querySelector("#imageLockHint"),
  statusBadge: document.querySelector("#statusBadge"),
  stage: document.querySelector("#stage"),
  updatedAt: document.querySelector("#updatedAt"),
  message: document.querySelector("#message"),
  progress: document.querySelector("#progress span"),
  errorBox: document.querySelector("#errorBox"),
  syncButton: document.querySelector("#syncButton"),
  resumeButton: document.querySelector("#resumeButton"),
  responseBox: document.querySelector("#responseBox"),
  responseText: document.querySelector("#responseText"),
  profileWarning: document.querySelector("#profileWarning"),
  currentProfileStatus: document.querySelector("#currentProfileStatus"),
  profileDetailTitle: document.querySelector("#profileDetailTitle"),
  backToCurrentProfileButton: document.querySelector("#backToCurrentProfileButton"),
  returnToInsertEditorButton: document.querySelector("#returnToInsertEditorButton"),
  currentProfileEmpty: document.querySelector("#currentProfileEmpty"),
  currentProfileForm: document.querySelector("#currentProfileForm"),
  profileDisplayName: document.querySelector("#profileDisplayName"),
  profileProductId: document.querySelector("#profileProductId"),
  profileNextAction: document.querySelector("#profileNextAction"),
  profileSuggestedAction: document.querySelector("#profileSuggestedAction"),
  profileNotes: document.querySelector("#profileNotes"),
  saveProfileButton: document.querySelector("#saveProfileButton"),
  resetProfileActionButton: document.querySelector("#resetProfileActionButton"),
  profileWorkflowMode: document.querySelector("#profileWorkflowMode"),
  profileCurrentStage: document.querySelector("#profileCurrentStage"),
  profileArtifactCount: document.querySelector("#profileArtifactCount"),
  profileArtifactsBox: document.querySelector("#profileArtifactsBox"),
  profileArtifactsList: document.querySelector("#profileArtifactsList"),
  newProductDisplayName: document.querySelector("#newProductDisplayName"),
  newProductCategory: document.querySelector("#newProductCategory"),
  newProductCreationType: document.querySelector("#newProductCreationType"),
  newProductInventoryFields: document.querySelector("#newProductInventoryFields"),
  newProductInventorySku: document.querySelector("#newProductInventorySku"),
  newProductWarehouseSku: document.querySelector("#newProductWarehouseSku"),
  newProductSize: document.querySelector("#newProductSize"),
  newProductColor: document.querySelector("#newProductColor"),
  newProductInventoryRemark: document.querySelector("#newProductInventoryRemark"),
  newProductNotes: document.querySelector("#newProductNotes"),
  createNewProductButton: document.querySelector("#createNewProductButton"),
  newProductHint: document.querySelector("#newProductHint"),
  refreshProfilesButton: document.querySelector("#refreshProfilesButton"),
  productArchiveNotice: document.querySelector("#productArchiveNotice"),
  productArchiveNoticeText: document.querySelector("#productArchiveNoticeText"),
  showAbnormalProductsButton: document.querySelector("#showAbnormalProductsButton"),
  productLibrary: document.querySelector("#productLibrary"),
  queueWorkbookInput: document.querySelector("#queueWorkbookInput"),
  queueImportMessage: document.querySelector("#queueImportMessage"),
  queueStatusBadge: document.querySelector("#queueStatusBadge"),
  queueReadyCount: document.querySelector("#queueReadyCount"),
  queueCompletedCount: document.querySelector("#queueCompletedCount"),
  queueAbandonedCount: document.querySelector("#queueAbandonedCount"),
  queueInvalidCount: document.querySelector("#queueInvalidCount"),
  queueDuplicateCount: document.querySelector("#queueDuplicateCount"),
  queueCurrentProduct: document.querySelector("#queueCurrentProduct"),
  queueProgressText: document.querySelector("#queueProgressText"),
  queueProgressBar: document.querySelector("#queueProgressBar"),
  queueError: document.querySelector("#queueError"),
  queueStartButton: document.querySelector("#queueStartButton"),
  queuePauseButton: document.querySelector("#queuePauseButton"),
  queueResumeButton: document.querySelector("#queueResumeButton"),
  queueAbandonButton: document.querySelector("#queueAbandonButton"),
  queueClearButton: document.querySelector("#queueClearButton"),
  queueRefreshButton: document.querySelector("#queueRefreshButton"),
  queueTaskList: document.querySelector("#queueTaskList"),
  commerceKpis: document.querySelector("#commerceKpis"),
  commerceBoardList: document.querySelector("#commerceBoardList"),
  commerceSuggestionList: document.querySelector("#commerceSuggestionList"),
  manageCommerceProductsButton: document.querySelector("#manageCommerceProductsButton"),
  refreshOperationsButton: document.querySelector("#refreshOperationsButton"),
  commerceProductList: document.querySelector("#commerceProductList"),
  operationPool: document.querySelector("#operationPool"),
  commerceDetailTitle: document.querySelector("#commerceDetailTitle"),
  commerceDetailSubtitle: document.querySelector("#commerceDetailSubtitle"),
  commerceDetailTabs: document.querySelector("#commerceDetailTabs"),
  commerceDetailContent: document.querySelector("#commerceDetailContent"),
  backToOperationPoolButton: document.querySelector("#backToOperationPoolButton"),
  operationSelectedProduct: document.querySelector("#operationSelectedProduct"),
  operationProductTier: document.querySelector("#operationProductTier"),
  operationNextReviewAt: document.querySelector("#operationNextReviewAt"),
  operationEntryReason: document.querySelector("#operationEntryReason"),
  operationGoal: document.querySelector("#operationGoal"),
  operationStrategy: document.querySelector("#operationStrategy"),
  operationPlanType: document.querySelector("#operationPlanType"),
  operationTargetMetric: document.querySelector("#operationTargetMetric"),
  operationPlanObjective: document.querySelector("#operationPlanObjective"),
  operationSuccessCondition: document.querySelector("#operationSuccessCondition"),
  operationFailureCondition: document.querySelector("#operationFailureCondition"),
  operationAgentSummary: document.querySelector("#operationAgentSummary"),
  saveOperationProfileButton: document.querySelector("#saveOperationProfileButton"),
  deleteOperationProfileButton: document.querySelector("#deleteOperationProfileButton"),
  listingProductSelect: document.querySelector("#listingProductSelect"),
  legacyProductDisplayName: document.querySelector("#legacyProductDisplayName"),
  legacyStoreSelect: document.querySelector("#legacyStoreSelect"),
  legacyPlatformProductId: document.querySelector("#legacyPlatformProductId"),
  legacyListingUrl: document.querySelector("#legacyListingUrl"),
  legacyListingTitle: document.querySelector("#legacyListingTitle"),
  legacyInventorySku: document.querySelector("#legacyInventorySku"),
  legacyListingLifecycle: document.querySelector("#legacyListingLifecycle"),
  legacyPlatformSkuId: document.querySelector("#legacyPlatformSkuId"),
  legacySellerSkuCode: document.querySelector("#legacySellerSkuCode"),
  legacyPlatformBarcode: document.querySelector("#legacyPlatformBarcode"),
  legacyVariantName: document.querySelector("#legacyVariantName"),
  legacyWarehouseSku: document.querySelector("#legacyWarehouseSku"),
  legacyNotes: document.querySelector("#legacyNotes"),
  legacyOnboardButton: document.querySelector("#legacyOnboardButton"),
  legacyOnboardHint: document.querySelector("#legacyOnboardHint"),
  listingStoreSelect: document.querySelector("#listingStoreSelect"),
  listingPlatformProductId: document.querySelector("#listingPlatformProductId"),
  listingTitle: document.querySelector("#listingTitle"),
  listingStatus: document.querySelector("#listingStatus"),
  listingInventorySku: document.querySelector("#listingInventorySku"),
  listingLifecycle: document.querySelector("#listingLifecycle"),
  listingBagModel: document.querySelector("#listingBagModel"),
  listingTargetSize: document.querySelector("#listingTargetSize"),
  listingUrl: document.querySelector("#listingUrl"),
  listingImageVersion: document.querySelector("#listingImageVersion"),
  listingTitleVersion: document.querySelector("#listingTitleVersion"),
  saveListingCardButton: document.querySelector("#saveListingCardButton"),
  skuMappingListingSelect: document.querySelector("#skuMappingListingSelect"),
  skuPlatformSkuId: document.querySelector("#skuPlatformSkuId"),
  skuSellerSkuCode: document.querySelector("#skuSellerSkuCode"),
  skuPlatformBarcode: document.querySelector("#skuPlatformBarcode"),
  skuVariantName: document.querySelector("#skuVariantName"),
  skuColor: document.querySelector("#skuColor"),
  skuSize: document.querySelector("#skuSize"),
  skuInventorySku: document.querySelector("#skuInventorySku"),
  skuWarehouseSku: document.querySelector("#skuWarehouseSku"),
  skuMappingStatus: document.querySelector("#skuMappingStatus"),
  skuMappingRemark: document.querySelector("#skuMappingRemark"),
  saveSkuMappingButton: document.querySelector("#saveSkuMappingButton"),
  listingMatrixList: document.querySelector("#listingMatrixList"),
  taskListingSelect: document.querySelector("#taskListingSelect"),
  taskSkuMappingSelect: document.querySelector("#taskSkuMappingSelect"),
  taskPeriod: document.querySelector("#taskPeriod"),
  taskReviewDueAt: document.querySelector("#taskReviewDueAt"),
  taskRelatedPlanId: document.querySelector("#taskRelatedPlanId"),
  createDataTaskButton: document.querySelector("#createDataTaskButton"),
  snapshotListingSelect: document.querySelector("#snapshotListingSelect"),
  snapshotTaskSelect: document.querySelector("#snapshotTaskSelect"),
  snapshotSkuMappingSelect: document.querySelector("#snapshotSkuMappingSelect"),
  snapshotPeriodStart: document.querySelector("#snapshotPeriodStart"),
  snapshotPeriodEnd: document.querySelector("#snapshotPeriodEnd"),
  snapshotImpressions: document.querySelector("#snapshotImpressions"),
  snapshotVisitors: document.querySelector("#snapshotVisitors"),
  snapshotClicks: document.querySelector("#snapshotClicks"),
  snapshotAddToCart: document.querySelector("#snapshotAddToCart"),
  snapshotOrders: document.querySelector("#snapshotOrders"),
  snapshotRevenue: document.querySelector("#snapshotRevenue"),
  snapshotAdSpend: document.querySelector("#snapshotAdSpend"),
  snapshotRefundCount: document.querySelector("#snapshotRefundCount"),
  snapshotBadReviews: document.querySelector("#snapshotBadReviews"),
  snapshotSearchTerms: document.querySelector("#snapshotSearchTerms"),
  snapshotInventoryStatus: document.querySelector("#snapshotInventoryStatus"),
  saveSnapshotButton: document.querySelector("#saveSnapshotButton"),
  dataTaskList: document.querySelector("#dataTaskList"),
  snapshotList: document.querySelector("#snapshotList"),
  actionProductSelect: document.querySelector("#actionProductSelect"),
  actionListingSelect: document.querySelector("#actionListingSelect"),
  actionType: document.querySelector("#actionType"),
  actionStatus: document.querySelector("#actionStatus"),
  actionReason: document.querySelector("#actionReason"),
  actionTargetMetric: document.querySelector("#actionTargetMetric"),
  actionObservationPeriod: document.querySelector("#actionObservationPeriod"),
  actionOperator: document.querySelector("#actionOperator"),
  actionReviewDueAt: document.querySelector("#actionReviewDueAt"),
  createActionButton: document.querySelector("#createActionButton"),
  operationActionList: document.querySelector("#operationActionList"),
  operationReviewList: document.querySelector("#operationReviewList"),
  storeAlias: document.querySelector("#storeAlias"),
  storePlatform: document.querySelector("#storePlatform"),
  storeHitoorEnvName: document.querySelector("#storeHitoorEnvName"),
  storeHitoorEnvId: document.querySelector("#storeHitoorEnvId"),
  storeRole: document.querySelector("#storeRole"),
  storeStatus: document.querySelector("#storeStatus"),
  storeRemark: document.querySelector("#storeRemark"),
  saveStoreProfileButton: document.querySelector("#saveStoreProfileButton"),
  storeProfileList: document.querySelector("#storeProfileList"),
  insertTaskId: document.querySelector("#insertTaskId"),
  returnMarketRadarButton: document.querySelector("#returnMarketRadarButton"),
  insertPauseTaskButton: document.querySelector("#insertPauseTaskButton"),
  insertAbandonTaskButton: document.querySelector("#insertAbandonTaskButton"),
  runInsertMarketRadarButton: document.querySelector("#runInsertMarketRadarButton"),
  importCurrentChatMarketRadarButton: document.querySelector("#importCurrentChatMarketRadarButton"),
  resetInsertMarketRadarButton: document.querySelector("#resetInsertMarketRadarButton"),
  recoverMarketRadarButton: document.querySelector("#recoverMarketRadarButton"),
  insertListingEntryCard: document.querySelector("#insertListingEntryCard"),
  enterInsertListingButton: document.querySelector("#enterInsertListingButton"),
  gotoSelectionRadarFromEntryLink: document.querySelector("#gotoSelectionRadarFromEntryLink"),
  insertMarketRadarMeta: document.querySelector("#insertMarketRadarMeta"),
  reExtractNotebookButton: document.querySelector("#reExtractNotebookButton"),
  notebookImportBox: document.querySelector("#notebookImportBox"),
  notebookImportText: document.querySelector("#notebookImportText"),
  importNotebookButton: document.querySelector("#importNotebookButton"),
  notebookImportError: document.querySelector("#notebookImportError"),
  insertMarketRadarCandidates: document.querySelector("#insertMarketRadarCandidates"),
  insertMarketRadarBox: document.querySelector("#insertMarketRadarBox"),
  insertMarketRadarText: document.querySelector("#insertMarketRadarText"),
  insertBagInput: document.querySelector("#insertBagInput"),
  insertBagUrls: document.querySelector("#insertBagUrls"),
  insertBagUrlHint: document.querySelector("#insertBagUrlHint"),
  importInsertBagUrlsButton: document.querySelector("#importInsertBagUrlsButton"),
  insertBagGallery: document.querySelector("#insertBagGallery"),
  insertIdentifyButton: document.querySelector("#insertIdentifyButton"),
  insertIdentificationBox: document.querySelector("#insertIdentificationBox"),
  insertIdentificationText: document.querySelector("#insertIdentificationText"),
  insertBrand: document.querySelector("#insertBrand"),
  insertBagFamily: document.querySelector("#insertBagFamily"),
  bagVariantRows: document.querySelector("#bagVariantRows"),
  addBagVariantButton: document.querySelector("#addBagVariantButton"),
  confirmBagButton: document.querySelector("#confirmBagButton"),
  unlockBagButton: document.querySelector("#unlockBagButton"),
  runNotebookButton: document.querySelector("#runNotebookButton"),
  notebookResultBox: document.querySelector("#notebookResultBox"),
  notebookResultText: document.querySelector("#notebookResultText"),
  designVariantRows: document.querySelector("#designVariantRows"),
  freezeDesignButton: document.querySelector("#freezeDesignButton"),
  unlockDesignButton: document.querySelector("#unlockDesignButton"),
  linerUploadGrid: document.querySelector("#linerUploadGrid"),
  buildInsertPromptsButton: document.querySelector("#buildInsertPromptsButton"),
  generateInsertImagesButton: document.querySelector("#generateInsertImagesButton"),
  insertNextProductButton: document.querySelector("#insertNextProductButton"),
  generateInsertListingButton: document.querySelector("#generateInsertListingButton"),
  importInsertListingContentButton: document.querySelector("#importInsertListingContentButton"),
  previewInsertStockSheetButton: document.querySelector("#previewInsertStockSheetButton"),
  archiveInsertButton: document.querySelector("#archiveInsertButton"),
  insertListingContentBox: document.querySelector("#insertListingContentBox"),
  insertListingContentText: document.querySelector("#insertListingContentText"),
  insertStockSheetPreview: document.querySelector("#insertStockSheetPreview"),
  insertGenerationSteps: document.querySelector("#insertGenerationSteps"),
  insertOutputGallery: document.querySelector("#insertOutputGallery"),
  claimInputs: [...document.querySelectorAll("[data-claim]")]
};

const LISTING_VISUAL_WORKFLOW_STORAGE_KEY = "yk_listing_visual_workflow_v2";

const listingVisualPromptTargets = {
  marketVisualAuditV2: {
    promptElement: "listingVisualMarketAuditPrompt",
    stage: "marketAudit",
    outputKey: "market_visual_audit"
  },
  visualStrategyCompression: {
    promptElement: "listingVisualStrategyPrompt",
    stage: "strategy",
    outputKey: "visual_strategy_decision"
  },
  visualPlanningV2: {
    promptElement: "listingVisualPlanPrompt",
    stage: "visualPlan",
    outputKey: "visual_plan"
  },
  singleImagePromptV2: {
    promptElement: "listingVisualSinglePromptText",
    stage: "singlePrompt",
    outputKey: "single_image_prompt"
  },
};

const PROMPT_LIBRARY_ITEMS = [
  { kind: "research", label: "市场调研 Prompt", group: "标准 Listing", detail: "产品识别后用于联网市场调研、竞品分析和 VOC。" },
  { kind: "planning", label: "视觉规划 Prompt", group: "标准 Listing", detail: "生成 Image 01-10 视觉规划与 Prompt Pack。" },
  { kind: "seoKeywords", label: "SEO 关键词 Prompt", group: "标准 Listing", detail: "生成广告关键词、SEO 词库和属性词。" },
  { kind: "listingContent", label: "Listing 文案 Prompt", group: "标准 Listing", detail: "生成标题、卖点、详情页和合规文案。" },
  { kind: "luxuryInsert", label: "奢侈包内胆 7 图 Prompt", group: "内胆流程", detail: "基于冻结事实生成 Image 01-07 Prompt Pack。" },
  { kind: "insertMarketRadar", label: "内胆每日市场选款 Prompt", group: "内胆流程", detail: "执行每日包型机会雷达与开发池分层。" },
  { kind: "insertListingContent", label: "内胆 Listing 文案 Prompt", group: "内胆流程", detail: "基于内胆事实和图片逻辑生成安全 Listing 文案。" },
  { kind: "marketVisualAuditV2", label: "市场视觉调研 v2 Prompt", group: "Listing 视觉 v2", detail: "调研高表现 Listing 图片，不生成生图 Prompt。" },
  { kind: "visualStrategyCompression", label: "视觉策略裁剪 Prompt", group: "Listing 视觉 v2", detail: "把市场视觉调研压缩成可执行策略。" },
  { kind: "visualPlanningV2", label: "视觉规划 v2 Prompt", group: "Listing 视觉 v2", detail: "生成移动端可读、去重后的视觉计划。" },
  { kind: "singleImagePromptV2", label: "单图 Prompt v2", group: "Listing 视觉 v2", detail: "按单张图生成一个完整 Ready-to-Generate Prompt。" }
];

let lastBagVariantSignature;
let lastDesignVariantSignature;
let lastLinerUploadSignature;
let latestPayload;
let insertProfileVisible = false;
let selectedArchivedProfile;
let selectedOperationProductId;
let selectedCommerceDetailTab = "overview";
let commercePrefillContext;
const productHubProfiles = new Map();
const commerceDirtyForms = new Set();
const commerceFormDrafts = new Map();
const reviewDrafts = new Map();
let operationProfileDirtyProductId;
let profileFormDirty = false;
let profileFormProductId;
let editingStoreId = "";
let editingListingId = "";
let editingSkuMappingId = "";
let dailyWaitingItems = [];
let dailyWaitingFormOpen = false;
let dailyWaitingFormSource = "task";
let dailyEvidenceActionOpen = null;
let expandedDailySopStepId = null;
let dailyTaskRuns = {};
let dailyStepRuns = {};
let dailyStepOutputs = {};
const OPERATOR_STORAGE_KEY = "yk_operator_id";
let operators = [];
let currentOperator = null;
const dailyOperatorStateScopes = new Map();
let dailyEvidenceDraft = {
  task_id: null,
  store_id: null,
  store_name: "",
  step_id: null,
  type: null,
  content: "",
  meta: {},
  mode: "create"
};
let dailyUiState = {
  active_task_id: null,
  active_store_id: null,
  active_step_id: null,
  expanded_sop_step_id: null,
  open_evidence_type: null,
  open_panel: null,
  open_cadence: null
};
let dailyStoreTaskProgress = {};

const waitingTypeLabels = {
  warehouse: "等待仓库",
  platform_operator: "等待小二",
  supplier: "等待供应商",
  supervisor: "等待主管",
  platform_review: "等待平台审核",
  other: "其他"
};

const waitingStatusLabels = {
  waiting: "等待中",
  resolved: "已解决",
  cancelled: "已取消"
};

const NAV_WORKSPACES = [
  {
    id: "today",
    label: "今日指挥台",
    subtitle: "指令与执行",
    defaultView: "daily-cockpit",
    items: [
      { label: "今日总览", view: "daily-cockpit", status: "ready", isPlaceholder: false, semanticRole: "today-overview" },
      { label: "每日选款", view: "selection-radar", status: "ready", isPlaceholder: false, semanticRole: "today-selection-radar" },
      { label: "今日必做", view: "daily-check", status: "placeholder", isPlaceholder: true, semanticRole: "today-must" },
      { label: "异常阻断", view: "issue-log", status: "placeholder", isPlaceholder: true, semanticRole: "today-blockers" },
      { label: "待复盘", view: "daily-review", status: "placeholder", isPlaceholder: true, semanticRole: "today-review-pending" },
      { label: "日报沉淀", view: "operation-actions", status: "ready", isPlaceholder: false, semanticRole: "today-report" }
    ]
  },
  {
    id: "goals",
    label: "目标管理",
    subtitle: "目标到行动",
    defaultView: "goal-center",
    items: [
      { label: "年目标", view: "goal-center", status: "placeholder", isPlaceholder: true, semanticRole: "goal-year" },
      { label: "月规范", view: "goal-planning", status: "placeholder", isPlaceholder: true, semanticRole: "goal-month" },
      { label: "周计划", view: "goal-decomposition", status: "placeholder", isPlaceholder: true, semanticRole: "goal-week" },
      { label: "日行动", view: "goal-progress", status: "placeholder", isPlaceholder: true, semanticRole: "goal-day" },
      { label: "Backlog", view: "goal-gap", status: "placeholder", isPlaceholder: true, semanticRole: "goal-backlog" }
    ]
  },
  {
    id: "business",
    label: "业务场景",
    subtitle: "跨境作战区",
    defaultView: "selection-overview",
    items: [
      { label: "选品", view: "selection-overview", status: "ready", isPlaceholder: false, semanticRole: "business-selection" },
      { label: "上品", view: "materials", status: "ready", isPlaceholder: false, semanticRole: "business-production" },
      { label: "店小秘上品·乳贴", view: "agent-dianxiaomi", status: "ready", isPlaceholder: false, semanticRole: "business-dianxiaomi-listing" },
      { label: "批量上架", view: "batch-listing", status: "ready", isPlaceholder: false, semanticRole: "business-batch-listing" },
      { label: "运维", view: "operation-pool", status: "ready", isPlaceholder: false, semanticRole: "business-operation" },
      { label: "复盘", view: "operation-review", status: "ready", isPlaceholder: false, semanticRole: "business-review" }
    ]
  },
  {
    id: "knowledge",
    label: "知识库",
    subtitle: "SOP / Prompt / 规则",
    defaultView: "knowledge-center",
    items: [
      { label: "SOP", view: "knowledge-center", status: "placeholder", isPlaceholder: true, semanticRole: "knowledge-sop" },
      { label: "Prompt 库", view: "prompt-library", status: "placeholder", isPlaceholder: true, semanticRole: "knowledge-prompt" },
      { label: "规则库", view: "knowledge-base", status: "placeholder", isPlaceholder: true, semanticRole: "knowledge-rules" },
      { label: "案例库", view: "loop-engineering", status: "placeholder", isPlaceholder: true, semanticRole: "knowledge-cases" },
      { label: "产品知识", view: "skill-library", status: "placeholder", isPlaceholder: true, semanticRole: "knowledge-product" },
      { label: "术语与标准", view: "automation-candidates", status: "placeholder", isPlaceholder: true, semanticRole: "knowledge-terms" }
    ]
  },
  {
    id: "settings",
    label: "设置和工具",
    subtitle: "环境 / 工具 / 检查",
    defaultView: "store-settings",
    items: [
      { label: "店铺与环境", view: "store-settings", status: "ready", isPlaceholder: false, semanticRole: "settings-store-env" },
      { label: "数据导入", view: "data-tasks", status: "ready", isPlaceholder: false, semanticRole: "settings-data-import" },
      { label: "自动化工具", view: "agent-center", status: "placeholder", isPlaceholder: true, semanticRole: "settings-automation-tools" },
      { label: "团队成员及权限", view: "personal-center", status: "placeholder", isPlaceholder: true, semanticRole: "settings-team" },
      { label: "系统规则", view: "system-status", status: "placeholder", isPlaceholder: true, semanticRole: "settings-rules" },
      { label: "系统检查", view: "sync-status", status: "placeholder", isPlaceholder: true, semanticRole: "settings-check" }
    ]
  },
  {
    id: "research",
    label: "爆款研究中心",
    subtitle: "拆解爆款原因",
    defaultView: "research-center",
    items: [
      { label: "爆款拆解", view: "research-center", status: "ready", isPlaceholder: false, semanticRole: "research-center" }
    ]
  }
];

const workspaceDefaults = Object.fromEntries(
  NAV_WORKSPACES.map((workspace) => [workspace.id, workspace.defaultView])
);

const viewAliases = {
  "daily-operation": "daily-cockpit",
  "listing-builder": "content",
  "image-generator": "images",
  "主图生成": "images",
  "作图": "images",
  "product-hub": "operation-pool",
  "商品经营": "operation-pool",
  "店铺设置": "store-settings"
};

const navActiveViews = {
  "commerce-product-detail": "commerce-products",
  "daily-operation": "daily-cockpit",
  "listing-builder": "materials",
  content: "materials",
  images: "materials",
  "image-generator": "materials",
  "主图生成": "materials",
  "作图": "materials",
  "product-hub": "operation-pool",
  "商品经营": "operation-pool",
  "store-settings": "store-settings",
  "店铺设置": "store-settings",
  "ad-center": "operation-pool",
  "agent-ad-tools": "operation-pool",
  profiles: "commerce-products",
  connection: "listing-matrix",
  identity: "materials",
  planning: "materials",
  archive: "commerce-products",
  queue: "materials"
};

const viewWorkspace = NAV_WORKSPACES.reduce((mapping, workspace) => {
  workspace.items.forEach((item) => {
    mapping[item.view] = workspace.id;
  });
  return mapping;
}, {
  "daily-operation": "today",
  "listing-builder": "business",
  "image-generator": "business",
  "主图生成": "business",
  "作图": "business",
  "product-hub": "business",
  "商品经营": "business",
  "store-settings": "settings",
  "店铺设置": "settings",
  "commerce-dashboard": "today",
  content: "business",
  images: "business",
  "commerce-products": "business",
  "listing-matrix": "business",
  "ad-center": "business",
  "agent-ad-tools": "business",
  "commerce-product-detail": "business",
  profiles: "business",
  connection: "business",
  identity: "business",
  planning: "business",
  archive: "business",
  queue: "business",
  "selection-overview": "today",
  "selection-radar": "today",
  "product-selection": "today",
  "agent-dianxiaomi": "business",
  "batch-listing": "business"
});

const operationViews = new Set([
  ...NAV_WORKSPACES.flatMap((workspace) => workspace.items.map((item) => item.view)),
  ...Object.keys(viewWorkspace)
]);

const PRODUCTION_FLOW_STEPS = {
  materials: { step: "facts", label: "商品事实", view: "materials" },
  planning: { step: "planning", label: "市场调研", view: "planning" },
  content: { step: "content", label: "Listing", view: "content" },
  images: { step: "images", label: "作图", view: "images" },
  "listing-matrix": { step: "draft", label: "上架草稿", view: "listing-matrix" },
  "data-quality-review": { step: "qa", label: "上架质检", view: "data-quality-review" }
};
const PRODUCTION_FLOW_VIEWS = Object.keys(PRODUCTION_FLOW_STEPS);

let hiddenDashboardIncludeTestData = false;
let secretaryMode = localStorage.getItem("yk_secretary_mode") || "docked";
if (!["collapsed", "docked", "floating"].includes(secretaryMode)) secretaryMode = "docked";

const commerceTopbarCopy = {
  "agent-dianxiaomi": {
    eyebrow: "ERP AUTOMATION",
    title: "店小秘自动化上品 · 乳贴 v1.0",
    description: "速卖通半托管（Choice）一键引用模板产品、填固定字段、保存草稿（不发布，等你确认）。准备产品资料（上传图片 + AI 提取事实覆盖字段）为后续 Phase 3。",
    primary: ["进入上品生产", "materials"],
    secondary: ["首页总控台", "v2-home-dashboard"]
  },
  "research-center": {
    eyebrow: "HIT PRODUCT RESEARCH",
    title: "爆款研究中心",
    description: "导入爆款图片 + 经营数据（销量/排名/评分），用 ChatGPT 多模态反向拆解爆款因子，反哺自有 listing。",
    primary: ["去导入第一个爆款", "research-center"],
    secondary: ["业务场景", "business"]
  },
  "v2-home-dashboard": {
    eyebrow: "AI COMMAND CENTER",
    title: "首页总控台",
    description: "帮助打造一人跨境公司。围绕目标、今日工作、业务场景、复盘沉淀和 Agent 协作推进每日经营。",
    primary: ["进入今日工作台", "daily-cockpit"],
    secondary: ["商品运维", "operation-pool"]
  },
  "goal-center": {
    eyebrow: "GOAL CENTER",
    title: "目标中心",
    description: "管理当前阶段目标、本周目标、今日目标和目标进度。第一阶段先做静态目标锚点。",
    primary: ["返回首页总控台", "v2-home-dashboard"],
    secondary: ["今日工作台", "daily-cockpit"]
  },
  "goal-planning": {
    eyebrow: "GOAL PLAN",
    title: "周 / 月 / 阶段目标",
    description: "承接阶段目标拆解，后续再接入目标计划和进度追踪。",
    primary: ["当前目标", "goal-center"],
    secondary: ["首页总控台", "v2-home-dashboard"]
  },
  "goal-decomposition": {
    eyebrow: "GOAL MAP",
    title: "目标拆解",
    description: "把阶段目标拆到今日工作、业务场景动作和复盘节点。当前为 v2.0 占位。",
    primary: ["当前目标", "goal-center"],
    secondary: ["今日工作台", "daily-cockpit"]
  },
  "goal-progress": {
    eyebrow: "GOAL PROGRESS",
    title: "目标进度",
    description: "展示目标达成进度和差距。当前为 v2.0 占位。",
    primary: ["当前目标", "goal-center"],
    secondary: ["今日工作台", "daily-cockpit"]
  },
  "goal-gap": {
    eyebrow: "GOAL GAP",
    title: "目标差距",
    description: "看清距离阶段目标还差什么，再决定下一步进入哪个业务场景补位。",
    primary: ["目标进度", "goal-progress"],
    secondary: ["首页总控台", "v2-home-dashboard"]
  },
  "daily-waiting": {
    eyebrow: "TODAY FOLLOW-UP",
    title: "今日待跟进",
    description: "WaitingItem 归入今日工作台，当前复用每日运营中的等待队列。",
    primary: ["进入每日运营", "daily-cockpit"],
    secondary: ["首页总控台", "v2-home-dashboard"]
  },
  "daily-check": {
    eyebrow: "TODAY CHECK",
    title: "今日复查",
    description: "承接今天需要回看、确认和补动作的事项。当前为 v2.0 占位。",
    primary: ["今日待跟进", "daily-waiting"],
    secondary: ["今日执行记录", "operation-actions"]
  },
  "daily-review": {
    eyebrow: "DAILY REVIEW",
    title: "今日复盘入口",
    description: "收束今日动作、问题、卡点和明日复查。当前为 v2.0 占位。",
    primary: ["今日执行记录", "operation-actions"],
    secondary: ["今日问题 / Issue", "issue-log"]
  },
  "time-record": {
    eyebrow: "TIME RECORD",
    title: "今日时间记录",
    description: "观察时间花在哪里。第一阶段暂不做复杂工时系统。",
    primary: ["进入每日运营", "daily-cockpit"],
    secondary: ["首页总控台", "v2-home-dashboard"]
  },
  "daily-cockpit": {
    eyebrow: "DAILY OPERATION",
    title: "今日驾驶舱",
    description: "让运营按节奏执行、按步骤检查、按证据记录、按日报复盘。",
    primary: ["经营数据总览", "commerce-dashboard"],
    secondary: ["商品运维", "operation-pool"]
  },
  "selection-overview": {
    eyebrow: "PRODUCT DISCOVERY",
    title: "选品开发",
    description: "沉淀市场机会和开发候选，决定哪些方向值得转成具体商品主体。本阶段只做弱入口归位。",
    primary: ["切到上品操作台", "materials"],
    secondary: ["内胆包型雷达", "selection-radar"]
  },
  "selection-radar": {
    eyebrow: "RADAR",
    title: "每日市场选款设计",
    description: "全网热销包型机会雷达、候选分层与一键导入 Listing 工作台。",
    primary: ["上品工作台", "materials"],
    secondary: ["选品开发", "selection-overview"]
  },
  "commerce-dashboard": {
    eyebrow: "BUSINESS REVIEW",
    title: "经营数据总览",
    description: "看经营结果、趋势、风险和数据反馈，再判断哪些业务动作需要复盘或调整。",
    primary: ["商品数据复盘", "operation-review"],
    secondary: ["进入商品作战", "commerce-products"]
  },
  profiles: {
    eyebrow: "PRODUCT OPS",
    title: "商品档案 / 商品中枢",
    description: "管理商品主体、Listing、SKU、运营动作与生命周期，是进入单品业务作战的入口。",
    primary: ["商品中枢", "commerce-products"],
    secondary: ["商品运维", "operation-pool"]
  },
  "commerce-products": {
    eyebrow: "PRODUCT OPS",
    title: "商品档案 / 商品中枢",
    description: "管理商品主体、Listing、SKU、运营动作与生命周期，是单品业务作战入口，不是数据复盘页。",
    primary: ["进入上架接入", "listing-matrix"],
    secondary: ["查看重点商品", "operation-pool"]
  },
  "operation-pool": {
    eyebrow: "PRODUCT OPERATIONS",
    title: "重点商品运营池",
    description: "商品运维负责具体执行、数据采集、动作和复盘；这里聚焦潜力品、爆品和需要跟进的商品。",
    primary: ["商品档案 / 商品中枢", "commerce-products"],
    secondary: ["数据采集 / 数据补录", "data-tasks"]
  },
  "commerce-product-detail": {
    eyebrow: "PRODUCT WAR ROOM",
    title: "单品作战台",
    description: "汇总商品事实、上架接入、SKU 映射、周期数据、动作与复盘入口，用于推进商品从上架、运营到复盘的业务闭环。",
    primary: ["返回重点商品", "operation-pool"],
    secondary: ["商品档案 / 商品中枢", "commerce-products"]
  },
  "listing-matrix": {
    eyebrow: "LISTING ONBOARDING",
    title: "上架接入 / SKU 映射",
    description: "将 Product 绑定到真实店铺 Listing、平台商品 ID、Listing URL 和 SKU Mapping，服务上架、履约、库存与后续运营。",
    primary: ["新增上架映射", "listing-matrix"],
    secondary: ["店铺经营设置", "store-settings"]
  },
  "ad-center": {
    eyebrow: "ADS",
    title: "广告投放",
    description: "承接预算、流量异常、广告调整和投放动作。复盘结果另归数据与复盘中心。",
    primary: ["数据补录", "data-tasks"],
    secondary: ["广告数据复盘", "ad-review"]
  },
  "service-center": {
    eyebrow: "SERVICE",
    title: "售后 / 订单",
    description: "承接订单、发货、客服、纠纷和退款异常。当前归入每日运营巡检。",
    primary: ["今日驾驶舱", "daily-cockpit"],
    secondary: ["首页总控台", "v2-home-dashboard"]
  },
  "inventory-center": {
    eyebrow: "SUPPLY",
    title: "库存 / 供应链",
    description: "承接低库存、断货、超龄库存和供应风险。当前归入每日运营与商品运维。",
    primary: ["商品运维", "operation-pool"],
    secondary: ["今日驾驶舱", "daily-cockpit"]
  },
  "data-tasks": {
    eyebrow: "DATA FILL-IN",
    title: "数据采集 / 数据补录",
    description: "补齐商品、Listing、广告和周期经营数据，支撑后续运营判断和复盘，不是数据复盘主入口。",
    primary: ["今日执行记录", "operation-actions"],
    secondary: ["上架接入", "listing-matrix"]
  },
  "operation-actions": {
    eyebrow: "TODAY ACTIONS",
    title: "今日执行记录",
    description: "记录今天做了什么、为什么做、后续看什么指标。它是业务执行证据，不是单纯复盘结论。",
    primary: ["动作效果复盘", "action-review"],
    secondary: ["数据采集 / 数据补录", "data-tasks"]
  },
  "operation-review": {
    eyebrow: "PRODUCT REVIEW",
    title: "商品数据复盘",
    description: "看商品表现、动作结果和下一周期判断，沉淀商品复盘结论。",
    primary: ["动作效果复盘", "action-review"],
    secondary: ["经营数据总览", "commerce-dashboard"]
  },
  "issue-log": {
    eyebrow: "TODAY ISSUES",
    title: "今日问题 / Issue",
    description: "记录执行中发现的问题、责任人、等待事项和下次复查。问题复盘另归数据与复盘中心。",
    primary: ["今日驾驶舱", "daily-cockpit"],
    secondary: ["Issue / 问题复盘", "issue-review"]
  },
  "ad-review": {
    eyebrow: "ADS REVIEW",
    title: "广告数据复盘",
    description: "看广告花费、流量、转化和动作结果，形成下一轮投放判断。当前为 v2.0 占位。",
    primary: ["广告投放", "ad-center"],
    secondary: ["经营数据总览", "commerce-dashboard"]
  },
  "action-review": {
    eyebrow: "ACTION REVIEW",
    title: "动作效果复盘",
    description: "分析运营动作是否有效、是否放大、停止或改方向，只承接复盘视角。",
    primary: ["商品数据复盘", "operation-review"],
    secondary: ["今日执行记录", "operation-actions"]
  },
  "issue-review": {
    eyebrow: "ISSUE REVIEW",
    title: "Issue / 问题复盘",
    description: "看问题复发、原因、处理结果和可沉淀规则，不替代今日问题处理。",
    primary: ["今日问题 / Issue", "issue-log"],
    secondary: ["复盘结论沉淀", "review-insights"]
  },
  "data-quality-review": {
    eyebrow: "DATA QUALITY",
    title: "数据质量审核",
    description: "审核数据是否完整、可信、可用于趋势判断和复盘；补录动作仍在业务场景中心。",
    primary: ["数据采集 / 数据补录", "data-tasks"],
    secondary: ["经营数据总览", "commerce-dashboard"]
  },
  "weekly-review": {
    eyebrow: "WEEKLY REVIEW",
    title: "周复盘",
    description: "看一周结果、动作效果、问题复发和目标差距，当前为 v2.0 占位。",
    primary: ["经营数据总览", "commerce-dashboard"],
    secondary: ["复盘结论沉淀", "review-insights"]
  },
  "monthly-review": {
    eyebrow: "MONTHLY REVIEW",
    title: "月复盘",
    description: "看月度经营结果、趋势变化和下一阶段目标差距，当前为 v2.0 占位。",
    primary: ["经营数据总览", "commerce-dashboard"],
    secondary: ["目标差距", "goal-gap"]
  },
  "review-insights": {
    eyebrow: "REVIEW INSIGHTS",
    title: "复盘结论沉淀",
    description: "把复盘确认有效的结论转成 SOP、Prompt、Skill 或自动化候选。",
    primary: ["知识与能力沉淀", "knowledge-center"],
    secondary: ["动作效果复盘", "action-review"]
  },
  "knowledge-center": {
    eyebrow: "LOOP ENGINEERING",
    title: "知识与能力沉淀",
    description: "沉淀 SOP、Prompt、Skills、知识库和自动化候选，让系统越用越聪明。",
    primary: ["Prompt 库", "prompt-library"],
    secondary: ["工具与 Agent", "agent-center"]
  },
  "prompt-library": {
    eyebrow: "PROMPTS",
    title: "Prompt 库",
    description: "沉淀高频 AI 协作方式，避免每次重新写 Prompt。",
    primary: ["SOP 库", "knowledge-center"],
    secondary: ["Skills", "skill-library"]
  },
  "skill-library": {
    eyebrow: "SKILLS",
    title: "Skills",
    description: "把成熟流程封装成可复用能力。当前为 v2.0 占位。",
    primary: ["Loop Engineering", "loop-engineering"],
    secondary: ["SOP 库", "knowledge-center"]
  },
  "knowledge-base": {
    eyebrow: "KNOWLEDGE",
    title: "知识库",
    description: "保存平台规则、商品经验、历史判断和业务资料。当前为 v2.0 占位。",
    primary: ["SOP 库", "knowledge-center"],
    secondary: ["首页总控台", "v2-home-dashboard"]
  },
  "loop-engineering": {
    eyebrow: "LOOP",
    title: "Loop Engineering",
    description: "让系统从执行记录和复盘沉淀中持续升级能力。",
    primary: ["自动化候选", "automation-candidates"],
    secondary: ["Skills", "skill-library"]
  },
  "automation-candidates": {
    eyebrow: "AUTOMATION",
    title: "自动化候选",
    description: "记录可被 Heartbeat / Scheduler 调度的候选动作。当前不做自动执行。",
    primary: ["Loop Engineering", "loop-engineering"],
    secondary: ["首页总控台", "v2-home-dashboard"]
  },
  "agent-center": {
    eyebrow: "TOOLS & AGENTS",
    title: "工具与 Agent",
    description: "统一管理外部工具和 Agent 入口。第一版只做说明和入口归位。",
    primary: ["首页总控台", "v2-home-dashboard"],
    secondary: ["系统设置", "system-status"]
  },
  "agent-chatgpt": {
    eyebrow: "AGENT",
    title: "ChatGPT",
    description: "用于战略、复盘、分析和 Prompt 生成。当前不接 OpenAI API。",
    primary: ["工具总览", "agent-center"],
    secondary: ["Prompt 库", "prompt-library"]
  },
  "agent-codex": {
    eyebrow: "AGENT",
    title: "Codex",
    description: "用于本地代码与系统实现。当前不做自动调度。",
    primary: ["工具总览", "agent-center"],
    secondary: ["首页总控台", "v2-home-dashboard"]
  },
  "agent-qclaw": {
    eyebrow: "AGENT",
    title: "QClaw",
    description: "用于桌面执行、店小秘填报等本机操作。当前仅保留入口。",
    primary: ["工具总览", "agent-center"],
    secondary: ["店小秘", "agent-dianxiaomi"]
  },
  "agent-marvis": {
    eyebrow: "AGENT",
    title: "Marvis",
    description: "用于网页执行和后台操作。当前仅保留入口。",
    primary: ["工具总览", "agent-center"],
    secondary: ["Chrome AI", "agent-chrome-ai"]
  },
  "agent-chrome-ai": {
    eyebrow: "AGENT",
    title: "Chrome AI",
    description: "用于网页识别和商品调研。当前不接网页识别自动化。",
    primary: ["工具总览", "agent-center"],
    secondary: ["选品开发", "selection-overview"]
  },
  "agent-dianxiaomi": {
    eyebrow: "TOOL",
    title: "店小秘",
    description: "用于 ERP、订单和库存。当前不接账号和外部 API。",
    primary: ["工具总览", "agent-center"],
    secondary: ["店铺经营设置", "store-settings"]
  },
  "agent-image-tools": {
    eyebrow: "TOOL",
    title: "图片工具",
    description: "用于主图、详情图和视觉素材。当前通过上品生产和 Listing 图片生成入口使用。",
    primary: ["做图 / 视觉", "images"],
    secondary: ["工具总览", "agent-center"]
  },
  "agent-ad-tools": {
    eyebrow: "TOOL",
    title: "广告工具",
    description: "用于直通车、广告诊断和投放复盘。投放动作归业务场景，复盘归数据与复盘中心。",
    primary: ["广告投放", "ad-center"],
    secondary: ["工具总览", "agent-center"]
  },
  "personal-center": {
    eyebrow: "PERSONAL",
    title: "个人效率",
    description: "后置模块，未来承接日记、个人待办、时间记录和个人复盘。",
    primary: ["首页总控台", "v2-home-dashboard"],
    secondary: ["今日工作台", "daily-cockpit"]
  },
  diary: {
    eyebrow: "PERSONAL",
    title: "日记",
    description: "后置模块，占位。第一阶段不做真实功能。",
    primary: ["个人效率", "personal-center"],
    secondary: ["首页总控台", "v2-home-dashboard"]
  },
  "personal-todo": {
    eyebrow: "PERSONAL",
    title: "个人待办",
    description: "后置模块，占位。第一阶段不做真实功能。",
    primary: ["个人效率", "personal-center"],
    secondary: ["首页总控台", "v2-home-dashboard"]
  },
  "personal-time": {
    eyebrow: "PERSONAL",
    title: "个人时间记录",
    description: "后置模块，占位。第一阶段不做真实功能。",
    primary: ["个人效率", "personal-center"],
    secondary: ["时间记录", "time-record"]
  },
  "personal-review": {
    eyebrow: "PERSONAL",
    title: "个人复盘",
    description: "后置模块，占位。第一阶段不做真实功能。",
    primary: ["个人效率", "personal-center"],
    secondary: ["今日复盘", "daily-review"]
  },
  "store-settings": {
    eyebrow: "STORE OPS SETTINGS",
    title: "店铺经营设置",
    description: "维护店铺经营资料、店铺状态、店铺别名和业务启用状态；本地运行和输出路径归系统设置。",
    primary: ["上架接入 / SKU 映射", "listing-matrix"],
    secondary: ["上架接入", "listing-matrix"]
  },
  "system-status": {
    eyebrow: "LOCAL SYSTEM",
    title: "本地运行状态",
    description: "查看本地服务、运行状态和技术健康信息。这里不承载店铺经营资料。",
    primary: ["AI 同步状态", "sync-status"],
    secondary: ["首页总控台", "v2-home-dashboard"]
  },
  "sync-status": {
    eyebrow: "SYNC STATUS",
    title: "AI 同步状态",
    description: "查看 AI / 本地任务同步状态和手动同步入口，属于低频技术配置。",
    primary: ["本地运行状态", "system-status"],
    secondary: ["高级设置", "advanced-settings"]
  },
  "output-folder": {
    eyebrow: "OUTPUT PATH",
    title: "输出文件夹",
    description: "定位本地生成内容和输出路径，属于系统技术配置。",
    primary: ["本地运行状态", "system-status"],
    secondary: ["环境配置", "environment-settings"]
  },
  "advanced-settings": {
    eyebrow: "ADVANCED SETTINGS",
    title: "高级设置",
    description: "承接 Prompt、高级参数和低频技术配置，不承载核心业务资料。",
    primary: ["环境配置", "environment-settings"],
    secondary: ["本地运行状态", "system-status"]
  },
  "environment-settings": {
    eyebrow: "ENV SETTINGS",
    title: "环境配置",
    description: "承接本地运行、浏览器环境和技术配置；店铺经营资料归业务场景中心。",
    primary: ["高级设置", "advanced-settings"],
    secondary: ["店铺经营设置", "store-settings"]
  }
};

const productSourceCopy = {
  new_product_development: {
    label: "新开发新品",
    hint: "请上传产品素材，开始 AI 识别",
    nextAction: "请上传产品素材，开始 AI 识别"
  },
  live_legacy_import: {
    label: "已上架老品补录",
    hint: "请使用上架接入与 SKU 映射里的“创建老品档案并接入”。",
    nextAction: "补齐 SKU 映射并录入首个 7 天周期数据"
  },
  asset_ready_pending_listing: {
    label: "已有素材待上架",
    hint: "建档后进入商品中枢，下一步去上架接入。",
    nextAction: "去上架接入"
  },
  inventory_driven: {
    label: "现货库存驱动商品",
    hint: "建档后进入商品中枢，下一步创建链接或绑定已有链接。",
    nextAction: "创建链接或绑定已有链接"
  }
};

const productSourceEntryReasons = {
  new_product_development: "新开发新品建档",
  live_legacy_import: "已在售老品补建档",
  asset_ready_pending_listing: "已有素材，等待上架接入",
  inventory_driven: "现货库存驱动建档"
};

const dailyRiskLevels = [
  "P0：今天必须处理，否则可能扣分、投诉、断货、亏损、权限受限。",
  "P1：今天建议处理，会影响转化、利润、数据判断。",
  "P2：记录观察，不立刻动作。"
];

// F1-A only ships static SOP templates. F1-B runs them by store, F1-C creates
// WaitingItems from SOP steps, and F1-D summarizes SOP execution into reports.
const DAILY_OPERATION_SOP_TEMPLATES = [
  {
    task_id: "store-risk-check",
    task_name: "店铺红线巡检",
    task_level: "P0 first",
    layer: "风险底线",
    applicable_scope: ["store"],
    why: "先保命，确认店铺今天有没有影响经营权限、流量、活动、履约或资金安全的红线风险。",
    why_now: "红线问题不处理，后续商品优化、广告投放、选品开发都没有意义。",
    input_context: ["store", "platform_notice", "account_health", "appeal_ticket"],
    steps: [
      {
        step_id: "store-risk-platform-notice",
        step_name: "查看平台通知 / 站内信",
        objective: "确认今天是否存在影响店铺经营权限的红线风险。",
        data_source: "AliExpress 后台 / 店铺通知 / 站内信",
        field_to_check: ["处罚通知", "限流通知", "侵权通知", "资质通知", "保证金通知"],
        how_to_check: "逐店打开后台通知与账户健康，优先筛选今天新增或未处理通知。",
        judgement_standard: { p0: "影响交易、发布、提现、广告或店铺权限。", p1: "24 小时内需要处理的申诉、工单、处罚提醒。", p2: "普通提醒或不影响经营的通知。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["平台红线", "权限受限", "侵权", "资质异常", "保证金异常"],
        next_actions: ["创建 Issue", "加入 WaitingItem", "记录处理 ActionLog", "加入明日复查"],
        actionlog_trigger: "已提交申诉、已修改违规商品、已补充资质或保证金。",
        issue_trigger: "处罚原因不明、权限受限、侵权投诉、店铺冻结。",
        waiting_trigger: "需要等待平台审核、小二回复或主管确认。",
        no_action_reason_options: ["无新增违规", "仅普通提醒", "已由他人处理", "数据暂不可用"],
        follow_up_rule: "P0/P1 未关闭时，明日必须复查。",
        completion_standard: "所有店铺红线状态已查看；P0/P1 已记录 Issue 或 WaitingItem；无异常时有无动作原因。",
        target_view: "store-settings",
        required_context: ["store_id", "store_name"]
      },
      {
        step_id: "store-risk-account-health",
        step_name: "核对账户健康 / 违规分",
        objective: "判断店铺健康是否影响流量、活动和商品发布。",
        data_source: "AliExpress 账户健康 / 违规中心",
        field_to_check: ["违规分", "知识产权风险", "商品屏蔽", "服务分", "活动资格"],
        how_to_check: "对比昨天记录和平台健康页，优先看新增扣分、屏蔽、活动资格变化。",
        judgement_standard: { p0: "新增扣分、商品屏蔽、活动资格受限或服务分触发平台红线。", p1: "健康分明显下降但尚未限制权限。", p2: "普通波动且不影响经营。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["违规扣分", "商品屏蔽", "服务分异常", "活动受限"],
        next_actions: ["定位违规对象", "创建 Issue", "记录处理动作"],
        actionlog_trigger: "已下架/修改违规商品、已提交证明材料。",
        issue_trigger: "无法确认违规对象或健康分异常原因。",
        waiting_trigger: "等待平台审核、等待主管确认申诉材料。",
        no_action_reason_options: ["健康状态正常", "仅轻微波动", "已在申诉处理中"],
        follow_up_rule: "健康分下降或申诉处理中，明日复查。",
        completion_standard: "账户健康和违规项已核对，异常有处理记录。",
        target_view: "store-settings",
        required_context: ["store_id"]
      },
      {
        step_id: "store-risk-permission",
        step_name: "确认核心经营权限",
        objective: "确认发布、交易、广告、提现和物流权限没有被限制。",
        data_source: "平台店铺状态 / 权限页 / 广告后台 / 资金页",
        field_to_check: ["发布权限", "交易权限", "广告权限", "提现权限", "物流履约权限"],
        how_to_check: "逐项确认核心权限状态；任一权限异常，先暂停普通优化。",
        judgement_standard: { p0: "交易、发布、提现、广告任一权限受限。", p1: "权限即将到期或需补材料。", p2: "状态正常。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["发布受限", "交易受限", "广告受限", "提现受限", "物流权限异常"],
        next_actions: ["创建 Issue", "暂停普通优化", "加入明日复查"],
        actionlog_trigger: "已补材料、已提交工单、已调整相关商品。",
        issue_trigger: "核心权限受限或原因不明。",
        waiting_trigger: "等待平台、小二、财务或主管确认。",
        no_action_reason_options: ["权限全部正常", "权限问题已处理", "无需今日动作"],
        follow_up_rule: "权限未恢复前每日复查。",
        completion_standard: "核心权限全部有状态判断，异常已进入 Issue/Waiting。",
        target_view: "store-settings",
        required_context: ["store_id", "permission_type"]
      },
      {
        step_id: "store-risk-appeal",
        step_name: "检查申诉 / 工单倒计时",
        objective: "避免申诉超时导致处罚固化。",
        data_source: "申诉中心 / 工单中心 / 平台消息",
        field_to_check: ["申诉截止时间", "工单状态", "平台回复", "补充材料要求"],
        how_to_check: "筛选未关闭申诉和工单，按截止时间排序。",
        judgement_standard: { p0: "已逾期或当天截止且影响权限。", p1: "24 小时内需要补充材料。", p2: "等待平台处理中。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["申诉到期", "工单待处理", "材料缺失"],
        next_actions: ["补充材料", "创建 WaitingItem", "明日复查"],
        actionlog_trigger: "已补充申诉材料或回复工单。",
        issue_trigger: "申诉资料缺失、责任人不明确、已逾期。",
        waiting_trigger: "等待平台审核、主管材料确认、小二回复。",
        no_action_reason_options: ["无待处理申诉", "申诉仍在平台处理中", "材料已提交"],
        follow_up_rule: "未关闭申诉必须进入明日复查。",
        completion_standard: "所有申诉/工单已查看，临期事项有动作或等待项。",
        target_view: "store-settings",
        required_context: ["store_id", "ticket_id"]
      }
    ],
    risk_levels: dailyRiskLevels,
    completion_standard: ["所有店铺红线状态已查看。", "P0/P1 已记录 Issue 或 WaitingItem。", "无异常时有无动作原因。"],
    possible_action_logs: ["提交申诉", "补充资质", "处理平台通知", "调整违规商品", "联系平台客服"],
    possible_issues: ["平台违规待处理", "资质即将过期", "店铺健康分异常", "活动权限受限", "物流履约权限异常"],
    possible_waiting_items: ["等待平台审核", "等待小二回复", "等待主管确认", "等待资质材料"],
    no_action_reasons: ["今日无平台通知或红线风险", "风险已由平台处理中", "需要主管确认后处理", "等待平台审核结果"],
    tomorrow_followups: ["申诉是否通过", "资质是否审核完成", "店铺健康分是否恢复", "平台通知是否关闭"],
    manager_summary_hint: "是否存在 P0 红线风险、是否已处理、是否需要主管介入。"
  },
  {
    task_id: "order-fulfillment-service",
    task_name: "订单 / 发货 / 客服异常处理",
    task_level: "P0/P1 service risk",
    layer: "风险底线",
    applicable_scope: ["store", "order", "service"],
    why: "先处理履约和服务风险，避免超时、投诉、纠纷、退款和服务分下降。",
    why_now: "订单、发货、客服、纠纷、退款是当天最容易爆雷的事项，必须在商品优化和广告动作之前处理。",
    input_context: ["store", "order", "message", "dispute", "logistics"],
    steps: [
      {
        step_id: "order-check-shipping",
        step_name: "查看待发货 / 临近超时订单",
        objective: "避免发货超时和履约扣分。",
        data_source: "AliExpress 订单后台 / 店小秘订单列表",
        field_to_check: ["待发货订单", "发货截止时间", "仓库状态", "异常订单备注"],
        how_to_check: "按发货截止时间升序筛选待发货订单，优先处理今天到期和已逾期订单。",
        judgement_standard: { p0: "已超时或当天截止且仓库未处理。", p1: "24 小时内截止或仓库状态不明确。", p2: "仍在正常履约周期。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["发货超时", "仓库未处理", "履约风险"],
        next_actions: ["催仓发货", "创建 WaitingItem", "记录 ActionLog"],
        actionlog_trigger: "已催仓、已改物流、已联系买家或供应商。",
        issue_trigger: "订单已超时、仓库无法发货、订单状态冲突。",
        waiting_trigger: "等待仓库发货、供应商补发或物流反馈。",
        no_action_reason_options: ["无临期订单", "订单仍在正常时限内", "仓库已处理"],
        follow_up_rule: "临期和超时订单明日必须复查发货状态。",
        completion_standard: "待发货订单已筛查，P0/P1 有动作或等待项。",
        target_view: "daily-cockpit",
        required_context: ["store_id", "order_id"]
      },
      {
        step_id: "order-check-service-message",
        step_name: "查看客服未回复和买家催发",
        objective: "降低投诉、差评和纠纷风险。",
        data_source: "消息中心 / 客服后台",
        field_to_check: ["未读消息", "催发消息", "退款倾向", "差评风险词"],
        how_to_check: "筛选未回复消息，优先处理投诉、退款、催发、差评关键词。",
        judgement_standard: { p0: "涉及退款、纠纷、差评或平台介入。", p1: "超过店铺响应要求或买家二次催促。", p2: "普通咨询且未超时。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["客服积压", "买家催发", "差评风险", "退款倾向"],
        next_actions: ["回复买家", "创建 Issue", "加入明日复查"],
        actionlog_trigger: "已回复买家、已解释物流、已提供解决方案。",
        issue_trigger: "买家明确投诉、退款、差评或问题原因不明。",
        waiting_trigger: "等待买家回复、仓库反馈或主管确认话术。",
        no_action_reason_options: ["无未回复消息", "仅普通咨询", "已回复等待买家"],
        follow_up_rule: "P0/P1 客服问题次日复查买家回复。",
        completion_standard: "未回复消息已处理或进入等待。",
        target_view: "daily-cockpit",
        required_context: ["store_id", "message_id"]
      },
      {
        step_id: "order-check-dispute-refund",
        step_name: "检查纠纷 / 退款 / 售后",
        objective: "避免售后升级影响服务分和资金。",
        data_source: "纠纷中心 / 退款售后页面",
        field_to_check: ["纠纷状态", "退款原因", "处理倒计时", "平台介入状态"],
        how_to_check: "按倒计时排序未关闭售后，优先处理平台介入和高金额订单。",
        judgement_standard: { p0: "平台介入、已逾期或金额高且责任不明。", p1: "24 小时内需要处理。", p2: "等待买家或平台处理。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["纠纷", "退款", "平台介入", "售后倒计时"],
        next_actions: ["提交凭证", "处理退款", "创建 Issue"],
        actionlog_trigger: "已提交凭证、已同意退款、已拒绝退款并说明原因。",
        issue_trigger: "退款原因异常、责任不明、售后集中出现。",
        waiting_trigger: "等待平台裁决、买家举证、仓库/物流证明。",
        no_action_reason_options: ["无未处理售后", "售后等待平台", "已提交凭证"],
        follow_up_rule: "未结案售后每日复查。",
        completion_standard: "未关闭售后均有处理状态或等待项。",
        target_view: "daily-cockpit",
        required_context: ["store_id", "order_id", "case_id"]
      },
      {
        step_id: "order-check-logistics",
        step_name: "检查物流异常和集中售后商品",
        objective: "识别是否有物流链路或商品质量系统性问题。",
        data_source: "物流异常页 / 订单列表 / 售后原因",
        field_to_check: ["揽收失败", "长时间未更新", "退回", "同商品售后集中"],
        how_to_check: "按物流状态和商品聚合异常订单，判断是否是个别订单还是商品/仓库问题。",
        judgement_standard: { p0: "同商品或同仓库集中异常，影响服务分。", p1: "单个订单长时间未更新或买家投诉。", p2: "物流正常波动。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["物流异常", "集中售后", "仓库问题", "商品质量问题"],
        next_actions: ["联系仓库", "创建 Issue", "进入商品数据巡检"],
        actionlog_trigger: "已联系仓库/物流、已为商品打售后风险标签。",
        issue_trigger: "集中售后、物流链路异常、商品质量疑似问题。",
        waiting_trigger: "等待仓库、物流商、供应商反馈。",
        no_action_reason_options: ["无物流异常", "仅单个订单观察", "已进入售后处理"],
        follow_up_rule: "物流异常未恢复时明日复查。",
        completion_standard: "物流异常已判断个案/系统性，必要时创建 Issue。",
        target_view: "daily-cockpit",
        required_context: ["store_id", "order_id", "product_id"]
      }
    ],
    risk_levels: dailyRiskLevels,
    completion_standard: ["所有 P0 履约和服务风险已处理。", "无法处理的事项已创建 Issue 并标记责任人。", "无异常则记录“今日无履约和客服异常”。"],
    possible_action_logs: ["催仓发货", "回复买家", "处理退款", "处理纠纷", "更新物流信息", "联系供应商补发"],
    possible_issues: ["发货超时风险", "客服未回复", "纠纷待处理", "退款原因异常", "物流异常", "商品集中售后风险"],
    possible_waiting_items: ["等待仓库发货", "等待物流反馈", "等待买家回复", "等待平台裁决"],
    no_action_reasons: ["今日无待处理异常", "订单仍在正常履约时限内", "等待仓库反馈", "等待买家回复", "等待平台处理"],
    tomorrow_followups: ["超时订单是否已发出", "纠纷是否关闭", "买家是否回复", "物流是否更新", "售后商品是否需要进入商品数据巡检"],
    manager_summary_hint: "今日履约和服务风险是否清零，未清零原因是什么。"
  },
  {
    task_id: "product-data-tagging",
    task_name: "商品数据巡检与商品打标",
    task_level: "business judgement",
    layer: "经营状态",
    applicable_scope: ["product", "listing"],
    why: "识别哪些商品正在变好、变差、异常、值得优化、值得观察或需要淘汰。",
    why_now: "处理完店铺和履约风险后，要回到商品表现。商品是运营动作的主要对象。",
    input_context: ["product", "listing", "snapshot", "operation_profile"],
    steps: [
      {
        step_id: "product-check-core-metrics",
        step_name: "查看昨日与近 7 日商品表现",
        objective: "识别曝光、点击、转化和订单的异常变化。",
        data_source: "商品中枢 / 周期数据 Snapshot / 平台商品分析",
        field_to_check: ["曝光", "点击", "CTR", "订单", "CVR", "销售额", "退款率"],
        how_to_check: "按重点商品和昨日异常排序，对比当前值、商品近 7 日均值、店铺同类商品均值和人工阈值。",
        judgement_standard: { p0: "核心商品订单/转化断崖且影响销售，或退款/纠纷异常集中。", p1: "CTR/CVR/曝光明显低于商品近 7 日均值或店铺同类均值。", p2: "样本不足或轻微波动，记录观察。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["曝光异常", "点击异常", "转化异常", "退款异常", "数据不足"],
        next_actions: ["商品打标", "创建 Issue", "进入重点链接优化"],
        actionlog_trigger: "已调整商品标签、优先级或创建数据采集任务。",
        issue_trigger: "商品无周期数据、核心指标异常但原因不明。",
        waiting_trigger: "等待数据回传、运营确认或供应链确认。",
        no_action_reason_options: ["数据正常", "样本太小", "已有动作在观察期"],
        follow_up_rule: "异常商品明日继续看同一指标是否恢复。",
        completion_standard: "重点商品核心指标已判断并打标。",
        target_view: "commerce-products",
        required_context: ["product_id", "listing_id"]
      },
      {
        step_id: "product-tag-potential",
        step_name: "标记潜力品 / 爆品 / 回落风险",
        objective: "把商品状态转成运营优先级。",
        data_source: "商品中枢 / operation-profile / 商品池",
        field_to_check: ["商品标签", "生命周期", "近期动作", "近 7 日趋势"],
        how_to_check: "结合趋势和历史动作，给商品标记潜力品、爆品、继续观察、回落风险、待淘汰。",
        judgement_standard: { p0: "爆品回落且无防守动作。", p1: "潜力品有增长信号但未安排动作。", p2: "数据不足或观察中。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["潜力品未动作", "爆品回落", "待淘汰", "继续观察"],
        next_actions: ["调整商品标签", "加入任务 6", "明日复查"],
        actionlog_trigger: "已标记商品状态或调整今日运营优先级。",
        issue_trigger: "商品阶段和真实经营状态不一致。",
        waiting_trigger: "等待主管确认商品优先级。",
        no_action_reason_options: ["标签无需调整", "已有动作观察中", "数据不足"],
        follow_up_rule: "潜力品和回落风险商品明日复查。",
        completion_standard: "重点商品有明确标签和下一步。",
        target_view: "operation-pool",
        required_context: ["product_id"]
      },
      {
        step_id: "product-check-data-gap",
        step_name: "检查数据缺口",
        objective: "确认商品判断是否缺 Listing、SKU、Snapshot 或动作数据。",
        data_source: "商品中枢 / 上架接入 / 数据采集任务",
        field_to_check: ["Listing Card", "SKU Mapping", "Snapshot", "ActionLog", "Review"],
        how_to_check: "进入商品中枢，逐项确认事实层是否完整。",
        judgement_standard: { p0: "重点商品缺 Listing/SKU 导致无法经营判断。", p1: "缺 Snapshot 或动作复盘，影响今日判断。", p2: "非重点商品资料不完整。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["缺 Listing", "缺 SKU", "缺 Snapshot", "缺复盘"],
        next_actions: ["创建数据采集任务", "进入上架接入", "创建 Issue"],
        actionlog_trigger: "已创建数据采集任务或补齐接入记录。",
        issue_trigger: "关键商品缺失必要经营资料。",
        waiting_trigger: "等待平台 ID、SKU、数据或人工确认。",
        no_action_reason_options: ["数据完整", "非重点商品暂缓", "等待周期数据"],
        follow_up_rule: "缺数据商品明日检查补齐状态。",
        completion_standard: "数据缺口已补齐、建任务或说明无法补齐原因。",
        target_view: "data-tasks",
        required_context: ["product_id", "listing_id"]
      },
      {
        step_id: "product-route-next-action",
        step_name: "把异常商品路由到动作或复查",
        objective: "让巡检结果进入动作链路，而不是停在观察。",
        data_source: "今日驾驶舱 / 商品中枢 / ActionLog",
        field_to_check: ["商品标签", "异常指标", "下一步动作", "review_due_at"],
        how_to_check: "对每个异常商品决定：立即动作、创建问题、加入等待、记录无动作原因或明日复查。",
        judgement_standard: { p0: "P0 商品没有动作/问题/等待承接。", p1: "P1 商品没有复查规则。", p2: "观察商品有无动作原因即可。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["未闭环", "无复查", "无动作原因"],
        next_actions: ["进入任务 6", "创建 Issue", "加入明日复查"],
        actionlog_trigger: "已安排商品优化或数据补齐动作。",
        issue_trigger: "异常原因不明或缺数据无法判断。",
        waiting_trigger: "等待数据、主管、供应链或平台反馈。",
        no_action_reason_options: ["继续观察", "数据不足", "已有动作观察中"],
        follow_up_rule: "所有异常商品必须有明日或指定日期复查。",
        completion_standard: "异常商品均有输出之一：ActionLog/Issue/Waiting/无动作/复查。",
        target_view: "operation-pool",
        required_context: ["product_id"]
      }
    ],
    risk_levels: dailyRiskLevels,
    completion_standard: ["已识别今日重点商品。", "每个异常商品至少有一个标签。", "需要动作的商品进入任务 6。", "缺数据商品进入 Issue 或数据采集任务。"],
    possible_action_logs: ["标记重点优化", "标记继续观察", "标记回落风险", "标记待淘汰", "创建数据采集任务"],
    possible_issues: ["商品无周期数据", "商品缺 SKU Mapping", "曝光异常", "点击异常", "转化异常", "退款异常"],
    possible_waiting_items: ["等待数据回传", "等待 SKU 确认", "等待主管确认商品优先级"],
    no_action_reasons: ["商品数据正常，继续观察", "数据不足，暂不判断", "已有动作在观察期，避免重复干预", "等待下一周期数据", "商品暂无足够曝光"],
    tomorrow_followups: ["今日打标商品明日是否继续异常", "重点优化商品是否进入动作", "数据缺口是否补齐", "回落商品是否继续下滑"],
    manager_summary_hint: "哪些商品被打标，哪些进入动作，哪些只是继续观察。"
  },
  {
    task_id: "ads-traffic-check",
    task_name: "广告与流量巡检",
    task_level: "relative metric judgement",
    layer: "经营状态",
    applicable_scope: ["ad_plan", "product", "listing"],
    why: "检查广告和流量是否异常，判断钱有没有花错、流量有没有断层、ROI 是否失控。",
    why_now: "广告动作必须建立在商品表现之后。先知道商品状态，再判断广告和流量是否正常。",
    input_context: ["ad_plan", "product", "listing", "snapshot"],
    steps: [
      {
        step_id: "ads-check-spend-roi",
        step_name: "查看广告花费与 ROI",
        objective: "确认广告是否烧钱无转化或超出目标回报。",
        data_source: "AliExpress 直通车后台 / 广告计划数据 / performance snapshots",
        field_to_check: ["花费", "订单", "销售额", "ROI", "预算消耗"],
        how_to_check: "按广告计划和推广商品对比今日/昨日值、近 7 日均值、店铺目标 ROI 和人工预算阈值。",
        judgement_standard: { p0: "花费明显高于近 7 日均值且无订单，或超过人工预算红线。", p1: "ROI 低于店铺目标或同类商品均值，且样本量足够。", p2: "预算小或观察期不足，记录观察。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["广告烧钱", "ROI 异常", "预算过快", "样本不足"],
        next_actions: ["降预算", "暂停广告", "创建 Issue", "明日复查"],
        actionlog_trigger: "已调预算、暂停计划或调整推广商品。",
        issue_trigger: "广告花费失控、ROI 异常但原因不明。",
        waiting_trigger: "等待主管确认预算或广告数据回传。",
        no_action_reason_options: ["广告仍在观察期", "预算太小", "数据正常", "等待主管确认"],
        follow_up_rule: "预算或计划调整后，明日复查花费、订单和 ROI。",
        completion_standard: "广告花费与 ROI 已判断，异常有动作或等待项。",
        target_view: "ad-center",
        required_context: ["store_id", "product_id", "ad_plan_id"]
      },
      {
        step_id: "ads-check-ctr-cpc",
        step_name: "检查 CTR / CPC / 搜索词质量",
        objective: "判断问题来自素材点击、出价竞争还是流量不相关。",
        data_source: "广告后台 / 搜索词数据 / 商品周期数据",
        field_to_check: ["CTR", "CPC", "搜索词", "曝光", "点击"],
        how_to_check: "对比当前 CTR/CPC 与商品近 7 日均值、店铺同类商品均值和人工关键词目标。",
        judgement_standard: { p0: "CPC 异常上涨且持续消耗，CTR 同时明显低于历史均值。", p1: "CTR 明显低于近 7 日或同类均值，搜索词不相关。", p2: "轻微波动或点击样本不足。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["CTR 低", "CPC 高", "搜索词不相关", "流量质量差"],
        next_actions: ["否词", "调出价", "进入重点链接优化", "记录观察"],
        actionlog_trigger: "已否词、调出价、改关键词或安排主图/标题优化。",
        issue_trigger: "搜索词持续不相关或点击异常原因不明。",
        waiting_trigger: "等待广告后台数据回传或主管确认关键词策略。",
        no_action_reason_options: ["点击样本不足", "CTR 正常", "已有动作观察中"],
        follow_up_rule: "关键词/出价调整后明日复查 CTR、CPC。",
        completion_standard: "广告点击质量已判断，问题来源已归因。",
        target_view: "ad-center",
        required_context: ["ad_plan_id", "keyword"]
      },
      {
        step_id: "ads-check-product-fit",
        step_name: "对照商品状态判断广告还是承接问题",
        objective: "避免把商品承接问题误判成广告问题。",
        data_source: "商品中枢 / 商品标签 / 广告数据",
        field_to_check: ["商品标签", "库存", "价格", "评价", "主图", "CVR"],
        how_to_check: "把广告异常商品与任务 3 商品标签、库存和 Listing 状态对照。",
        judgement_standard: { p0: "商品库存/红线/售后风险导致不应继续投放。", p1: "点击正常但 CVR 低于近 7 日或同类均值，优先查承接。", p2: "商品状态正常，继续看广告维度。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["承接问题", "库存限制", "Listing 问题", "商品风险"],
        next_actions: ["进入任务 6", "暂停投放", "创建 Issue"],
        actionlog_trigger: "已把广告异常转为 Listing/商品优化动作。",
        issue_trigger: "商品状态限制广告但责任对象不清。",
        waiting_trigger: "等待库存、素材、价格或主管确认。",
        no_action_reason_options: ["商品承接正常", "已有链接动作观察中", "数据不足"],
        follow_up_rule: "承接优化后复查广告 ROI、CTR、CVR。",
        completion_standard: "广告异常已区分为流量问题或商品承接问题。",
        target_view: "operation-pool",
        required_context: ["product_id", "listing_id"]
      },
      {
        step_id: "ads-record-decision",
        step_name: "记录广告动作或无动作原因",
        objective: "让广告判断进入动作证据链。",
        data_source: "今日驾驶舱 / operation-actions",
        field_to_check: ["动作类型", "目标指标", "观察周期", "review_due_at"],
        how_to_check: "对每个异常计划决定调整、暂停、继续观察或等待确认。",
        judgement_standard: { p0: "P0 广告异常没有动作/Issue/Waiting。", p1: "P1 广告异常没有复查时间。", p2: "观察项有无动作原因即可。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["动作未闭环", "无复查", "无目标指标"],
        next_actions: ["记录 ActionLog", "创建 Issue", "加入明日复查"],
        actionlog_trigger: "任何预算、出价、关键词、推广商品调整。",
        issue_trigger: "广告异常无法判断或缺目标指标。",
        waiting_trigger: "等待主管预算确认或平台数据刷新。",
        no_action_reason_options: ["观察期未满", "样本不足", "等待确认", "广告正常"],
        follow_up_rule: "所有广告动作必须设置复查指标和时间。",
        completion_standard: "广告异常均有 ActionLog/Issue/Waiting/无动作/复查之一。",
        target_view: "operation-actions",
        required_context: ["ad_plan_id"]
      }
    ],
    risk_levels: dailyRiskLevels,
    completion_standard: ["广告异常已标记。", "需要调整的广告动作已记录 ActionLog。", "不调整的写明原因。", "广告判断必须引用商品状态。"],
    possible_action_logs: ["暂停广告计划", "降预算", "加预算", "调整出价", "新增关键词", "否词", "调整推广商品", "观察广告计划"],
    possible_issues: ["广告花费失控", "ROI 不达标", "CPC 异常上涨", "高花费无转化", "搜索词不相关", "广告数据缺失"],
    possible_waiting_items: ["等待广告数据回传", "等待主管确认预算", "等待素材调整"],
    no_action_reasons: ["广告仍在观察期", "今日数据不足", "广告花费为 0，不适用 ROI 判断", "商品本身数据未稳定", "等待下一周期再判断", "需要主管确认预算"],
    tomorrow_followups: ["调整后 CTR 是否改善", "CPC 是否下降", "ROI 是否恢复", "花费是否继续异常", "新增关键词是否带来有效点击"],
    manager_summary_hint: "广告问题是否来自流量、商品承接、预算还是数据不足。"
  },
  {
    task_id: "inventory-supply-risk",
    task_name: "库存与供应链风险检查",
    task_level: "supply risk",
    layer: "经营状态",
    applicable_scope: ["sku", "inventory", "supplier"],
    why: "检查库存是否支撑销售，避免断货、爆仓、在途异常、虚拟库存误判和资金占用。",
    why_now: "商品和广告跑起来之后，必须确认供应链是否撑得住，否则前面的优化会变成断货或积压风险。",
    input_context: ["sku", "warehouse", "supplier", "sales_velocity"],
    steps: [
      {
        step_id: "inventory-check-low-stock",
        step_name: "检查低库存 / 断货 SKU",
        objective: "避免重点商品断货、超卖或广告继续放量。",
        data_source: "店小秘 / 马帮库存 / 自仓 / 官方仓 / 近 7 日销量",
        field_to_check: ["可售库存", "安全库存", "近 7 日销量", "在途库存", "广告状态"],
        how_to_check: "按重点商品 SKU 对比可售库存、近 7 日销量均值、人工安全库存线和在途到货时间。",
        judgement_standard: { p0: "重点 SKU 已断货或预计短期断货且仍在投放/销售。", p1: "可售库存低于人工安全线或无法覆盖近 7 日销量趋势。", p2: "库存安全或非重点 SKU。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["断货", "低库存", "超卖风险", "广告需限流"],
        next_actions: ["补货", "限流", "暂停推广", "创建 WaitingItem"],
        actionlog_trigger: "已提交补货、暂停推广、限流或调整商品标签。",
        issue_trigger: "断货、库存数据冲突、无法确认真实库存。",
        waiting_trigger: "等待仓库确认、供应商交期或采购确认。",
        no_action_reason_options: ["库存安全", "在途即将入库", "非重点 SKU"],
        follow_up_rule: "低库存 SKU 明日复查销售和到货状态。",
        completion_standard: "重点 SKU 库存风险已判断，低库存有动作或等待项。",
        target_view: "inventory-center",
        required_context: ["product_id", "inventory_sku"]
      },
      {
        step_id: "inventory-check-virtual-stock",
        step_name: "区分真实库存与杭州 JIT 虚拟库存",
        objective: "避免把虚拟库存误当成可售履约能力。",
        data_source: "仓库库存 / JIT 库存 / SKU Mapping",
        field_to_check: ["自仓库存", "官方仓库存", "杭州 JIT 库存", "warehouse_sku"],
        how_to_check: "逐 SKU 对照真实仓库库存与 JIT 虚拟库存，标记不可作为真实库存的来源。",
        judgement_standard: { p0: "真实库存不足但系统显示虚拟库存，可能导致履约误判。", p1: "SKU 库存来源不明确。", p2: "库存来源清楚。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["虚拟库存误判", "SKU 映射不清", "仓库库存不一致"],
        next_actions: ["创建 Issue", "等待仓库确认", "修正库存判断"],
        actionlog_trigger: "已修正库存标签或调整推广/补货判断。",
        issue_trigger: "库存来源冲突或 SKU 无法对应。",
        waiting_trigger: "等待仓库或供应链确认真实库存。",
        no_action_reason_options: ["库存来源明确", "无需 JIT 判断", "非重点 SKU"],
        follow_up_rule: "库存来源不明时明日复查。",
        completion_standard: "虚拟库存不作为真实库存判断依据。",
        target_view: "inventory-center",
        required_context: ["inventory_sku", "warehouse_sku"]
      },
      {
        step_id: "inventory-check-aging",
        step_name: "检查超龄 / 滞销库存",
        objective: "识别资金占用和清仓风险。",
        data_source: "库存周转表 / 销量数据 / 商品中枢",
        field_to_check: ["库龄", "周转天数", "近 7 日销量", "库存金额", "商品标签"],
        how_to_check: "按库存金额和库龄排序，对比近 7 日销量均值和人工周转目标。",
        judgement_standard: { p0: "高金额库存长期无动销且影响现金流。", p1: "周转明显慢于人工目标或店铺同类均值。", p2: "低金额或轻微滞销，记录观察。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["库存积压", "超龄库存", "资金占用", "清仓候选"],
        next_actions: ["清仓", "降价", "限采购", "进入商品复盘"],
        actionlog_trigger: "已创建清仓、降价或暂停采购动作。",
        issue_trigger: "库存积压原因不明或需主管决策。",
        waiting_trigger: "等待主管确认清仓策略或供应商退换方案。",
        no_action_reason_options: ["库存周转正常", "金额小暂不处理", "已有清仓动作观察中"],
        follow_up_rule: "清仓/降价后复查销量和库存。",
        completion_standard: "超龄库存有清仓/观察/等待判断。",
        target_view: "operation-review",
        required_context: ["product_id", "inventory_sku"]
      },
      {
        step_id: "inventory-check-supplier",
        step_name: "检查供应商 / 仓库未反馈事项",
        objective: "把库存风险中的外部依赖变成 WaitingItem。",
        data_source: "供应商沟通记录 / 仓库反馈 / WaitingItem",
        field_to_check: ["交期", "补货确认", "质量反馈", "拆包可行性", "运费红线"],
        how_to_check: "列出影响补货、发货、质量或运费判断的未反馈事项。",
        judgement_standard: { p0: "影响断货、履约或运费红线且无人反馈。", p1: "影响补货计划或清仓决策。", p2: "普通信息等待。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["等待供应商", "等待仓库", "交期不明", "运费红线"],
        next_actions: ["创建 WaitingItem", "记录 ActionLog", "明日复查"],
        actionlog_trigger: "已联系供应商/仓库或调整补货计划。",
        issue_trigger: "供应商交期异常或运费/尺寸触发红线。",
        waiting_trigger: "等待供应商交期、仓库确认、主管确认。",
        no_action_reason_options: ["无外部依赖", "反馈已收到", "暂不需要补货"],
        follow_up_rule: "所有库存相关 WaitingItem 必须有 next_follow_up_at。",
        completion_standard: "外部依赖已进入 WaitingItem 或关闭。",
        target_view: "daily-waiting",
        required_context: ["supplier", "warehouse_sku"]
      }
    ],
    risk_levels: dailyRiskLevels,
    completion_standard: ["断货、爆仓、在途异常已标记。", "需要采购、清仓、限流、停售的对象已记录。", "杭州 JIT 虚拟库存不作为真实库存判断依据。"],
    possible_action_logs: ["创建采购建议", "限流", "暂停推广", "清仓", "拆包计划", "转仓", "补货", "标记库存观察"],
    possible_issues: ["断货风险", "虚拟库存误判", "在途异常", "库存积压", "运费红线风险", "供应商交期异常", "SKU 不可拆包"],
    possible_waiting_items: ["等待仓库确认", "等待供应商交期", "等待采购确认", "等待主管清仓决策"],
    no_action_reasons: ["当前库存安全", "在途即将入库", "销量不足，不建议补货", "库存数据待确认", "供应商交期未确认", "运费风险待核算"],
    tomorrow_followups: ["低库存 SKU 是否继续销售", "在途是否入库", "补货是否下单", "清仓动作是否生效", "广告是否需要配合限流"],
    manager_summary_hint: "库存风险是否会限制广告、链接优化或新品推进。"
  },
  {
    task_id: "listing-optimization",
    task_name: "重点链接优化动作",
    task_level: "trackable action",
    layer: "增长动作",
    applicable_scope: ["listing", "product", "ad_plan"],
    why: "把前面 1-5 的巡检结果转化为具体优化动作，并留下 ActionLog 证据链。",
    why_now: "优化动作不能凭感觉做，必须基于前面红线、履约、商品、广告、库存巡检结果。否则就是乱改链接。",
    input_context: ["product", "listing", "snapshot", "action", "review"],
    steps: [
      {
        step_id: "listing-select-target",
        step_name: "选择今日重点链接",
        objective: "确保优化对象来自前序巡检，而不是凭感觉挑链接。",
        data_source: "任务 3-5 标记结果 / 商品运维池 / 商品中枢",
        field_to_check: ["商品标签", "异常指标", "广告风险", "库存风险", "历史动作"],
        how_to_check: "优先选择 P0/P1 异常品、潜力品、广告消耗品和昨日未完成项。",
        judgement_standard: { p0: "P0/P1 商品没有被纳入今日处理对象。", p1: "潜力品或广告消耗品没有下一步。", p2: "无重点链接可动作。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["重点链接遗漏", "潜力品未动作", "广告消耗品"],
        next_actions: ["进入商品中枢", "创建 ActionLog", "记录无动作原因"],
        actionlog_trigger: "已选定重点链接并安排优化动作。",
        issue_trigger: "无法确认重点链接或商品状态冲突。",
        waiting_trigger: "等待主管确认重点链接优先级。",
        no_action_reason_options: ["无重点链接", "已有动作观察中", "库存限制不适合放量"],
        follow_up_rule: "被选中的重点链接必须有复查指标。",
        completion_standard: "今日重点链接已选定或说明无动作原因。",
        target_view: "commerce-products",
        required_context: ["product_id", "listing_id"]
      },
      {
        step_id: "listing-check-context",
        step_name: "查看商品中枢上下文",
        objective: "避免重复动作或与商品事实冲突。",
        data_source: "商品中枢 / Listing / SKU / Snapshot / ActionLog",
        field_to_check: ["标题", "主图", "价格", "SKU", "库存", "历史动作", "复盘状态"],
        how_to_check: "进入商品中枢，先看历史动作和复盘，再决定是否新动作。",
        judgement_standard: { p0: "到期动作未复盘却继续新动作。", p1: "商品事实缺失导致动作依据不足。", p2: "上下文完整，可进入动作判断。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["动作重复", "缺商品事实", "未复盘"],
        next_actions: ["先复盘", "补数据", "创建 Issue"],
        actionlog_trigger: "已补充动作依据或完成复盘后安排新动作。",
        issue_trigger: "商品中枢事实缺失或历史动作冲突。",
        waiting_trigger: "等待数据、素材或主管确认。",
        no_action_reason_options: ["已有动作观察中", "上下文不足暂不动作", "商品状态正常"],
        follow_up_rule: "补齐上下文后复查是否可动作。",
        completion_standard: "动作前已看商品事实和历史动作。",
        target_view: "commerce-product-detail",
        required_context: ["product_id"]
      },
      {
        step_id: "listing-choose-action",
        step_name: "判断优化方向",
        objective: "把异常指标映射到具体优化手段。",
        data_source: "商品数据 / 广告数据 / Listing 内容",
        field_to_check: ["CTR", "CVR", "价格", "主图", "标题", "详情", "库存", "评价"],
        how_to_check: "CTR 低查主图/标题；CVR 低查价格/详情/评价/库存；ROI 差查广告和承接。",
        judgement_standard: { p0: "明确异常但没有可追踪动作。", p1: "动作方向不匹配指标来源。", p2: "指标未到动作条件，观察即可。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["CTR 异常", "CVR 异常", "价格问题", "主图问题", "承接问题"],
        next_actions: ["改标题", "换主图", "调价", "改详情", "调广告"],
        actionlog_trigger: "任何 Listing、价格、广告、SKU、详情改动。",
        issue_trigger: "无法确定优化方向或需跨团队确认。",
        waiting_trigger: "等待图片、文案、主管确认或平台审核。",
        no_action_reason_options: ["数据不足", "指标正常", "已有动作观察中"],
        follow_up_rule: "每个动作必须设置目标指标和 review_due_at。",
        completion_standard: "动作方向与异常指标一一对应。",
        target_view: "operation-actions",
        required_context: ["product_id", "listing_id"]
      },
      {
        step_id: "listing-record-output",
        step_name: "记录动作、等待或无动作原因",
        objective: "让重点链接优化形成证据链。",
        data_source: "今日驾驶舱 / operation-actions / WaitingItem",
        field_to_check: ["action_type", "reason", "target_metric", "observation_period", "review_due_at"],
        how_to_check: "完成动作后立即记录原因、对象、目标指标和复查时间；不能动作则记录等待或无动作原因。",
        judgement_standard: { p0: "已改链接但没有 ActionLog。", p1: "ActionLog 缺目标指标或复查时间。", p2: "无动作原因清楚。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["动作无证据", "缺复查", "等待素材"],
        next_actions: ["记录 ActionLog", "创建 WaitingItem", "加入明日复查"],
        actionlog_trigger: "已执行任何可影响链接表现的动作。",
        issue_trigger: "动作条件不足、数据冲突或无法判断。",
        waiting_trigger: "等待图片、文案、供应链、平台审核或主管确认。",
        no_action_reason_options: ["数据不足", "等待外部反馈", "观察期未满", "库存限制"],
        follow_up_rule: "所有动作必须进入明日或指定日期复查。",
        completion_standard: "重点链接有动作证据或明确无动作原因。",
        target_view: "operation-actions",
        required_context: ["product_id", "listing_id"]
      }
    ],
    risk_levels: dailyRiskLevels,
    completion_standard: ["需要动作的链接已创建 ActionLog。", "无动作链接已记录无动作原因。", "每个动作都有目标指标和复查时间。"],
    possible_action_logs: ["改标题", "改主图", "改价格", "改详情", "调 SKU", "调整广告承接", "加活动", "暂停低效 SKU", "补充关键词", "优化属性"],
    possible_issues: ["标题不匹配流量", "主图 CTR 异常", "价格无竞争力", "SKU 承接错误", "库存限制导致无法放量", "到期动作未复盘", "数据不足无法判断"],
    possible_waiting_items: ["等待图片", "等待文案", "等待主管确认", "等待平台审核"],
    no_action_reasons: ["当前数据正常，继续观察", "已有动作在观察期，避免重复干预", "数据不足，暂不动作", "库存限制，不适合优化放量", "等待主管确认", "等待下一周期数据"],
    tomorrow_followups: ["改标题后 CTR", "改主图后点击率", "调价后 CVR / 订单", "广告调整后 ROI / CPC", "暂停后退款或亏损是否收敛"],
    manager_summary_hint: "今天对哪些重点链接做了什么动作，依据来自哪项巡检。"
  },
  {
    task_id: "opportunity-progress",
    task_name: "新品 / 竞品 / 机会池推进",
    task_level: "growth pipeline",
    layer: "增长动作",
    applicable_scope: ["opportunity", "product", "category"],
    why: "在基础运营稳定之后，推进新品、竞品观察、机会池和爆品衍生，避免运营只救火不增长。",
    why_now: "机会推进应该排在店铺红线、履约、商品、广告、库存等基础运营稳定之后。如果基础风险没处理，不应该先看机会池。",
    input_context: ["opportunity", "competitor", "product_queue", "market_signal"],
    steps: [
      {
        step_id: "opportunity-check-pipeline",
        step_name: "查看新品队列和素材待上架",
        objective: "确认增长管道是否被卡住。",
        data_source: "选品开发 / 商品队列 / 上品生产 / 商品中枢",
        field_to_check: ["新品状态", "素材完整度", "文案/图片缺口", "上架接入状态"],
        how_to_check: "按队列状态筛选待推进、卡住和长期未处理候选。",
        judgement_standard: { p0: "已确认机会长期卡住且影响上架节奏。", p1: "素材、规格、成本、供应链信息不完整。", p2: "机会仍在观察或优先级低。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["新品卡住", "素材缺失", "待上架", "机会优先级不明"],
        next_actions: ["推进上品生产", "创建 WaitingItem", "记录无动作原因"],
        actionlog_trigger: "已推进新品、补素材、创建商品档案或上架接入。",
        issue_trigger: "机会卡住原因不明或资料缺失影响推进。",
        waiting_trigger: "等待供应商资料、图片、样品、主管确认。",
        no_action_reason_options: ["无新增机会", "资料不足", "今日优先级低"],
        follow_up_rule: "卡住机会明日复查资料是否补齐。",
        completion_standard: "新品/机会池至少完成一次推进或说明原因。",
        target_view: "selection-overview",
        required_context: ["opportunity_id", "product_id"]
      },
      {
        step_id: "opportunity-check-competitor",
        step_name: "检查重点竞品变化",
        objective: "捕捉可转成选品、做图或 Listing 优化的市场信号。",
        data_source: "竞品链接 / 市场调研 / 内胆包型雷达",
        field_to_check: ["价格", "主图", "卖点", "评价", "款式", "销量信号"],
        how_to_check: "查看重点竞品是否变价、换图、增加卖点或出现新需求场景。",
        judgement_standard: { p0: "竞品变化直接威胁爆品或核心商品。", p1: "出现可验证的新卖点/款式/场景。", p2: "变化不明确，继续观察。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["竞品变价", "竞品换图", "新场景", "爆品衍生"],
        next_actions: ["记录机会", "进入商品档案", "安排调研"],
        actionlog_trigger: "已记录竞品变化、创建候选或调研任务。",
        issue_trigger: "竞品疑似侵权、数据来源不足或机会风险不明。",
        waiting_trigger: "等待调研、供应商可行性或主管确认。",
        no_action_reason_options: ["竞品无明显变化", "信号不足", "等待市场确认"],
        follow_up_rule: "重点竞品变化需要下一次复查日期。",
        completion_standard: "竞品变化有机会记录或跳过原因。",
        target_view: "selection-radar",
        required_context: ["competitor_url"]
      },
      {
        step_id: "opportunity-evaluate-redlines",
        step_name: "判断机会是否触发经营红线",
        objective: "避免把不适合一人团队经营的机会推进到生产。",
        data_source: "供应商资料 / 成本 / 重量体积 / SKU 复杂度 / 平台规则",
        field_to_check: ["成本", "重量", "三边和", "SKU 复杂度", "侵权风险", "供应链稳定性"],
        how_to_check: "对候选机会逐项判断成本、运费、尺寸、侵权、供应链和 SKU 复杂度。",
        judgement_standard: { p0: "触发侵权、运费或供应链硬红线。", p1: "成本/体积/SKU 复杂度高，需要主管确认。", p2: "风险可控但需继续补资料。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["侵权风险", "运费红线", "成本过高", "SKU 复杂", "供应链不稳"],
        next_actions: ["放弃候选", "创建 Issue", "等待供应商资料"],
        actionlog_trigger: "已放弃、暂缓或推进候选并记录原因。",
        issue_trigger: "机会风险不清或需主管决策。",
        waiting_trigger: "等待供应商成本、尺寸、样品或主管确认。",
        no_action_reason_options: ["风险过高", "资料不足", "继续观察"],
        follow_up_rule: "需要补资料的机会进入明日/指定日期复查。",
        completion_standard: "候选机会有推进、暂缓或放弃理由。",
        target_view: "selection-overview",
        required_context: ["opportunity_id"]
      },
      {
        step_id: "opportunity-route-output",
        step_name: "记录推进结果",
        objective: "让增长机会进入商品档案、上品生产、等待或复查。",
        data_source: "今日驾驶舱 / 商品中枢 / 上品生产",
        field_to_check: ["下一步", "缺失资料", "责任人", "复查时间"],
        how_to_check: "对每个候选决定：推进、补资料、等待、放弃或明日复查。",
        judgement_standard: { p0: "已确认高优先机会没有下一步。", p1: "机会缺资料但没有 WaitingItem。", p2: "低优先机会有跳过原因即可。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["机会未闭环", "资料缺口", "无复查"],
        next_actions: ["创建 Product", "进入上品生产", "创建 WaitingItem", "记录无动作原因"],
        actionlog_trigger: "新增开发池候选、创建 Product、推进上品生产或暂缓机会。",
        issue_trigger: "机会依据不足、优先级冲突或风险不明。",
        waiting_trigger: "等待供应商、图片、样品、主管确认。",
        no_action_reason_options: ["今日无明确机会", "机会数据不足", "供应链不支持"],
        follow_up_rule: "所有补资料机会必须有 next_follow_up_at。",
        completion_standard: "机会池没有空白跳过，均有输出。",
        target_view: "materials",
        required_context: ["opportunity_id", "product_id"]
      }
    ],
    risk_levels: dailyRiskLevels,
    completion_standard: ["有机会则记录到机会池或商品档案。", "无机会则记录跳过原因。", "不允许空白跳过。"],
    possible_action_logs: ["新增开发池候选", "创建 Product", "推进上品生产", "推进上架接入", "标记竞品变化", "生成 ChatGPT 调研任务", "暂缓机会"],
    possible_issues: ["缺市场数据", "缺供应商信息", "尺寸 / 材质不确定", "成本或运费超红线", "竞品侵权风险", "机会优先级不明确"],
    possible_waiting_items: ["等待供应商资料", "等待图片", "等待样品", "等待主管确认"],
    no_action_reasons: ["今日无明确机会", "机会数据不足", "当前库存或供应链不支持", "成本 / 运费 / 尺寸超红线", "等待市场确认", "等待主管确认"],
    tomorrow_followups: ["候选机会是否补数据", "新品是否进入上品生产", "竞品变化是否持续", "已有素材商品是否接入上架"],
    manager_summary_hint: "今日是否推进增长机会；如果跳过，理由是否清楚。"
  },
  {
    task_id: "daily-report-review",
    task_name: "收尾复盘与运营日报",
    task_level: "close loop",
    layer: "复盘闭环",
    applicable_scope: ["daily_plan", "operator", "team"],
    why: "把一天的运营任务、动作、问题、明日验证指标和主管摘要沉淀下来，形成次日复查依据。",
    why_now: "它是一天的收口。没有日报，前面做的动作和判断会散掉；有日报，第二天才能复查。",
    input_context: ["daily_task", "actionlog", "issue", "waiting_item", "followup"],
    steps: [
      {
        step_id: "report-summarize-actions",
        step_name: "汇总今日 ActionLog",
        objective: "确认今天所有真实动作都有证据链。",
        data_source: "今日驾驶舱 / operation-actions",
        field_to_check: ["action_type", "reason", "target_metric", "review_due_at", "product_id"],
        how_to_check: "逐项检查今日动作是否写清对象、原因、动作、目标指标和复查时间。",
        judgement_standard: { p0: "已执行关键动作但没有 ActionLog。", p1: "ActionLog 缺目标指标或复查时间。", p2: "动作完整，等待复查。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["动作无证据", "缺目标指标", "缺复查时间"],
        next_actions: ["补 ActionLog", "加入明日复查", "创建 Issue"],
        actionlog_trigger: "已完成日报或补充动作记录。",
        issue_trigger: "关键动作证据缺失且无法补齐。",
        waiting_trigger: "等待执行人补证据或主管确认。",
        no_action_reason_options: ["今日无优化动作但完成巡检", "动作已完整记录"],
        follow_up_rule: "所有动作必须形成明日或指定日期复查。",
        completion_standard: "今日动作记录可用于复盘。",
        target_view: "operation-actions",
        required_context: ["task_id", "action_id"]
      },
      {
        step_id: "report-summarize-issues-waiting",
        step_name: "汇总未关闭 Issue / WaitingItem",
        objective: "确保问题和等待事项不在日终丢失。",
        data_source: "Issue / WaitingItem / 今日驾驶舱",
        field_to_check: ["severity", "owner", "status", "due_at", "next_follow_up_at"],
        how_to_check: "列出未关闭 P0/P1 Issue 和 active WaitingItem，检查 owner 与复查时间。",
        judgement_standard: { p0: "P0 Issue 无 owner 或无下一步。", p1: "WaitingItem 无 next_follow_up_at 或责任对象不清。", p2: "事项清楚，等待复查。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["Issue 未闭环", "Waiting 无复查", "责任人不清"],
        next_actions: ["补 owner", "补复查时间", "创建 WaitingItem"],
        actionlog_trigger: "已完成问题处理或更新等待事项。",
        issue_trigger: "P0/P1 问题未闭环或无法确认责任人。",
        waiting_trigger: "等待平台、仓库、供应商、主管、执行人反馈。",
        no_action_reason_options: ["无未关闭问题", "等待事项已设置复查"],
        follow_up_rule: "未关闭事项必须进入明日复查。",
        completion_standard: "未关闭 Issue/Waiting 均有 owner 和复查规则。",
        target_view: "daily-waiting",
        required_context: ["issue_id", "waiting_item_id"]
      },
      {
        step_id: "report-summarize-no-action",
        step_name: "汇总无动作原因",
        objective: "让“没做动作”也能被复盘，而不是空白跳过。",
        data_source: "DailyTask / 当前任务输入框",
        field_to_check: ["no_action_reason", "task_status", "steps_done"],
        how_to_check: "检查未产出 ActionLog/Issue/Waiting 的任务是否写明无动作原因。",
        judgement_standard: { p0: "任务标记完成但没有任何输出或无动作原因。", p1: "无动作原因过于模糊，无法复盘。", p2: "原因明确。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["空白完成", "原因模糊", "日报不可复盘"],
        next_actions: ["补无动作原因", "补明日复查", "创建 Issue"],
        actionlog_trigger: "已补充日报整理动作。",
        issue_trigger: "关键任务无证据且无法解释。",
        waiting_trigger: "等待运营补充原因或主管确认。",
        no_action_reason_options: ["数据正常", "样本不足", "观察期未满", "外部等待中"],
        follow_up_rule: "无动作但需观察的任务必须写明复查指标。",
        completion_standard: "每个无动作任务都有可读原因。",
        target_view: "daily-cockpit",
        required_context: ["task_id"]
      },
      {
        step_id: "report-build-tomorrow-followup",
        step_name: "生成明日复查清单和主管摘要",
        objective: "把今日执行结果反哺明天工作。",
        data_source: "DailyTask / ActionLog / Issue / WaitingItem",
        field_to_check: ["followup_note", "target_metric", "expected_signal", "risk_items"],
        how_to_check: "把今日动作、未关闭问题、等待项和无动作观察项汇总成明日复查。",
        judgement_standard: { p0: "P0/P1 未关闭但明日复查为空。", p1: "复查项没有指标或对象。", p2: "明日复查清楚。" },
        risk_level: "P0/P1/P2",
        abnormal_tags: ["明日复查缺失", "主管摘要不清", "闭环断点"],
        next_actions: ["补复查项", "更新日报预览", "提交主管摘要"],
        actionlog_trigger: "已完成日报、更新复查项或主管摘要。",
        issue_trigger: "日报缺关键证据或 P0 未说明。",
        waiting_trigger: "等待主管确认日报或补充证据。",
        no_action_reason_options: ["今日无经营动作但已巡检", "今日重点为风险处理"],
        follow_up_rule: "次日优先打开今日遗留复查项。",
        completion_standard: "日报可读，明日复查明确，主管能看懂今日过程。",
        target_view: "daily-review",
        required_context: ["date", "operator"]
      }
    ],
    risk_levels: dailyRiskLevels,
    completion_standard: ["日报预览完整。", "明日复查项不为空。", "未完成任务有原因。", "主管摘要可直接阅读。", "P0 风险状态清楚。"],
    possible_action_logs: ["完成日报", "标记明日复查", "更新动作复盘时间", "提交主管摘要"],
    possible_issues: ["任务未完成", "明日复查缺失", "P0 风险未关闭", "ActionLog 缺目标指标", "Issue 缺责任人"],
    possible_waiting_items: ["等待平台结果", "等待仓库反馈", "等待主管确认", "等待执行人补证据"],
    no_action_reasons: ["今日无优化动作，但已完成巡检", "今日重点为风险处理", "等待明日数据验证", "等待主管确认", "今日无新增机会"],
    tomorrow_followups: ["今日 ActionLog 的目标指标", "未关闭 Issue", "P0 风险后续状态", "重点商品数据变化", "广告和库存风险变化"],
    manager_summary_hint: "今日完成什么、产生什么动作、暴露什么问题、明天验证什么。"
  }
];
const DAILY_OPERATION_RHYTHMS = [
  { id: "daily-clear", label: "日清", summary: "每天清异常，保安全", active: true },
  { id: "weekly-diagnosis", label: "周诊断", summary: "每周判商品，抓增长" },
  { id: "monthly-review", label: "月复盘", summary: "每月调结构，定方向" },
  { id: "campaign-countdown", label: "大促倒排", summary: "大促前 30-90 天锁节点" }
];

const DAILY_CLEAR_TIME_BLOCKS = [
  ["09:00", "店铺安全与履约异常"],
  ["09:30", "核心商品与流量判断"],
  ["10:30", "今日 1–3 个关键动作"],
  ["17:30", "日清复盘与明日跟进"]
];

const DAILY_TASK_RHYTHM_GROUPS = {
  "store-risk-check": "日清保安全",
  "order-fulfillment-service": "日清保安全",
  "product-data-tagging": "数据判断",
  "ads-traffic-check": "数据判断",
  "inventory-supply-risk": "日清保安全",
  "listing-optimization": "核心动作",
  "opportunity-progress": "增长推进",
  "daily-report-review": "收尾复盘"
};

const DAILY_TASK_PRIMARY_GOALS = {
  "日清保安全": ["先处理 P0/P1 风险", "确认外部等待对象", "留下明日复查"],
  "数据判断": ["找出异常对象", "判断问题来源", "决定是否进入动作"],
  "核心动作": ["锁定 1-3 个动作", "记录目标指标", "设置复查时间"],
  "增长推进": ["看机会是否可推进", "补齐缺失资料", "记录推进或跳过原因"],
  "收尾复盘": ["汇总事实", "沉淀判断", "生成明日跟进"]
};

const dailyTaskTemplates = DAILY_OPERATION_SOP_TEMPLATES.map((template) => ({
  id: template.task_id,
  name: template.task_name,
  layer: template.layer,
  rhythm_group: DAILY_TASK_RHYTHM_GROUPS[template.task_id] || "日清",
  scope: template.applicable_scope.join(" / "),
  task_level: template.task_level,
  why: template.why,
  why_now: template.why_now,
  data_sources: [...new Set(template.steps.map((step) => step.data_source))],
  check_objects: [...new Set(template.steps.flatMap((step) => step.field_to_check))],
  steps: template.steps,
  abnormal_rules: template.steps.map((step) => `${step.step_name}：${formatJudgementStandard(step.judgement_standard)}`),
  risk_levels: template.risk_levels,
  completion_standard: template.completion_standard,
  possible_action_logs: template.possible_action_logs,
  possible_issues: template.possible_issues,
  possible_waiting_items: template.possible_waiting_items,
  no_action_reasons: template.no_action_reasons,
  tomorrow_followups: template.tomorrow_followups,
  manager_summary_hint: template.manager_summary_hint,
  input_context: template.input_context,
  sop_template: template
}));
const dailyTasks = dailyTaskTemplates.map((template) => ({
  ...template,
  status: "not_started",
  elapsedMs: 0,
  timerStartedAt: 0,
  stepsDone: template.steps.map(() => false),
  activeStepIndex: 0,
  stepOutputs: template.steps.map(() => null),
  actionNote: "",
  issueNote: "",
  noActionReason: "",
  followupNote: ""
}));

let selectedDailyTaskId = dailyTasks[0]?.id || "";
dailyUiState.active_task_id = selectedDailyTaskId;

function currentOperatorContext() {
  return currentOperator || {
    operator_id: localStorage.getItem(OPERATOR_STORAGE_KEY) || "unassigned",
    operator_name: "未选择使用人",
    role: "operator",
    color: "gray"
  };
}

function dailyOperatorScopeKey(operatorId = currentOperatorContext().operator_id) {
  return `${todayDateString()}:${operatorId || "unassigned"}`;
}

function resetDailyTaskTemplateState() {
  dailyTasks.forEach((task) => {
    task.status = "not_started";
    task.elapsedMs = 0;
    task.timerStartedAt = 0;
    task.stepsDone = task.steps.map(() => false);
    task.activeStepIndex = 0;
    task.stepOutputs = task.steps.map(() => null);
    task.actionNote = "";
    task.issueNote = "";
    task.noActionReason = "";
    task.followupNote = "";
  });
  selectedDailyTaskId = dailyTasks[0]?.id || "";
  dailyUiState = {
    active_task_id: selectedDailyTaskId,
    active_store_id: null,
    active_step_id: null,
    expanded_sop_step_id: null,
    open_evidence_type: null,
    open_panel: null,
    open_cadence: null
  };
}

function dailyTaskSnapshots() {
  return dailyTasks.map((task) => ({
    id: task.id,
    status: task.status,
    elapsedMs: task.elapsedMs,
    timerStartedAt: task.timerStartedAt,
    stepsDone: task.stepsDone,
    activeStepIndex: task.activeStepIndex,
    stepOutputs: task.stepOutputs,
    actionNote: task.actionNote,
    issueNote: task.issueNote,
    noActionReason: task.noActionReason,
    followupNote: task.followupNote
  }));
}

function restoreDailyTaskSnapshots(snapshots = []) {
  const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  dailyTasks.forEach((task) => {
    const snapshot = byId.get(task.id);
    if (!snapshot) return;
    task.status = snapshot.status || "not_started";
    task.elapsedMs = Number(snapshot.elapsedMs || 0);
    task.timerStartedAt = Number(snapshot.timerStartedAt || 0);
    task.stepsDone = Array.isArray(snapshot.stepsDone) ? snapshot.stepsDone : task.steps.map(() => false);
    task.activeStepIndex = Number(snapshot.activeStepIndex || 0);
    task.stepOutputs = Array.isArray(snapshot.stepOutputs) ? snapshot.stepOutputs : task.steps.map(() => null);
    task.actionNote = snapshot.actionNote || "";
    task.issueNote = snapshot.issueNote || "";
    task.noActionReason = snapshot.noActionReason || "";
    task.followupNote = snapshot.followupNote || "";
  });
}

function cloneDailyState(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureDailyOperatorState() {
  return cloneDailyState({
    selectedDailyTaskId,
    dailyTaskRuns,
    dailyStepRuns,
    dailyStepOutputs,
    dailyEvidenceDraft,
    dailyUiState,
    dailyStoreTaskProgress,
    dailyTasks: dailyTaskSnapshots()
  });
}

function restoreDailyOperatorState(state) {
  selectedDailyTaskId = state?.selectedDailyTaskId || dailyTasks[0]?.id || "";
  dailyTaskRuns = cloneDailyState(state?.dailyTaskRuns || {});
  dailyStepRuns = cloneDailyState(state?.dailyStepRuns || {});
  dailyStepOutputs = cloneDailyState(state?.dailyStepOutputs || {});
  dailyEvidenceDraft = cloneDailyState(state?.dailyEvidenceDraft || emptyDailyEvidenceDraft());
  dailyUiState = cloneDailyState(state?.dailyUiState || {
    active_task_id: selectedDailyTaskId,
    active_store_id: null,
    active_step_id: null,
    expanded_sop_step_id: null,
    open_evidence_type: null,
    open_panel: null,
    open_cadence: null
  });
  dailyStoreTaskProgress = cloneDailyState(state?.dailyStoreTaskProgress || {});
  restoreDailyTaskSnapshots(state?.dailyTasks || []);
  dailyUiState.active_task_id = dailyUiState.active_task_id || selectedDailyTaskId;
}

function saveCurrentDailyOperatorState() {
  if (!currentOperator) return;
  dailyOperatorStateScopes.set(dailyOperatorScopeKey(currentOperator.operator_id), captureDailyOperatorState());
}

function renderOperatorBadge() {
  if (!elements.operatorBadge || !elements.operatorName) return;
  if (!currentOperator) {
    elements.operatorBadge.classList.remove("hidden");
    elements.operatorBadge.dataset.operatorColor = "gray";
    elements.operatorName.textContent = "未选择";
    return;
  }
  elements.operatorBadge.classList.remove("hidden");
  elements.operatorBadge.dataset.operatorColor = currentOperator.color || "blue";
  elements.operatorName.textContent = currentOperator.operator_name || currentOperator.operator_id;
  if (elements.actionOperator && !elements.actionOperator.value) {
    elements.actionOperator.value = currentOperator.operator_name || "";
  }
}

function renderOperatorOptions() {
  if (!elements.operatorOptions) return;
  elements.operatorOptions.replaceChildren(
    ...operators.map((operator) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "operator-option";
      button.dataset.operatorColor = operator.color || "blue";
      button.innerHTML = `<strong>${operator.operator_name}</strong><span>${operator.role || "operator"}</span>`;
      button.addEventListener("click", () => {
        activateOperator(operator);
      });
      return button;
    })
  );
}

function showOperatorModal(open = true) {
  if (!elements.operatorModal) return;
  elements.operatorModal.classList.toggle("hidden", !open);
  if (open) renderOperatorOptions();
}

function activateOperator(operator, options = {}) {
  if (!operator) return;
  saveCurrentDailyOperatorState();
  currentOperator = operator;
  localStorage.setItem(OPERATOR_STORAGE_KEY, operator.operator_id);
  const scopeKey = dailyOperatorScopeKey(operator.operator_id);
  if (!dailyOperatorStateScopes.has(scopeKey)) {
    resetDailyTaskTemplateState();
    initDailyRunState();
    initDailyStoreTaskProgress();
    dailyOperatorStateScopes.set(scopeKey, captureDailyOperatorState());
  }
  restoreDailyOperatorState(dailyOperatorStateScopes.get(scopeKey));
  renderOperatorBadge();
  showOperatorModal(false);
  if (options.render !== false) renderDailyCockpit();
}

async function initializeOperators() {
  try {
    const body = await request("/api/operators");
    operators = (body.operators || []).filter((operator) => operator.enabled !== false);
  } catch {
    operators = [
      { operator_id: "lance", operator_name: "Lance", role: "admin", color: "blue", enabled: true },
      { operator_id: "anna", operator_name: "Anna", role: "operator", color: "green", enabled: true }
    ];
  }
  const savedOperatorId = localStorage.getItem(OPERATOR_STORAGE_KEY);
  const savedOperator = operators.find((operator) => operator.operator_id === savedOperatorId);
  if (savedOperator) {
    activateOperator(savedOperator, { render: false });
    return;
  }
  renderOperatorBadge();
}

function dailyStepId(task, index) {
  return task?.steps?.[index]?.step_id || `step-${index + 1}`;
}

function dailyStoreKey(storeId = dailyUiState.active_store_id) {
  return storeId || "__global";
}

function dailyOutputKey(storeId, stepId) {
  return `${dailyStoreKey(storeId)}:${stepId}`;
}

function dailyAvailableStores() {
  const stores = latestPayload?.operations?.storeProfiles || [];
  const enabled = stores.filter((store) => store.status !== "disabled");
  const values = (enabled.length ? enabled : stores).map((store) => ({
    store_id: store.store_id,
    store_name: store.store_alias || store.store_name || store.store_id,
    status: store.status || "enabled"
  }));
  return values.length
    ? values
    : [{ store_id: null, store_name: "全局任务", status: "enabled" }];
}

function currentDailyStore() {
  const stores = dailyAvailableStores();
  return stores.find((store) => dailyStoreKey(store.store_id) === dailyStoreKey()) || stores[0];
}

function normalizeDailyOutputType(type) {
  return {
    pass: "passed",
    passed: "passed",
    actionlog: "actionlog",
    issue: "issue",
    waiting: "waiting",
    noaction: "no_action",
    no_action: "no_action",
    followup: "follow_up",
    follow_up: "follow_up"
  }[type] || type;
}

function dailyOutputClass(output) {
  const type = normalizeDailyOutputType(output?.type);
  return {
    passed: "pass",
    actionlog: "actionlog",
    issue: "issue",
    waiting: "waiting",
    no_action: "noaction",
    follow_up: "followup"
  }[type] || "";
}

function initDailyRunState() {
  const operator = currentOperatorContext();
  const date = todayDateString();
  dailyTaskRuns = {};
  dailyStepRuns = {};
  dailyStepOutputs = {};
  dailyTasks.forEach((task) => {
    const firstStepId = dailyStepId(task, 0);
    dailyTaskRuns[task.id] = {
      task_id: task.id,
      date,
      operator_id: operator.operator_id,
      operator_name: operator.operator_name,
      status: task.status,
      active_step_id: firstStepId,
      started_at: null,
      completed_at: null,
      reopened_at: null,
      output_count: 0,
      issue_count: 0,
      waiting_count: 0,
      no_action_count: 0,
      follow_up_count: 0,
      store_id: null,
      store_name: "",
      store_progress_status: "not_started"
    };
    dailyStepRuns[task.id] = {};
    dailyStepOutputs[task.id] = {};
    task.steps.forEach((step, index) => {
      const stepId = dailyStepId(task, index);
      dailyStepRuns[task.id][stepId] = {
        step_id: stepId,
        date,
        operator_id: operator.operator_id,
        operator_name: operator.operator_name,
        status: index === 0 ? "active" : "not_started",
        output_type: null,
        completed_at: null,
        reopened_at: null
      };
    });
  });
  dailyUiState.active_step_id = firstDailyStepId();
}

function firstDailyStepId() {
  const task = dailyTasks.find((item) => item.id === dailyUiState.active_task_id) || dailyTasks[0];
  return task ? dailyStepId(task, 0) : null;
}

function dailyTaskRun(task) {
  return dailyTaskRuns[task.id];
}

function dailyStepRun(task, index) {
  return dailyStepRuns[task.id]?.[dailyStepId(task, index)];
}

function dailyStepOutput(task, index) {
  return dailyStepOutputs[task.id]?.[dailyOutputKey(dailyUiState.active_store_id, dailyStepId(task, index))] || null;
}

function allDailyStepOutputs() {
  return Object.values(dailyStepOutputs).flatMap((steps) => Object.values(steps)).filter((output) => output?.status !== "cancelled");
}

function emptyDailyEvidenceDraft() {
  const operator = currentOperatorContext();
  return {
    task_id: null,
    date: todayDateString(),
    operator_id: operator.operator_id,
    operator_name: operator.operator_name,
    store_id: null,
    store_name: "",
    step_id: null,
    type: null,
    content: "",
    meta: {},
    mode: "create"
  };
}

function resetDailyEvidenceDraft() {
  dailyEvidenceDraft = emptyDailyEvidenceDraft();
}

function initDailyStoreTaskProgress() {
  const stores = dailyAvailableStores();
  const operator = currentOperatorContext();
  const date = todayDateString();
  dailyTasks.forEach((task) => {
    dailyStoreTaskProgress[task.id] = dailyStoreTaskProgress[task.id] || {};
    stores.forEach((store) => {
      const key = dailyStoreKey(store.store_id);
      if (dailyStoreTaskProgress[task.id][key]) return;
      dailyStoreTaskProgress[task.id][key] = {
        task_id: task.id,
        date,
        operator_id: operator.operator_id,
        operator_name: operator.operator_name,
        store_id: store.store_id,
        store_name: store.store_name,
        status: "not_started",
        active_step_id: dailyTaskRun(task)?.active_step_id || dailyStepId(task, 0),
        step_done_count: 0,
        issue_count: 0,
        action_count: 0,
        waiting_count: 0,
        no_action_count: 0,
        follow_up_count: 0,
        note: "",
        started_at: null,
        completed_at: null,
        updated_at: null
      };
    });
  });
  if (!dailyAvailableStores().some((store) => dailyStoreKey(store.store_id) === dailyStoreKey())) {
    dailyUiState.active_store_id = dailyAvailableStores()[0]?.store_id || null;
  }
}

function currentStoreTaskProgress(task, storeId = dailyUiState.active_store_id) {
  initDailyStoreTaskProgress();
  return dailyStoreTaskProgress[task.id]?.[dailyStoreKey(storeId)] || null;
}

function dailyStorePriorityStatus(progress) {
  if (!progress) return "not_started";
  if (progress.waiting_count > 0) return "waiting_external";
  if (progress.issue_count > 0) return "has_issue";
  if (progress.status === "done") return "done";
  if (progress.action_count || progress.no_action_count || progress.follow_up_count || progress.step_done_count) return "in_progress";
  return progress.status || "not_started";
}

function updateDailyStoreProgressFromOutputs(task, storeId = dailyUiState.active_store_id) {
  const progress = currentStoreTaskProgress(task, storeId);
  if (!progress) return;
  const key = dailyStoreKey(storeId);
  const outputs = Object.values(dailyStepOutputs[task.id] || {}).filter((output) => output.status !== "cancelled" && dailyStoreKey(output.store_id) === key);
  progress.step_done_count = outputs.length;
  progress.action_count = outputs.filter((output) => output.type === "actionlog").length;
  progress.issue_count = outputs.filter((output) => output.type === "issue").length;
  progress.waiting_count = outputs.filter((output) => output.type === "waiting").length;
  progress.no_action_count = outputs.filter((output) => output.type === "no_action").length;
  progress.follow_up_count = outputs.filter((output) => output.type === "follow_up").length;
  progress.status = dailyStorePriorityStatus(progress);
  progress.updated_at = new Date().toISOString();
}

function dailyStoreStatusLabel(status) {
  return {
    not_started: "未开始",
    in_progress: "处理中",
    done: "已完成",
    has_issue: "有问题",
    waiting_external: "等待别人"
  }[status] || status;
}

function selectDailyStore(task, storeId) {
  dailyUiState.active_store_id = storeId;
  const progress = currentStoreTaskProgress(task, storeId);
  if (progress?.active_step_id) {
    dailyTaskRun(task).active_step_id = progress.active_step_id;
    dailyUiState.active_step_id = progress.active_step_id;
  }
  dailyEvidenceActionOpen = null;
  expandedDailySopStepId = null;
  dailyUiState.open_evidence_type = null;
  dailyUiState.expanded_sop_step_id = null;
  dailyUiState.open_panel = null;
  resetDailyEvidenceDraft();
  saveCurrentDailyOperatorState();
}

function markDailyStoreStarted(task, storeId = dailyUiState.active_store_id) {
  const progress = currentStoreTaskProgress(task, storeId);
  if (!progress) return;
  if (progress.status === "not_started") progress.status = "in_progress";
  progress.started_at = progress.started_at || new Date().toISOString();
  progress.updated_at = new Date().toISOString();
  saveCurrentDailyOperatorState();
}

function markDailyStoreDone(task, storeId = dailyUiState.active_store_id) {
  const progress = currentStoreTaskProgress(task, storeId);
  if (!progress) return;
  progress.status = "done";
  progress.completed_at = new Date().toISOString();
  progress.updated_at = progress.completed_at;
  updateDailyStoreProgressFromOutputs(task, storeId);
  saveCurrentDailyOperatorState();
}

function recomputeDailyTaskRunCounts(task) {
  const outputs = Object.values(dailyStepOutputs[task.id] || {}).filter((output) => output.status !== "cancelled");
  const run = dailyTaskRun(task);
  if (!run) return;
  run.output_count = outputs.length;
  run.issue_count = outputs.filter((output) => output.type === "issue").length;
  run.waiting_count = outputs.filter((output) => output.type === "waiting").length;
  run.no_action_count = outputs.filter((output) => output.type === "no_action").length;
  run.follow_up_count = outputs.filter((output) => output.type === "follow_up").length;
}

initDailyRunState();

const progressByStage = {
  IDLE: 0,
  VALIDATING_INPUT: 10,
  READY_FOR_LOGIN: 20,
  CREATING_CHAT: 35,
  UPLOADING_IMAGES: 55,
  SENDING_PROMPT: 70,
  WAITING_FOR_RESPONSE: 85,
  SENDING_RESEARCH: 25,
  WAITING_FOR_RESEARCH: 45,
  SENDING_PLANNING: 60,
  WAITING_FOR_PLANNING: 80,
  VALIDATING_PROMPT_PACK: 95,
  GENERATING_IMAGES: 55,
  DOWNLOADING_IMAGE: 70,
  SENDING_SEO_KEYWORDS: 25,
  WAITING_FOR_SEO_KEYWORDS: 45,
  SENDING_LISTING_CONTENT: 65,
  WAITING_FOR_LISTING_CONTENT: 85,
  SAVING_LISTING_CONTENT: 95,
  INSERT_MARKET_RADAR: 45,
  PAUSED: 100,
  COMPLETED: 100,
  FAILED: 100
};

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "请求失败");
  return body;
}

const phaseRank = {
  MVP1: 1,
  MVP3: 3,
  MVP4: 4,
  MVP5: 5
};

function completedAtLeast(state, phase) {
  return (phaseRank[state.completedPhase] || 0) >= phaseRank[phase];
}

const phaseLabels = {
  MVP1: "识别完成",
  MVP3: "规划完成",
  MVP4: "图片完成",
  MVP5: "全部完成"
};

function workflowProgress(state) {
  if (state.completedPhase === "MVP5") return 100;
  if (
    state.standardWorkflowGoal === "seo_content_only" &&
    state.researchCompleted
  ) {
    if (state.listingContentText) return 95;
    if (state.seoKeywordText) return 72;
    return 48;
  }
  if (state.completedPhase === "MVP4") return 85;
  if (state.completedPhase === "MVP3") {
    const generated = (state.generatedImageNumbers || []).length;
    return 45 + generated * 4;
  }
  if (state.completedPhase === "MVP1") return 28;
  if (state.running || state.autoRun) return Math.max(5, progressByStage[state.stage] * 0.25);
  return 0;
}

function normalizeView(view) {
  return viewAliases[view] || view;
}

function navViewFor(view) {
  return navActiveViews[view] || viewAliases[view] || view;
}

function refreshNavigationElements() {
  elements.workspaceTabs = [...document.querySelectorAll(".workspace-tab")];
  elements.workspaceMenus = [...document.querySelectorAll(".workspace-menu")];
  elements.navItems = [...document.querySelectorAll(".nav-item")];
}

function renderPrimaryNavigation(activeWorkspace = "today") {
  if (!elements.workspaceSwitcher) return;
  const buttons = NAV_WORKSPACES.map((workspace) => {
    const button = document.createElement("button");
    button.className = "workspace-tab";
    if (workspace.id === "personal") button.classList.add("subdued");
    button.classList.toggle("active", workspace.id === activeWorkspace);
    button.dataset.workspace = workspace.id;
    button.type = "button";

    const label = document.createElement("strong");
    label.textContent = workspace.label;
    const subtitle = document.createElement("small");
    subtitle.textContent = workspace.subtitle;
    button.append(label, subtitle);

    button.addEventListener("click", () => {
      switchView(workspace.defaultView);
    });
    return button;
  });
  elements.workspaceSwitcher.replaceChildren(...buttons);
  refreshNavigationElements();
}

function renderWorkspaceMenu(workspaceId, currentView) {
  if (!elements.workspaceMenu) return;
  const workspace = NAV_WORKSPACES.find((item) => item.id === workspaceId) || NAV_WORKSPACES[0];
  const activeView = navViewFor(currentView || workspace.defaultView);
  if (elements.workspacePanelTitle) {
    elements.workspacePanelTitle.textContent = workspace.label;
  }
  if (elements.workspacePanelSubtitle) {
    elements.workspacePanelSubtitle.textContent = workspace.subtitle;
  }
  if (elements.workspacePanel) {
    elements.workspacePanel.dataset.workspacePanel = workspace.id;
  }

  const items = workspace.items.map((item) => {
    const button = document.createElement("button");
    button.className = "nav-item";
    button.type = "button";
    button.dataset.view = item.view;
    button.dataset.semanticRole = item.semanticRole;
    button.dataset.status = item.status;
    if (item.isPlaceholder) button.dataset.placeholder = "true";
    button.classList.toggle("active", item.view === activeView);

    const label = document.createElement("span");
    label.textContent = item.label;
    button.append(label);

    button.addEventListener("click", () => {
      switchView(item.view);
      if (item.view === "profiles" || item.view === "commerce-products") void loadProductLibrary();
    });
    return button;
  });

  elements.workspaceMenu.dataset.workspaceMenu = workspace.id;
  elements.workspaceMenu.classList.add("active");
  elements.workspaceMenu.replaceChildren(...items);
  refreshNavigationElements();
}

function renderAppNavigation(currentView = "daily-cockpit") {
  const normalizedView = normalizeView(currentView);
  const activeWorkspace = viewWorkspace[normalizedView] || viewWorkspace[currentView] || "today";
  renderPrimaryNavigation(activeWorkspace);
  renderWorkspaceMenu(activeWorkspace, currentView);
}

function switchView(view) {
  const requestedView = view;
  view = normalizeView(view);
  const currentView = activeViewName();
  if (
    currentView &&
    currentView !== view &&
    hasUnsavedCommerceForms() &&
    !window.confirm("当前经营表单有未保存内容，切换页面后将保留草稿但不会自动保存。确定继续切换吗？")
  ) {
    return;
  }
  const insertMode = latestPayload?.state?.workflowMode === "luxury_insert";
  if (insertMode) {
    insertProfileVisible = requestedView === "profiles";
  }
  const navView = navViewFor(requestedView);
  const activeWorkspace = viewWorkspace[view] || viewWorkspace[requestedView] || "today";
  updateSidebarWorkspace(activeWorkspace);
  elements.navItems.forEach((item) => {
    item.classList.toggle(
      "active",
      item.dataset.view === navView
    );
  });
  elements.viewPanels.forEach((panel) => {
    panel.classList.toggle(
      "active",
      panel.dataset.viewPanel === view
    );
  });
  setProductionFlowStep(view);
  updateWorkspaceHeader(view);
  updateSecretaryContext(view);
  if (insertMode) {
    elements.insertWorkspace.classList.add("hidden");
    elements.returnToInsertEditorButton.classList.remove("hidden");
  }
  if (window.innerWidth <= 1050) {
    document.querySelector(`[data-view="${navView}"]`)?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center"
    });
  }
}

function updateSidebarWorkspace(workspace) {
  const currentView = activeViewName() || workspaceDefaults[workspace] || "daily-cockpit";
  elements.workspaceTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.workspace === workspace);
  });
  renderWorkspaceMenu(workspace, currentView);
}

function updateWorkspaceHeader(view) {
  if (!view) {
    elements.productionTopbar?.classList.add("hidden");
    elements.commerceTopbar?.classList.add("hidden");
    elements.standardWorkspaces.forEach((workspace) => workspace.classList.add("hidden"));
    return;
  }
  if (view === "insert-editor") {
    elements.productionTopbar?.classList.remove("hidden");
    elements.commerceTopbar?.classList.add("hidden");
    elements.standardWorkspaces.forEach((workspace) => workspace.classList.add("hidden"));
    return;
  }
  const commerceView = operationViews.has(view);
  elements.productionTopbar?.classList.toggle("hidden", commerceView);
  elements.commerceTopbar?.classList.toggle("hidden", !commerceView);
  elements.standardWorkspaces.forEach((workspace) => {
    workspace.classList.toggle("hidden", commerceView);
  });
  if (!commerceView) return;
  const copy = commerceTopbarCopy[view] || commerceTopbarCopy["commerce-dashboard"];
  elements.commerceTopbarEyebrow.textContent = copy.eyebrow;
  elements.commerceTopbarTitle.textContent = copy.title;
  elements.commerceTopbarDescription.textContent = copy.description;
  configureTopbarAction(elements.commercePrimaryAction, copy.primary);
  configureTopbarAction(elements.commerceSecondaryAction, copy.secondary);
}

function activeViewName() {
  return elements.viewPanels.find((panel) => panel.classList.contains("active"))?.dataset.viewPanel;
}

function dailyTaskById(taskId = selectedDailyTaskId) {
  return dailyTasks.find((task) => task.id === taskId) || dailyTasks[0];
}

function dailyStatusLabel(status) {
  return {
    not_started: "待开始",
    in_progress: "进行中",
    paused: "已暂停",
    done: "已完成"
  }[status] || status;
}

function dailyStatusTone(status) {
  return {
    in_progress: "executing",
    paused: "warning",
    done: "done"
  }[status] || "neutral";
}

function dailyTaskElapsed(task) {
  const running = dailyTaskRun(task)?.status === "in_progress" && task.timerStartedAt;
  return task.elapsedMs + (running ? Date.now() - task.timerStartedAt : 0);
}

function formatDailyDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const two = (value) => String(value).padStart(2, "0");
  return hours ? `${two(hours)}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

function setDailyTextareaValue(element, value) {
  if (!element || document.activeElement === element) return;
  element.value = value || "";
}

function formatJudgementStandard(standard = {}) {
  return Object.entries(standard)
    .map(([level, text]) => `${level.toUpperCase()}：${text}`)
    .join(" / ");
}

function dailyStepInfo(label, value) {
  const row = document.createElement("p");
  row.className = "daily-step-info";
  const strong = document.createElement("strong");
  strong.textContent = label;
  const span = document.createElement("span");
  span.textContent = Array.isArray(value) ? value.join(" / ") : value;
  row.append(strong, span);
  return row;
}

function dailyStepChips(items = []) {
  const row = document.createElement("div");
  row.className = "daily-step-chips";
  items.forEach((item) => {
    const chip = document.createElement("span");
    chip.textContent = item;
    row.append(chip);
  });
  return row;
}

function dailyOutputCounts() {
  const stepOutputs = allDailyStepOutputs();
  return {
    action: stepOutputs.filter((output) => output.type === "actionlog").length,
    issue: stepOutputs.filter((output) => output.type === "issue").length,
    waiting: stepOutputs.filter((output) => output.type === "waiting").length + dailyWaitingItems.filter((item) => item.status === "waiting").length,
    noAction: stepOutputs.filter((output) => output.type === "no_action").length,
    followup: stepOutputs.filter((output) => output.type === "follow_up").length
  };
}

function dailyStepKey(task, index) {
  return `${task?.id || "task"}:${dailyStepId(task, index)}`;
}

function currentDailyStepIndex(task) {
  if (!task?.steps?.length) return 0;
  const activeStepId = dailyTaskRun(task)?.active_step_id || dailyUiState.active_step_id;
  const index = task.steps.findIndex((step, stepIndex) => dailyStepId(task, stepIndex) === activeStepId);
  if (index !== -1) {
    return index;
  }
  const firstOpenIndex = task.steps.findIndex((_, stepIndex) => dailyStepRun(task, stepIndex)?.status !== "done");
  return firstOpenIndex === -1 ? task.steps.length - 1 : firstOpenIndex;
}

function currentDailyStep(task) {
  return task?.steps?.[currentDailyStepIndex(task)] || null;
}

function dailyEvidenceSummary(task) {
  const storeKey = dailyStoreKey();
  const waitingCount = dailyWaitingItemsForTask(task.id, true)
    .filter((item) => dailyStoreKey(item.store_id === "daily-task-context" ? null : item.store_id) === storeKey).length;
  const latestStepOutput = Object.values(dailyStepOutputs[task.id] || {})
    .filter((output) => output.status !== "cancelled" && dailyStoreKey(output.store_id) === storeKey)
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))[0];
  const outputs = [
    latestStepOutput ? `${dailyStepOutputLabel(latestStepOutput)}：${dailyStepOutputContent(latestStepOutput) || "当前步骤已处理"}` : "",
    waitingCount ? `Waiting：${waitingCount} 个等待项` : ""
  ].filter(Boolean);
  return outputs[0] || "暂无证据记录。先完成当前步骤判断，再记录 ActionLog / Issue / Waiting / 无动作原因 / 明日复查。";
}

function setDailyTaskField(task, field, value) {
  task[field] = value;
  const inputMap = {
    actionNote: elements.dailyActionInput,
    issueNote: elements.dailyIssueInput,
    noActionReason: elements.dailyNoActionInput,
    followupNote: elements.dailyFollowupInput
  };
  const input = inputMap[field];
  if (input) {
    input.value = value;
  }
}

function syncDailyTaskOutputFields(task) {
  const latestByType = (type) => Object.values(dailyStepOutputs[task.id] || {})
    .filter((output) => output?.type === type)
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))[0];
  task.actionNote = dailyStepOutputContent(latestByType("actionlog"));
  task.issueNote = dailyStepOutputContent(latestByType("issue"));
  task.noActionReason = dailyStepOutputContent(latestByType("no_action"));
  task.followupNote = dailyStepOutputContent(latestByType("follow_up"));
}

function setDailyActiveStep(task, index) {
  const nextIndex = Math.max(0, Math.min(index, task.steps.length - 1));
  const stepId = dailyStepId(task, nextIndex);
  task.activeStepIndex = nextIndex;
  dailyTaskRun(task).active_step_id = stepId;
  dailyUiState.active_task_id = task.id;
  dailyUiState.active_step_id = stepId;
  Object.values(dailyStepRuns[task.id] || {}).forEach((run) => {
    if (run.status === "active") run.status = run.output_type ? "done" : "not_started";
  });
  const run = dailyStepRuns[task.id]?.[stepId];
  if (run && run.status !== "done") run.status = "active";
  const progress = currentStoreTaskProgress(task);
  if (progress) {
    progress.active_step_id = stepId;
    progress.updated_at = new Date().toISOString();
    if (progress.status === "not_started") progress.status = "in_progress";
  }
  dailyEvidenceActionOpen = null;
  expandedDailySopStepId = null;
  dailyUiState.open_evidence_type = null;
  dailyUiState.expanded_sop_step_id = null;
  dailyUiState.open_panel = null;
  resetDailyEvidenceDraft();
  saveCurrentDailyOperatorState();
}

function dailyStepOutputLabel(output) {
  if (!output) return "";
  return {
    pass: "已通过",
    passed: "已通过",
    actionlog: "已记录 ActionLog",
    issue: "已创建 Issue",
    waiting: "已加入 Waiting",
    noaction: "已记录无动作原因",
    no_action: "已记录无动作原因",
    followup: "已加入明日复查",
    follow_up: "已加入明日复查"
  }[normalizeDailyOutputType(output.type)] || output.label || "已处理";
}

function dailyStepOutputContent(output) {
  if (!output) return "";
  return output.content || output.note || "";
}

function setDailyStepOutput(task, index, type, content = "", meta = {}) {
  const outputType = normalizeDailyOutputType(type);
  const stepId = dailyStepId(task, index);
  const step = task.steps[index] || {};
  const store = currentDailyStore();
  const outputKey = dailyOutputKey(store.store_id, stepId);
  const previous = dailyStepOutputs[task.id]?.[outputKey];
  const now = new Date().toISOString();
  const operator = currentOperatorContext();
  task.stepsDone[index] = true;
  const output = {
    output_id: previous?.output_id || `${dailyOperatorScopeKey(operator.operator_id)}-${task.id}-${dailyStoreKey(store.store_id)}-${stepId}-${outputType}`,
    date: todayDateString(),
    task_id: task.id,
    task_name: task.name,
    step_id: stepId,
    step_name: step.step_name || "",
    operator_id: operator.operator_id,
    operator_name: operator.operator_name,
    created_by_operator_id: previous?.created_by_operator_id || operator.operator_id,
    created_by_operator_name: previous?.created_by_operator_name || operator.operator_name,
    updated_by_operator_id: operator.operator_id,
    updated_by_operator_name: operator.operator_name,
    store_id: store.store_id,
    product_id: meta.product_id || previous?.product_id || null,
    listing_id: meta.listing_id || previous?.listing_id || null,
    store_name: store.store_name,
    store_progress_status: currentStoreTaskProgress(task, store.store_id)?.status || "not_started",
    type: outputType,
    content,
    label: dailyStepOutputLabel({ type: outputType }),
    note: content,
    meta: { ...(previous?.meta || {}), ...meta },
    created_at: previous?.created_at || previous?.createdAt || now,
    updated_at: now,
    updatedAt: now,
    status: "active"
  };
  dailyStepOutputs[task.id][outputKey] = output;
  task.stepOutputs[index] = output;
  const stepRun = dailyStepRun(task, index);
  if (stepRun) {
    stepRun.status = "done";
    stepRun.output_type = outputType;
    stepRun.completed_at = now;
  }
  syncDailyTaskOutputFields(task);
  recomputeDailyTaskRunCounts(task);
  updateDailyStoreProgressFromOutputs(task, store.store_id);
  task.activeStepIndex = index;
  const taskRun = dailyTaskRun(task);
  if (task.status === "not_started") {
    task.status = "paused";
    taskRun.status = "paused";
  }
  taskRun.active_step_id = stepId;
  dailyUiState.active_task_id = task.id;
  dailyUiState.active_step_id = stepId;
  saveCurrentDailyOperatorState();
}

function reopenDailyStep(task, index, clearOutput = false) {
  const stepId = dailyStepId(task, index);
  const outputKey = dailyOutputKey(dailyUiState.active_store_id, stepId);
  const now = new Date().toISOString();
  task.stepsDone[index] = false;
  if (clearOutput) {
    const output = dailyStepOutputs[task.id]?.[outputKey];
    if (output) output.status = "cancelled";
    delete dailyStepOutputs[task.id][outputKey];
    task.stepOutputs[index] = null;
    syncDailyTaskOutputFields(task);
    recomputeDailyTaskRunCounts(task);
    updateDailyStoreProgressFromOutputs(task);
  }
  const run = dailyStepRun(task, index);
  if (run) {
    run.status = "reopened";
    run.output_type = clearOutput ? null : run.output_type;
    run.reopened_at = now;
  }
  setDailyActiveStep(task, index);
}

function openDailyEvidenceEditor(task, index, type) {
  const stepIndex = Math.max(0, Math.min(index, task.steps.length - 1));
  const stepId = dailyStepId(task, stepIndex);
  const outputType = normalizeDailyOutputType(type);
  const store = currentDailyStore();
  const operator = currentOperatorContext();
  const existingOutput = dailyStepOutputs[task.id]?.[dailyOutputKey(store.store_id, stepId)];
  task.activeStepIndex = stepIndex;
  dailyTaskRun(task).active_step_id = stepId;
  dailyUiState.active_task_id = task.id;
  dailyUiState.active_step_id = stepId;
  dailyUiState.expanded_sop_step_id = null;
  dailyUiState.open_evidence_type = outputType;
  dailyUiState.open_panel = "evidence";
  dailyWaitingFormOpen = false;
  expandedDailySopStepId = null;
  dailyEvidenceActionOpen = outputType;
  dailyEvidenceDraft = {
    task_id: task.id,
    task_name: task.name,
    date: todayDateString(),
    operator_id: operator.operator_id,
    operator_name: operator.operator_name,
    store_id: store.store_id,
    store_name: store.store_name,
    step_id: stepId,
    step_name: task.steps[stepIndex]?.step_name || "",
    type: outputType,
    content: existingOutput?.type === outputType ? existingOutput.content || "" : "",
    meta: existingOutput?.type === outputType ? { ...(existingOutput.meta || {}) } : {},
    mode: existingOutput?.type === outputType ? "edit" : "create"
  };
}

function renderDailyRhythmFrame(task) {
  const frame = document.createElement("section");
  frame.className = "daily-rhythm-frame";
  const heading = document.createElement("div");
  heading.className = "daily-rhythm-heading";
  heading.innerHTML = `<span class="mini-label">TODAY RHYTHM</span><h4>日清</h4><p>每天清异常，保安全。当前任务属于：${task.rhythm_group}</p>`;
  const timeline = document.createElement("div");
  timeline.className = "daily-clear-timeline compact";
  DAILY_CLEAR_TIME_BLOCKS.forEach(([time, label]) => {
    const item = document.createElement("span");
    item.innerHTML = `<strong>${time}</strong>${label}`;
    timeline.append(item);
  });
  const cadence = document.createElement("section");
  cadence.className = "daily-cadence-details";
  const cadenceButton = document.createElement("button");
  cadenceButton.type = "button";
  cadenceButton.className = "daily-cadence-toggle";
  cadenceButton.textContent = dailyUiState.open_cadence === "ops-cadence" ? "收起周诊断 / 月复盘 / 大促倒排" : "周诊断 / 月复盘 / 大促倒排";
  cadenceButton.addEventListener("click", () => {
    dailyUiState.open_cadence = dailyUiState.open_cadence === "ops-cadence" ? null : "ops-cadence";
    renderDailyCockpit();
  });
  cadence.append(cadenceButton);
  if (dailyUiState.open_cadence === "ops-cadence") {
    const cadenceBody = document.createElement("div");
    cadenceBody.innerHTML = `
      <p><strong>本周专题</strong><span>周一全店诊断、周三广告、周五库存、周日复盘</span></p>
      <p><strong>本月复盘</strong><span>商品结构、爆品复盘、库存复盘、广告复盘、规则沉淀</span></p>
      <p><strong>大促倒排</strong><span>T-90 / T-60 / T-30 / T-14 / T-7 / 活动中 / 活动后</span></p>
    `;
    cadence.append(cadenceBody);
  }
  frame.append(heading, timeline, cadence);
  return frame;
}

function renderDailyCoreActions(task) {
  const section = document.createElement("section");
  section.className = "daily-core-actions";
  const actions = dailyTasks.filter((item) => item.actionNote.trim()).slice(0, 3);
  const list = document.createElement("ol");
  const values = actions.length
    ? actions.map((item) => `${item.name}：${item.actionNote.trim()}`)
    : [
        "先处理 P0 / P1 风险",
        "再处理已有数据证明的增长机会",
        "最后处理上新、视觉、机会池"
      ];
  values.forEach((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  });
  const empty = actions.length
    ? ""
    : "<p>暂无核心动作。完成红线与数据巡检后，从异常商品、广告、库存或上新中选择 1–3 个动作。</p>";
  section.innerHTML = `<div><span class="mini-label">FOCUS</span><h4>今日 1–3 个核心动作</h4></div>${empty}`;
  section.append(list);
  return section;
}

function renderDailyOutputStrip() {
  const counts = dailyOutputCounts();
  const section = document.createElement("section");
  section.className = "daily-output-strip";
  [
    ["ActionLog", counts.action],
    ["Issue", counts.issue],
    ["WaitingItem", counts.waiting],
    ["无动作原因", counts.noAction],
    ["明日复查", counts.followup]
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
    section.append(item);
  });
  const close = document.createElement("p");
  close.textContent = "日清收尾：事实 → 判断 → 动作 → 结果 → 下一步";
  section.append(close);
  return section;
}

function dailyQuickActionButton(label, action, task, step) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = action === "pass" ? "button primary daily-step-action" : "button secondary daily-step-action";
  button.textContent = label;
  button.addEventListener("click", () => {
    const stepIndex = currentDailyStepIndex(task);
    if (action === "pass") {
      setDailyStepOutput(task, stepIndex, "pass", "正常通过");
      dailyEvidenceActionOpen = null;
      dailyWaitingFormOpen = false;
      expandedDailySopStepId = null;
      renderDailyCockpit();
      return;
    }
    openDailyEvidenceEditor(task, stepIndex, action);
    renderDailyCockpit();
  });
  return button;
}

function renderDailyEvidenceInlineForm(task, step) {
  if (!dailyEvidenceActionOpen) return null;
  const draftType = normalizeDailyOutputType(dailyEvidenceActionOpen);
  const config = {
    actionlog: {
      title: "记录 ActionLog",
      field: "actionNote",
      placeholder: step.actionlog_trigger || "记录今天做了什么、为什么做、后续看什么指标。",
      submit: "保存 ActionLog",
      metaFields: [{ key: "target_metric", label: "后续指标", placeholder: "例如：CTR / CVR / ROI / 退款率" }]
    },
    issue: {
      title: "创建 Issue",
      field: "issueNote",
      placeholder: step.issue_trigger || "记录发现的问题、严重程度、责任人和下次检查。",
      submit: "保存 Issue",
      metaFields: [
        { key: "severity", label: "严重程度", placeholder: "P0 / P1 / P2" },
        { key: "owner", label: "责任人", placeholder: "例如：自己 / 供应商 / 平台小二" },
        { key: "next_follow_up_at", label: "下次检查", type: "date" }
      ]
    },
    waiting: {
      title: "加入 Waiting",
      field: "",
      placeholder: step.waiting_trigger || "记录等待谁、卡在哪一步、什么时候跟进。",
      submit: "保存 Waiting",
      metaFields: [
        { key: "owner", label: "等待对象", placeholder: "例如：仓库 / 供应商 / 小二" },
        { key: "due_at", label: "到期时间", type: "date" },
        { key: "next_follow_up_at", label: "下次跟进", type: "date" },
        { key: "note", label: "备注", placeholder: "卡点、已沟通事项或风险" }
      ]
    },
    no_action: {
      title: "记录无动作原因",
      field: "noActionReason",
      placeholder: (step.no_action_reason_options || []).join(" / ") || "说明为什么今天不动作。",
      submit: "保存无动作原因"
    },
    follow_up: {
      title: "加入明日复查",
      field: "followupNote",
      placeholder: step.follow_up_rule || "说明明天要看什么指标、结果或状态。",
      submit: "保存明日复查",
      metaFields: [
        { key: "next_follow_up_at", label: "复查日期", type: "date" },
        { key: "target_metric", label: "复查指标", placeholder: "例如：曝光 / 点击 / 转化 / 库存" },
        { key: "note", label: "复查备注", placeholder: "明天需要确认的结果" }
      ]
    }
  }[draftType];
  if (!config) return null;
  const stepIndex = currentDailyStepIndex(task);
  const stepId = dailyStepId(task, stepIndex);
  if (dailyEvidenceDraft.task_id !== task.id || dailyEvidenceDraft.step_id !== stepId || dailyEvidenceDraft.type !== draftType) {
    openDailyEvidenceEditor(task, stepIndex, draftType);
  }
  const isEditing = dailyEvidenceDraft.mode === "edit";
  const form = document.createElement("form");
  form.className = "daily-inline-evidence-form";
  const draftStoreLabel = dailyEvidenceDraft.store_name || "全局任务";
  form.innerHTML = `
    <div>
      <span class="mini-label">INLINE EVIDENCE</span>
      <h4>为「${draftStoreLabel} / ${task.name} / ${step.step_name}」${isEditing ? `更新${config.title.replace(/^记录|^创建|^加入/, "")}` : config.title}</h4>
    </div>
    <textarea required></textarea>
    <div class="daily-inline-meta-grid"></div>
    <div class="row-actions">
      <button class="button primary" type="submit">${isEditing ? config.submit.replace("保存", "更新") : config.submit}</button>
      <button class="button secondary" type="button" data-evidence-cancel>取消</button>
    </div>
  `;
  const textarea = form.querySelector("textarea");
  textarea.placeholder = config.placeholder;
  textarea.value = dailyEvidenceDraft.content || "";
  textarea.addEventListener("input", () => {
    dailyEvidenceDraft.content = textarea.value;
  });
  textarea.addEventListener("click", (event) => event.stopPropagation());
  textarea.addEventListener("mousedown", (event) => event.stopPropagation());
  textarea.addEventListener("focus", (event) => event.stopPropagation());
  const metaGrid = form.querySelector(".daily-inline-meta-grid");
  (config.metaFields || []).forEach((field) => {
    const label = document.createElement("label");
    label.textContent = field.label;
    const input = document.createElement("input");
    input.type = field.type || "text";
    input.placeholder = field.placeholder || "";
    input.value = dailyEvidenceDraft.meta?.[field.key] || "";
    input.addEventListener("input", () => {
      dailyEvidenceDraft.meta = { ...(dailyEvidenceDraft.meta || {}), [field.key]: input.value };
    });
    input.addEventListener("change", () => {
      dailyEvidenceDraft.meta = { ...(dailyEvidenceDraft.meta || {}), [field.key]: input.value };
    });
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("mousedown", (event) => event.stopPropagation());
    input.addEventListener("focus", (event) => event.stopPropagation());
    label.append(input);
    metaGrid.append(label);
  });
  if (!(config.metaFields || []).length) metaGrid.remove();
  form.addEventListener("click", (event) => event.stopPropagation());
  form.addEventListener("mousedown", (event) => event.stopPropagation());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = dailyEvidenceDraft.content.trim();
    if (config.field) setDailyTaskField(task, config.field, value);
    setDailyStepOutput(task, stepIndex, draftType, value, dailyEvidenceDraft.meta || {});
    dailyEvidenceActionOpen = null;
    expandedDailySopStepId = null;
    dailyUiState.open_evidence_type = null;
    dailyUiState.open_panel = null;
    resetDailyEvidenceDraft();
    renderDailyCockpit();
  });
  form.querySelector("[data-evidence-cancel]")?.addEventListener("click", () => {
    dailyEvidenceActionOpen = null;
    dailyUiState.open_evidence_type = null;
    dailyUiState.open_panel = null;
    resetDailyEvidenceDraft();
    renderDailyCockpit();
  });
  return form;
}

function renderDailyCurrentStepFocus(task) {
  const stepIndex = currentDailyStepIndex(task);
  const step = currentDailyStep(task);
  const card = document.createElement("article");
  card.className = "daily-focus-card";
  if (!step) return card;

  const judgement =
    step.judgement_standard?.p0 ||
    step.judgement_standard?.p1 ||
    Object.values(step.judgement_standard || {})[0] ||
    "按当前状态与历史均值、平台红线和人工阈值判断是否异常。";
  const source = Array.isArray(step.data_source) ? step.data_source.slice(0, 2).join(" / ") : step.data_source;
  const fields = Array.isArray(step.field_to_check) ? step.field_to_check.slice(0, 3) : [step.field_to_check].filter(Boolean);
  const output = dailyStepOutput(task, stepIndex);
  const stepKey = dailyStepKey(task, stepIndex);

  const header = document.createElement("header");
  header.innerHTML = `
    <span class="mini-label">CURRENT STEP</span>
    <div>
      <h3>${step.step_name}</h3>
      <p>当前任务 ${dailyTasks.indexOf(task) + 1}/8 · 步骤 ${stepIndex + 1}/${task.steps.length} · ${task.rhythm_group}</p>
    </div>
  `;
  if (output) {
    const isPassed = output.type === "passed";
    const chip = document.createElement(isPassed ? "span" : "button");
    chip.className = `daily-step-output-chip ${dailyOutputClass(output)}`;
    chip.textContent = dailyStepOutputLabel(output);
    if (!isPassed) {
      chip.type = "button";
      chip.title = "点击编辑已保存记录";
      chip.addEventListener("click", () => {
        openDailyEvidenceEditor(task, stepIndex, output.type);
        renderDailyCockpit();
      });
    }
    header.append(chip);
  }

  const essentials = document.createElement("div");
  essentials.className = "daily-focus-essentials";
  essentials.append(
    dailyStepInfo("为什么做", task.why),
    dailyStepInfo("查哪里", source),
    dailyStepInfo("看什么", fields.join(" / ")),
    dailyStepInfo("异常判断", judgement),
    dailyStepInfo("完成标准", step.completion_standard || task.completion_standard[0])
  );

  const actions = document.createElement("div");
  actions.className = "daily-focus-actions";
  [
    ["正常通过", "pass"],
    ["记录 ActionLog", "actionlog"],
    ["创建 Issue", "issue"],
    ["加入 Waiting", "waiting"],
    ["无动作原因", "noaction"],
    ["明日复查", "followup"]
  ].forEach(([label, action]) => actions.append(dailyQuickActionButton(label, action, task, step)));
  if (output) {
    const revise = document.createElement("button");
    revise.type = "button";
    revise.className = "button secondary daily-step-action";
    revise.textContent = output.type === "passed" ? "撤回通过 / 重新判断" : "修改记录";
    revise.addEventListener("click", () => {
      if (output.type === "passed") {
        if (!window.confirm("确定撤回该步骤的正常通过状态吗？")) return;
        reopenDailyStep(task, stepIndex, true);
      } else {
        openDailyEvidenceEditor(task, stepIndex, output.type);
      }
      renderDailyCockpit();
    });
    const reopen = document.createElement("button");
    reopen.type = "button";
    reopen.className = "button secondary daily-step-action";
    reopen.textContent = "重新打开";
    reopen.addEventListener("click", () => {
      reopenDailyStep(task, stepIndex, false);
      renderDailyCockpit();
    });
    actions.append(revise, reopen);
  }

  const details = document.createElement("section");
  details.className = "daily-focus-sop";
  const sopToggle = document.createElement("button");
  sopToggle.type = "button";
  sopToggle.className = "daily-focus-sop-toggle";
  sopToggle.textContent = dailyUiState.expanded_sop_step_id === stepKey ? "收起完整 SOP" : "展开完整 SOP";
  sopToggle.addEventListener("click", () => {
    if (dailyUiState.expanded_sop_step_id === stepKey) {
      expandedDailySopStepId = null;
      dailyUiState.expanded_sop_step_id = null;
      dailyUiState.open_panel = null;
    } else {
      dailyEvidenceActionOpen = null;
      dailyUiState.open_evidence_type = null;
      expandedDailySopStepId = stepKey;
      dailyUiState.expanded_sop_step_id = stepKey;
      dailyUiState.open_panel = "sop";
      resetDailyEvidenceDraft();
    }
    renderDailyCockpit();
  });
  details.append(sopToggle);
  if (dailyUiState.expanded_sop_step_id === stepKey) {
    details.append(
      dailyStepInfo("目标", step.objective),
      dailyStepInfo("怎么查", step.how_to_check),
      dailyStepInfo("完整判断标准", formatJudgementStandard(step.judgement_standard)),
      dailyStepInfo("ActionLog 触发条件", step.actionlog_trigger),
      dailyStepInfo("Issue 触发条件", step.issue_trigger),
      dailyStepInfo("WaitingItem 触发条件", step.waiting_trigger),
      dailyStepInfo("无动作原因选项", step.no_action_reason_options || []),
      dailyStepInfo("明日复查规则", step.follow_up_rule),
      dailyStepInfo("目标 view", step.target_view),
      dailyStepChips(step.abnormal_tags || [])
    );
  }

  card.append(header, essentials, actions);
  const inlineForm = renderDailyEvidenceInlineForm(task, step);
  if (inlineForm) card.append(inlineForm);
  card.append(details);
  return card;
}

function renderDailyStepRail(task) {
  const rail = document.createElement("div");
  rail.className = "daily-step-rail";
  const activeIndex = currentDailyStepIndex(task);
  task.steps.forEach((step, index) => {
    const output = dailyStepOutput(task, index);
    const stepRun = dailyStepRun(task, index);
    const row = document.createElement("button");
    row.type = "button";
    row.className = [
      "daily-step-rail-item",
      stepRun?.status === "done" ? "done" : "",
      index === activeIndex ? "active" : ""
    ].filter(Boolean).join(" ");
    row.innerHTML = `
      <span>${index + 1}</span>
      <strong>${step.step_name || step}</strong>
      <small>${output ? dailyStepOutputLabel(output) : stepRun?.status === "done" ? "已完成" : index === activeIndex ? "当前步骤" : stepRun?.status === "reopened" ? "已重新打开" : "未开始"}</small>
    `;
    row.addEventListener("click", () => {
      setDailyActiveStep(task, index);
      renderDailyCockpit();
    });
    rail.append(row);
  });
  return rail;
}

function renderDailyStoreMatrix(task) {
  initDailyStoreTaskProgress();
  const section = document.createElement("section");
  section.className = "daily-store-matrix";
  const currentStore = currentDailyStore();
  const header = document.createElement("div");
  header.className = "daily-store-matrix-head";
  header.innerHTML = `
    <div>
      <span class="mini-label">STORE MATRIX</span>
      <h4>逐店执行矩阵</h4>
    </div>
    <p>当前店铺：${currentStore.store_name}</p>
  `;
  const table = document.createElement("div");
  table.className = "daily-store-table";
  const columns = document.createElement("div");
  columns.className = "daily-store-row daily-store-row-head";
  ["店铺", "状态", "当前步骤", "Action", "Issue", "Waiting", "无动作", "复查", "快捷动作"].forEach((label) => {
    const cell = document.createElement("span");
    cell.textContent = label;
    columns.append(cell);
  });
  table.append(columns);
  dailyAvailableStores().forEach((store) => {
    const progress = currentStoreTaskProgress(task, store.store_id);
    const active = dailyStoreKey(store.store_id) === dailyStoreKey();
    const row = document.createElement("button");
    row.type = "button";
    row.className = ["daily-store-row", active ? "active" : ""].filter(Boolean).join(" ");
    row.addEventListener("click", () => {
      selectDailyStore(task, store.store_id);
      renderDailyCockpit();
    });
    const status = dailyStorePriorityStatus(progress);
    const stepName = task.steps.find((step, index) => dailyStepId(task, index) === progress?.active_step_id)?.step_name || currentDailyStep(task)?.step_name || "-";
    const quick = document.createElement("span");
    quick.className = "daily-store-actions";
    [
      ["开始", "start"],
      ["完成", "done"],
      ["Issue", "issue"],
      ["Waiting", "waiting"],
      ["备注", "noaction"]
    ].forEach(([label, action]) => {
      const actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.textContent = label;
      actionButton.addEventListener("click", (event) => {
        event.stopPropagation();
        selectDailyStore(task, store.store_id);
        if (action === "start") {
          markDailyStoreStarted(task, store.store_id);
        } else if (action === "done") {
          markDailyStoreDone(task, store.store_id);
        } else {
          openDailyEvidenceEditor(task, currentDailyStepIndex(task), action);
        }
        renderDailyCockpit();
      });
      quick.append(actionButton);
    });
    [
      store.store_name,
      dailyStoreStatusLabel(status),
      stepName,
      progress?.action_count || 0,
      progress?.issue_count || 0,
      progress?.waiting_count || 0,
      progress?.no_action_count || 0,
      progress?.follow_up_count || 0
    ].forEach((value, index) => {
      const cell = document.createElement("span");
      cell.textContent = value;
      if (index === 1) cell.className = `daily-store-status ${status}`;
      row.append(cell);
    });
    row.append(quick);
    table.append(row);
  });
  section.append(header, table);
  return section;
}

function renderDailyEvidenceCompact(task) {
  const counts = dailyOutputCounts();
  elements.dailyEvidenceHints.replaceChildren();
  const panel = document.createElement("section");
  panel.className = "daily-evidence-compact";
  const stats = document.createElement("div");
  stats.className = "daily-evidence-stats";
  [
    ["ActionLog", counts.action],
    ["Issue", counts.issue],
    ["Waiting", counts.waiting],
    ["无动作", counts.noAction],
    ["明日复查", counts.followup]
  ].forEach(([label, value]) => {
    const item = document.createElement("span");
    item.innerHTML = `<strong>${value}</strong>${label}`;
    stats.append(item);
  });
  const recent = document.createElement("p");
  recent.textContent = `最近证据：${dailyEvidenceSummary(task)}`;
  const actions = document.createElement("div");
  actions.className = "daily-evidence-compact-actions";
  [
    ["记录 ActionLog", "actionlog"],
    ["创建 Issue", "issue"],
    ["无动作原因", "noaction"],
    ["明日复查", "followup"]
  ].forEach(([label, action]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-button";
    button.textContent = label;
    button.addEventListener("click", () => {
      openDailyEvidenceEditor(task, currentDailyStepIndex(task), action);
      renderDailyCockpit();
    });
    actions.append(button);
  });
  const details = document.createElement("details");
  details.className = "daily-evidence-details";
  details.innerHTML = "<summary>查看全部证据提示</summary>";
  details.append(
    dailyHintBlock("可能产生的 ActionLog", task.possible_action_logs.slice(0, 4)),
    dailyHintBlock("可能产生的 Issue", task.possible_issues.slice(0, 4)),
    dailyHintBlock("可能产生的 WaitingItem", task.possible_waiting_items.slice(0, 4)),
    dailyHintBlock("无动作原因", task.no_action_reasons.slice(0, 4)),
    dailyHintBlock("明日复查项提示", task.tomorrow_followups.slice(0, 4))
  );
  panel.append(stats, recent, actions, details);
  elements.dailyEvidenceHints.append(panel);
}

function renderDailyCockpit() {
  if (!elements.dailyTaskList) return;
  initDailyStoreTaskProgress();
  const selectedTask = dailyTaskById();
  const completed = dailyTasks.filter((task) => dailyTaskRun(task)?.status === "done").length;
  const p0Count = dailyTasks.filter((task) => dailyTaskHasP0Risk(task)).length;
  const totalTime = dailyTasks.reduce((sum, task) => sum + dailyTaskElapsed(task), 0);
  const priorityTask = dailyTasks.find((task) => dailyTaskRun(task)?.status !== "done") || dailyTasks[dailyTasks.length - 1];
  const stepIndex = currentDailyStepIndex(selectedTask);
  const outputs = dailyOutputCounts();

  elements.dailyPriorityTask.textContent = `日清｜${priorityTask?.name || "-"}`;
  elements.dailyProgressText.textContent = `${completed} / ${dailyTasks.length}`;
  elements.dailyTaskProgressBadge.textContent = `当前 ${dailyTasks.indexOf(selectedTask) + 1}/8`;
  elements.dailyTotalTime.textContent = formatDailyDuration(totalTime);
  elements.dailyIssueCount.textContent = `P0/P1 ${p0Count}｜输出 ${outputs.action + outputs.issue + outputs.waiting + outputs.noAction + outputs.followup}｜步骤 ${stepIndex + 1}/${selectedTask.steps.length}`;
  renderDailyWaitingAlert();

  elements.dailyTaskList.replaceChildren(
    ...dailyTasks.map((task) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = ["daily-task-card", task.id === selectedTask.id ? "active" : ""].filter(Boolean).join(" ");
      button.dataset.taskId = task.id;
      const doneSteps = Object.values(dailyStepRuns[task.id] || {}).filter((run) => run.status === "done").length;
      const hasIssue = Object.values(dailyStepOutputs[task.id] || {}).some((output) => output.type === "issue" && output.status !== "cancelled");
      const hasP0 = dailyTaskHasP0Risk(task);
      const waitingCount = dailyWaitingItemsForTask(task.id, true).length;
      const runStatus = dailyTaskRun(task)?.status || task.status;
      const statusLabel = waitingCount ? "等待他人" : dailyStatusLabel(runStatus);
      const statusTone = waitingCount ? "warning" : dailyStatusTone(runStatus);
      button.innerHTML = `
        <span class="daily-task-card-index">${dailyTasks.indexOf(task) + 1}</span>
        <span class="daily-task-card-main">
          <strong>${task.name}</strong>
          <em><b>${task.rhythm_group}</b><b>${task.layer}</b></em>
        </span>
        <span class="daily-task-card-meta">
          <i class="${statusTone}">${statusLabel}</i>
          <small>${doneSteps}/${task.steps.length} · ${formatDailyDuration(dailyTaskElapsed(task))}</small>
          <small class="${hasP0 ? "risk" : ""}">P0 ${hasP0 ? 1 : 0} / Issue ${hasIssue ? 1 : 0} / Waiting ${waitingCount}</small>
        </span>
      `;
      button.addEventListener("click", () => {
        if (selectedDailyTaskId !== task.id) {
          saveCurrentDailyOperatorState();
          dailyEvidenceActionOpen = null;
          expandedDailySopStepId = null;
          dailyUiState.expanded_sop_step_id = null;
          dailyUiState.open_evidence_type = null;
          dailyUiState.open_panel = null;
          resetDailyEvidenceDraft();
          dailyWaitingFormOpen = false;
        }
        selectedDailyTaskId = task.id;
        dailyUiState.active_task_id = task.id;
        dailyUiState.active_step_id = dailyTaskRun(task)?.active_step_id || dailyStepId(task, 0);
        saveCurrentDailyOperatorState();
        renderDailyCockpit();
      });
      return button;
    })
  );

  renderDailyCurrentTask(selectedTask);
  renderDailyReport();
}

function renderDailyCurrentTask(task) {
  if (!task) return;
  const step = currentDailyStep(task);
  const stepIndex = currentDailyStepIndex(task);
  const taskRun = dailyTaskRun(task);
  elements.dailyCurrentTaskName.textContent = task.name;
  elements.dailyCurrentTaskStatus.textContent = dailyStatusLabel(taskRun?.status || task.status);
  elements.dailyCurrentTaskStatus.className = `profile-status ${dailyStatusTone(taskRun?.status || task.status)}`;
  elements.dailyCurrentTaskReason.textContent = task.why;
  elements.dailyCurrentElapsed.textContent = formatDailyDuration(dailyTaskElapsed(task));
  elements.dailyTaskFacts.replaceChildren(
    renderDailyRhythmFrame(task),
    dailyFact("当前任务", `${dailyTasks.indexOf(task) + 1} / 8`, "pill"),
    dailyFact("当前步骤", `${stepIndex + 1} / ${task.steps.length} · ${step?.step_name || "-"}`, "pill"),
    dailyFact("P0/P1 未闭环", String(dailyTaskHasP0Risk(task) ? 1 : 0), "pill"),
    renderDailyOutputStrip()
  );
  elements.dailyCheckObjects.replaceChildren(
    dailyTagGroup("今日判断目标", DAILY_TASK_PRIMARY_GOALS[task.rhythm_group] || []),
    dailyTagGroup("今日 1–3 个核心动作", ["先处理 P0 / P1 风险", "再处理已被数据证明的增长机会", "最后处理上新、视觉、机会池"])
  );

  elements.dailyStepList.replaceChildren(
    renderDailyCurrentStepFocus(task),
    renderDailyStepRail(task),
    renderDailyStoreMatrix(task)
  );

  fillDailyList(elements.dailyAbnormalList, task.abnormal_rules);
  fillDailyList(elements.dailyDoneList, task.completion_standard);
  elements.dailyRiskLevelPills.replaceChildren(
    ...task.risk_levels.map((level) => dailyRiskPill(level))
  );
  elements.dailyPossibleOutputs.textContent =
    `ActionLog：${task.possible_action_logs.join(" / ")}\nIssue：${task.possible_issues.join(" / ")}\nWaitingItem：${task.possible_waiting_items.join(" / ")}\n无动作原因：${task.no_action_reasons.join(" / ")}\n明日复查项提示：${task.tomorrow_followups.join(" / ")}\n完成任务前确认：P0/P1 是否已处理或进入 WaitingItem；是否记录 ActionLog / Issue / WaitingItem / 无动作原因之一；是否需要明日复查；必要步骤是否完成。\n主管摘要提示：${task.manager_summary_hint}`;
  renderDailyEvidenceCompact(task);
  renderCurrentTaskWaitingPanel(task);
  setDailyTextareaValue(elements.dailyActionInput, task.actionNote);
  setDailyTextareaValue(elements.dailyIssueInput, task.issueNote);
  setDailyTextareaValue(elements.dailyNoActionInput, task.noActionReason);
  setDailyTextareaValue(elements.dailyFollowupInput, task.followupNote);
  elements.dailyStartButton.disabled = taskRun?.status === "done" || taskRun?.status === "in_progress";
  elements.dailyPauseButton.disabled = taskRun?.status !== "in_progress";
  elements.dailyCompleteButton.disabled = false;
  elements.dailyCompleteButton.textContent = taskRun?.status === "done" ? "撤回完成 / 重新打开任务" : "完成任务";
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function waitingItemBucket(item) {
  if (item.status !== "waiting") return "closed";
  const followUpAt = item.next_follow_up_at || "";
  const today = todayDateString();
  if (followUpAt && followUpAt < today) return "overdue";
  if (followUpAt === today) return "today";
  return "future";
}

function waitingBucketTitle(bucket) {
  return {
    overdue: "已逾期",
    today: "今日到期",
    future: "未来跟进",
    closed: "已处理"
  }[bucket] || "等待事项";
}

function dailyWaitingItemsForTask(taskId, activeOnly = false) {
  return dailyWaitingItems.filter((item) =>
    item.task_id === taskId && (!activeOnly || item.status === "waiting")
  );
}

function dailyWaitingStats(items = dailyWaitingItems) {
  const activeItems = items.filter((item) => item.status === "waiting");
  return {
    active: activeItems.length,
    overdue: activeItems.filter((item) => waitingItemBucket(item) === "overdue").length,
    today: activeItems.filter((item) => waitingItemBucket(item) === "today").length,
    future: activeItems.filter((item) => waitingItemBucket(item) === "future").length,
    resolved: items.filter((item) => item.status === "resolved").length,
    cancelled: items.filter((item) => item.status === "cancelled").length
  };
}

function renderDailyWaitingAlert() {
  if (!elements.dailyWaitingAlert) return;
  const stats = dailyWaitingStats();
  elements.dailyWaitingAlert.querySelector("strong").textContent =
    `今日等待：逾期 ${stats.overdue}｜今日到期 ${stats.today}｜未来 ${stats.future}｜已解决 ${stats.resolved}`;
  elements.dailyWaitingAlert.classList.toggle("has-risk", stats.overdue > 0 || stats.today > 0);
}

function renderV2HomeDashboard() {
  const stats = dailyWaitingStats();
  const todayWaitingText = document.querySelector("#v2TodayWaitingText");
  const waitingStatus = document.querySelector("#v2WaitingStatus");
  const overdue = document.querySelector("#v2WaitingOverdue");
  const today = document.querySelector("#v2WaitingToday");
  const future = document.querySelector("#v2WaitingFuture");
  const resolved = document.querySelector("#v2WaitingResolved");
  if (todayWaitingText) {
    todayWaitingText.textContent =
      `逾期 ${stats.overdue}｜今日到期 ${stats.today}｜未来 ${stats.future}`;
  }
  if (waitingStatus) {
    waitingStatus.textContent = stats.active ? `Waiting ${stats.active}` : "暂无卡点";
    waitingStatus.className = `profile-status ${stats.overdue || stats.today ? "warning" : "neutral"}`;
  }
  if (overdue) overdue.textContent = String(stats.overdue);
  if (today) today.textContent = String(stats.today);
  if (future) future.textContent = String(stats.future);
  if (resolved) resolved.textContent = String(stats.resolved);
}

function renderCurrentTaskWaitingPanel(task) {
  if (!elements.dailyTaskWaitingCount || !elements.dailyTaskWaitingDue || !elements.dailyTaskWaitingActions || !task) return;
  const taskItems = dailyWaitingItemsForTask(task.id);
  const stats = dailyWaitingStats(taskItems);
  elements.dailyTaskWaitingCount.textContent = `Waiting ${stats.active}`;
  elements.dailyTaskWaitingCount.className = `profile-status ${stats.active ? "warning" : "neutral"}`;
  elements.dailyTaskWaitingDue.textContent =
    `逾期 ${stats.overdue}｜今日到期 ${stats.today}｜未来 ${stats.future}｜已解决 ${stats.resolved}`;
  const button = document.createElement("button");
  button.className = "daily-waiting-quick-button";
  button.type = "button";
  button.textContent = "展开记录区 / 新增 Waiting";
  button.addEventListener("click", () => {
    openDailyWaitingForm("other", "task");
  });
  elements.dailyTaskWaitingActions.replaceChildren(button);
}

function renderDailyWaitingQueue() {
  if (!elements.dailyWaitingGroups) return;
  const today = todayDateString();
  const stats = dailyWaitingStats();
  elements.dailyWaitingSummary.replaceChildren(
    dailyWaitingSummaryPill("等待中", stats.active, ""),
    dailyWaitingSummaryPill("已逾期", stats.overdue, "danger"),
    dailyWaitingSummaryPill("今日到期", stats.today, "warning"),
    dailyWaitingSummaryPill("已解决", stats.resolved, "")
  );
  renderDailyWaitingAlert();
  renderDailyWaitingTaskOptions();
  elements.dailyWaitingForm.classList.toggle("hidden", !dailyWaitingFormOpen);
  if (dailyWaitingFormOpen) {
    setDailyWaitingContextValues();
    if (!elements.dailyWaitingDueAt.value) elements.dailyWaitingDueAt.value = today;
    if (!elements.dailyWaitingNextFollowUpAt.value) elements.dailyWaitingNextFollowUpAt.value = today;
  }
  const buckets = ["overdue", "today", "future", "closed"];
  elements.dailyWaitingGroups.replaceChildren(
    ...buckets.map((bucket) => dailyWaitingGroup(bucket))
  );
}

function dailyWaitingSummaryPill(label, value, tone) {
  const item = document.createElement("span");
  item.className = ["daily-waiting-summary-pill", tone].filter(Boolean).join(" ");
  item.textContent = `${label} ${value}`;
  return item;
}

function renderDailyWaitingTaskOptions() {
  const currentValue = elements.dailyWaitingTaskId.value;
  elements.dailyWaitingTaskId.replaceChildren(
    ...dailyTasks.map((task) => {
      const option = document.createElement("option");
      option.value = task.id;
      option.textContent = task.name;
      return option;
    })
  );
  elements.dailyWaitingTaskId.value = currentValue || dailyTaskById()?.id || dailyTasks[0]?.id || "";
}

function dailyWaitingGroup(bucket) {
  const section = document.createElement("section");
  section.className = `daily-waiting-group ${bucket}`;
  const heading = document.createElement("h4");
  const items = dailyWaitingItems.filter((item) => waitingItemBucket(item) === bucket);
  heading.textContent = `${waitingBucketTitle(bucket)} ${items.length}`;
  section.append(heading);
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "daily-muted";
    empty.textContent = "暂无记录";
    section.append(empty);
    return section;
  }
  const list = document.createElement("div");
  list.className = "daily-waiting-list";
  items.forEach((item) => list.append(dailyWaitingItemCard(item)));
  section.append(list);
  return section;
}

function dailyWaitingItemCard(item) {
  const card = document.createElement("article");
  card.className = `daily-waiting-item ${waitingItemBucket(item)}`;
  const title = document.createElement("div");
  title.className = "daily-waiting-item-title";
  const name = document.createElement("strong");
  name.textContent = item.store_name || "未命名店铺";
  const status = document.createElement("span");
  status.textContent = waitingStatusLabels[item.status] || item.status;
  title.append(name, status);

  const meta = document.createElement("div");
  meta.className = "daily-waiting-meta";
  [
    waitingTypeLabels[item.waiting_type] || item.waiting_type,
    `负责人：${item.owner || "-"}`,
    `创建：${item.created_by_operator_name || item.operator_name || "-"}`,
    `跟进：${item.next_follow_up_at || "-"}`,
    `到期：${item.due_at || "-"}`
  ].forEach((text) => {
    const chip = document.createElement("span");
    chip.textContent = text;
    meta.append(chip);
  });

  const description = document.createElement("p");
  description.textContent = item.description || "-";
  const note = document.createElement("small");
  note.textContent = item.note ? `备注：${item.note}` : "备注：-";
  const actions = document.createElement("div");
  actions.className = "row-actions";
  const resolveButton = document.createElement("button");
  resolveButton.className = "button secondary";
  resolveButton.type = "button";
  resolveButton.textContent = "标记已解决";
  resolveButton.disabled = item.status !== "waiting";
  resolveButton.addEventListener("click", () => {
    void updateDailyWaitingStatus(item.waiting_id, "resolved");
  });
  const cancelButton = document.createElement("button");
  cancelButton.className = "button secondary";
  cancelButton.type = "button";
  cancelButton.textContent = "标记取消";
  cancelButton.disabled = item.status !== "waiting";
  cancelButton.addEventListener("click", () => {
    void updateDailyWaitingStatus(item.waiting_id, "cancelled");
  });
  actions.append(resolveButton, cancelButton);
  card.append(title, meta, description, note, actions);
  return card;
}

function setDailyWaitingFormOpen(open) {
  dailyWaitingFormOpen = open;
  if (!open && dailyUiState.open_panel === "waiting") dailyUiState.open_panel = null;
  elements.dailyWaitingFormError.classList.add("hidden");
  renderDailyWaitingQueue();
}

function setDailyWaitingContextValues() {
  const task = dailyTaskById();
  const step = currentDailyStep(task);
  const store = currentDailyStore();
  const operator = currentOperatorContext();
  elements.dailyWaitingTaskId.value = task?.id || dailyTasks[0]?.id || "";
  if (!elements.dailyWaitingStoreName.value) elements.dailyWaitingStoreName.value = store?.store_name || "全局任务";
  if (!elements.dailyWaitingStoreId.value) elements.dailyWaitingStoreId.value = store?.store_id || "daily-task-context";
  if (!elements.dailyWaitingOwner.value) elements.dailyWaitingOwner.value = operator.operator_name || "";
  if (!elements.dailyWaitingType.value) elements.dailyWaitingType.value = "other";
  if (elements.dailyWaitingContext) {
    const typeLabel = waitingTypeLabels[elements.dailyWaitingType.value] || "其他等待";
    elements.dailyWaitingContext.textContent =
      `上下文：${store?.store_name || "全局任务"}｜${task?.name || "当前任务"}｜${step?.step_name || "当前步骤"}｜${typeLabel}｜${dailyWaitingFormSource === "step" ? "执行步骤卡点" : "证据与复查"}`;
  }
}

function openDailyWaitingForm(waitingType = "other", source = "task") {
  dailyWaitingFormSource = source;
  dailyEvidenceActionOpen = null;
  expandedDailySopStepId = null;
  dailyUiState.open_evidence_type = null;
  dailyUiState.expanded_sop_step_id = null;
  dailyUiState.open_panel = "waiting";
  resetDailyEvidenceDraft();
  resetDailyWaitingForm();
  const task = dailyTaskById();
  const store = currentDailyStore();
  elements.dailyWaitingTaskId.value = task?.id || dailyTasks[0]?.id || "";
  elements.dailyWaitingStoreName.value = store?.store_name || "全局任务";
  elements.dailyWaitingStoreId.value = store?.store_id || "daily-task-context";
  elements.dailyWaitingType.value = waitingType;
  setDailyWaitingContextValues();
  setDailyWaitingFormOpen(true);
  elements.dailyWaitingForm.scrollIntoView({ behavior: "smooth", block: "center" });
  elements.dailyWaitingOwner.focus();
}

function resetDailyWaitingForm() {
  elements.dailyWaitingForm.reset();
  elements.dailyWaitingTaskId.value = dailyTaskById()?.id || dailyTasks[0]?.id || "";
  const store = currentDailyStore();
  const operator = currentOperatorContext();
  elements.dailyWaitingStoreName.value = store?.store_name || "全局任务";
  elements.dailyWaitingStoreId.value = store?.store_id || "daily-task-context";
  elements.dailyWaitingType.value = "other";
  elements.dailyWaitingOwner.value = operator.operator_name || "";
  const today = todayDateString();
  elements.dailyWaitingDueAt.value = today;
  elements.dailyWaitingNextFollowUpAt.value = today;
  setDailyWaitingContextValues();
}

async function createDailyWaitingItem(event) {
  event.preventDefault();
  elements.dailyWaitingSubmit.disabled = true;
  elements.dailyWaitingFormError.classList.add("hidden");
  const task = dailyTaskById(elements.dailyWaitingTaskId.value);
  const stepIndex = currentDailyStepIndex(task);
  const step = task?.steps?.[stepIndex];
  const operator = currentOperatorContext();
  try {
    await request("/api/daily/waiting-items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        store_name: elements.dailyWaitingStoreName.value,
        store_id: elements.dailyWaitingStoreId.value,
        task_id: elements.dailyWaitingTaskId.value,
        task_name: task?.name || "",
        step_id: dailyUiState.active_step_id,
        step_name: step?.step_name || "",
        operator_id: operator.operator_id,
        operator_name: operator.operator_name,
        created_by_operator_id: operator.operator_id,
        created_by_operator_name: operator.operator_name,
        updated_by_operator_id: operator.operator_id,
        updated_by_operator_name: operator.operator_name,
        waiting_type: elements.dailyWaitingType.value,
        owner: elements.dailyWaitingOwner.value,
        owner_role: elements.dailyWaitingOwnerRole.value,
        description: elements.dailyWaitingDescription.value,
        due_at: elements.dailyWaitingDueAt.value,
        next_follow_up_at: elements.dailyWaitingNextFollowUpAt.value,
        note: elements.dailyWaitingNote.value
      })
    });
    resetDailyWaitingForm();
    dailyWaitingFormOpen = false;
    await refresh();
  } catch (error) {
    elements.dailyWaitingFormError.textContent = error.message;
    elements.dailyWaitingFormError.classList.remove("hidden");
  } finally {
    elements.dailyWaitingSubmit.disabled = false;
  }
}

async function updateDailyWaitingStatus(waitingId, status) {
  const operator = currentOperatorContext();
  await request(`/api/daily/waiting-items/${encodeURIComponent(waitingId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      status,
      updated_by_operator_id: operator.operator_id,
      updated_by_operator_name: operator.operator_name
    })
  });
  await refresh();
}

function dailyTaskHasP0Risk(task) {
  return /(^|\s)P0(\s|：|:|$)|红线|扣分|投诉|断货|亏损|权限受限/.test(task.issueNote || "");
}

function dailyFact(label, value, tone = "") {
  const item = document.createElement("div");
  if (tone) item.classList.add(tone);
  const title = document.createElement("strong");
  const text = document.createElement("span");
  title.textContent = label;
  text.textContent = Array.isArray(value) ? value.join(" / ") : value || "-";
  item.append(title, text);
  return item;
}

function dailyTagGroup(title, values) {
  const group = document.createElement("section");
  const heading = document.createElement("h4");
  const tags = document.createElement("div");
  heading.textContent = title;
  tags.className = "daily-tags";
  values.slice(0, 10).forEach((value) => {
    const tag = document.createElement("span");
    tag.textContent = value;
    tags.append(tag);
  });
  group.append(heading, tags);
  return group;
}

function dailyRiskPill(level) {
  const pill = document.createElement("span");
  pill.className = level.startsWith("P0") ? "p0" : level.startsWith("P1") ? "p1" : "p2";
  pill.textContent = level;
  return pill;
}

function dailyHintBlock(title, values) {
  const block = document.createElement("details");
  const summary = document.createElement("summary");
  const list = document.createElement("ul");
  summary.textContent = title;
  values.forEach((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    list.append(item);
  });
  block.append(summary, list);
  return block;
}

function fillDailyList(element, items) {
  element.replaceChildren(
    ...items.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    })
  );
}

function updateSelectedDailyTask(updates) {
  const task = dailyTaskById();
  Object.assign(task, updates);
  renderDailyCockpit();
}

function startDailyTaskTimer() {
  const task = dailyTaskById();
  const taskRun = task ? dailyTaskRun(task) : null;
  if (!task || taskRun?.status === "done" || taskRun?.status === "in_progress") return;
  task.status = "in_progress";
  taskRun.status = "in_progress";
  taskRun.started_at = taskRun.started_at || new Date().toISOString();
  task.timerStartedAt = Date.now();
  saveCurrentDailyOperatorState();
  renderDailyCockpit();
}

function pauseDailyTaskTimer() {
  const task = dailyTaskById();
  const taskRun = task ? dailyTaskRun(task) : null;
  if (!task || taskRun?.status !== "in_progress") return;
  task.elapsedMs += Date.now() - task.timerStartedAt;
  task.timerStartedAt = 0;
  task.status = "paused";
  taskRun.status = "paused";
  saveCurrentDailyOperatorState();
  renderDailyCockpit();
}

function completeDailyTask() {
  const task = dailyTaskById();
  if (!task) return;
  const taskRun = dailyTaskRun(task);
  if (taskRun?.status === "done") {
    reopenCompletedDailyTask(task);
    return;
  }
  const untreatedSteps = Object.values(dailyStepRuns[task.id] || {}).filter((run) => run.status !== "done").length;
  const taskWaitingCount = dailyWaitingItemsForTask(task.id, true).length;
  const hasStepOutput = Object.values(dailyStepOutputs[task.id] || {}).some((output) => output.status !== "cancelled");
  initDailyStoreTaskProgress();
  const storeProgressRows = Object.values(dailyStoreTaskProgress[task.id] || {});
  const unfinishedStores = storeProgressRows.filter((progress) => !["done", "has_issue", "waiting_external"].includes(dailyStorePriorityStatus(progress)));
  const issueStores = storeProgressRows.filter((progress) => dailyStorePriorityStatus(progress) === "has_issue");
  const waitingStores = storeProgressRows.filter((progress) => dailyStorePriorityStatus(progress) === "waiting_external");
  const hasTaskOutput =
    hasStepOutput ||
    Boolean(task.actionNote.trim()) ||
    Boolean(task.issueNote.trim()) ||
    Boolean(task.noActionReason.trim()) ||
    Boolean(task.followupNote.trim()) ||
    taskWaitingCount > 0;
  const warnings = [];
  if (untreatedSteps) warnings.push(`还有 ${untreatedSteps} 个步骤未处理，是否仍完成？`);
  if (dailyTaskHasP0Risk(task) && !taskWaitingCount && !task.followupNote.trim()) {
    warnings.push("当前任务存在 P0/P1 风险记录，但没有 WaitingItem 或明日复查。");
  }
  if (!hasTaskOutput) warnings.push("当前任务没有留下任何判断结果，是否先记录无动作原因？");
  if (unfinishedStores.length) warnings.push(`还有 ${unfinishedStores.length} 个店铺未完成逐店判断。`);
  if (issueStores.length) warnings.push(`有 ${issueStores.length} 个店铺仍处于问题状态。`);
  if (waitingStores.length) warnings.push(`有 ${waitingStores.length} 个店铺仍在等待外部处理。`);
  const confirmed = window.confirm(
    (warnings.length ? `${warnings.join("\n")}\n\n` : "") +
      "完成任务前请确认：\n" +
      "1. P0/P1 是否已处理或进入 WaitingItem。\n" +
      "2. 是否记录了 ActionLog / Issue / WaitingItem / 无动作原因之一。\n" +
      "3. 是否需要明日复查。\n" +
      "4. 是否完成了当前任务的必要 SOP 步骤。"
  );
  if (!confirmed) return;
  if (taskRun?.status === "in_progress") {
    task.elapsedMs += Date.now() - task.timerStartedAt;
  }
  task.timerStartedAt = 0;
  task.status = "done";
  taskRun.status = "done";
  taskRun.completed_at = new Date().toISOString();
  dailyEvidenceActionOpen = null;
  expandedDailySopStepId = null;
  dailyUiState.open_evidence_type = null;
  dailyUiState.expanded_sop_step_id = null;
  dailyUiState.open_panel = null;
  resetDailyEvidenceDraft();
  saveCurrentDailyOperatorState();
  renderDailyCockpit();
}

function reopenCompletedDailyTask(task) {
  const taskRun = task ? dailyTaskRun(task) : null;
  if (!task || taskRun?.status !== "done") return;
  const confirmed = window.confirm("确定撤回该任务完成状态吗？已记录的步骤输出不会删除。");
  if (!confirmed) return;
  const firstOpenIndex = task.steps.findIndex((_, index) => dailyStepRun(task, index)?.status !== "done");
  task.status = "paused";
  taskRun.status = "paused";
  taskRun.reopened_at = new Date().toISOString();
  task.timerStartedAt = 0;
  const nextIndex = firstOpenIndex === -1 ? Math.max(0, task.steps.length - 1) : firstOpenIndex;
  task.activeStepIndex = nextIndex;
  taskRun.active_step_id = dailyStepId(task, nextIndex);
  dailyUiState.active_step_id = taskRun.active_step_id;
  dailyEvidenceActionOpen = null;
  expandedDailySopStepId = null;
  dailyUiState.open_evidence_type = null;
  dailyUiState.expanded_sop_step_id = null;
  dailyUiState.open_panel = null;
  resetDailyEvidenceDraft();
  saveCurrentDailyOperatorState();
  renderDailyCockpit();
}

function renderDailyReport() {
  const completedTasks = dailyTasks.filter((task) => dailyTaskRun(task)?.status === "done");
  const activeTasks = dailyTasks.filter((task) => ["in_progress", "paused"].includes(dailyTaskRun(task)?.status));
  const pendingTasks = dailyTasks.filter((task) => dailyTaskRun(task)?.status === "not_started");
  const groups = [
    ["已完成任务", completedTasks.map((task) => task.name)],
    ["进行中任务", activeTasks.map((task) => `${task.name}｜${dailyStatusLabel(dailyTaskRun(task)?.status)}`)],
    ["未完成任务", pendingTasks.map((task) => task.name)],
    ["今日动作记录", dailyTasks.filter((task) => task.actionNote.trim()).map((task) => `${task.name}：${task.actionNote.trim()}`)],
    ["今日问题", dailyTasks.filter((task) => task.issueNote.trim()).map((task) => `${task.name}：${task.issueNote.trim()}`)],
    ["无动作原因", dailyTasks.filter((task) => task.noActionReason.trim()).map((task) => `${task.name}：${task.noActionReason.trim()}`)],
    ["明日复查项", dailyTasks.filter((task) => task.followupNote.trim()).map((task) => `${task.name}：${task.followupNote.trim()}`)]
  ];
  const completed = completedTasks.length;
  const active = activeTasks.length;
  const pending = pendingTasks.length;
  const actions = groups[3][1].length;
  const issues = groups[4][1].length;
  const noActions = groups[5][1].length;
  const followups = groups[6][1].length;
  elements.dailyReportSummary.textContent =
    `日报预览：已完成 ${completed}｜进行中 ${active}｜未完成 ${pending}｜动作 ${actions}｜问题 ${issues}｜明日复查 ${followups}`;
  const summary = [
    `今日完成 ${completed}/${dailyTasks.length} 项任务。`,
    actions ? `产生 ${actions} 条动作记录。` : "暂无动作记录。",
    issues ? `暴露 ${issues} 个问题。` : "暂无问题记录。",
    noActions ? `记录 ${noActions} 条无动作原因。` : "暂无无动作原因。",
    followups ? `明日需复查 ${followups} 项。` : "暂无明日复查项。"
  ].join(" ");
  elements.dailyReportPreview.replaceChildren(
    ...groups.map(([title, items]) => dailyReportBlock(title, items)),
    dailyReportBlock("主管摘要", [summary])
  );
}

function dailyReportBlock(title, items) {
  const block = document.createElement("section");
  const heading = document.createElement("h4");
  heading.textContent = title;
  const list = document.createElement("ul");
  const values = items.length ? items : ["暂无记录"];
  values.forEach((text) => {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  });
  block.append(heading, list);
  return block;
}

function tickDailyCockpit() {
  if (!elements.dailyTaskList) return;
  const hasRunning = dailyTasks.some((task) => dailyTaskRun(task)?.status === "in_progress");
  if (!hasRunning) return;
  renderDailyCockpit();
}

function productSourceTag(product, profile) {
  const notes = profile?.notes || product?.notes || "";
  const match = notes.match(/\[source:\s*([a-z_]+)\]/);
  return match?.[1] && productSourceCopy[match[1]]
    ? match[1]
    : "";
}

function productSourceLabel(product, profile) {
  const sourceTag = productSourceTag(product, profile);
  return sourceTag ? productSourceCopy[sourceTag].label : "未标记";
}

function configureTopbarAction(button, action) {
  if (!button || !action) return;
  const [label, view] = action;
  button.textContent = label;
  button.dataset.targetView = view;
}

function updateNewProductCreationTypeUI() {
  const sourceTag = elements.newProductCreationType?.value || "new_product_development";
  elements.newProductInventoryFields?.classList.toggle("hidden", sourceTag !== "inventory_driven");
  elements.newProductHint.textContent = productSourceCopy[sourceTag]?.hint || "";
  elements.createNewProductButton.textContent =
    sourceTag === "live_legacy_import"
      ? "去创建老品档案并接入"
      : "新建商品档案";
}

function showInsertEditor() {
  insertProfileVisible = false;
  selectedArchivedProfile = undefined;
  elements.insertWorkspace.classList.remove("hidden");
  elements.viewPanels.forEach((panel) => panel.classList.remove("active"));
  elements.navItems.forEach((item) => item.classList.remove("active"));
  elements.returnToInsertEditorButton.classList.add("hidden");
}

function setTaskDockExpanded(expanded) {
  elements.taskDock.classList.toggle("expanded", expanded);
  elements.taskDockDetails.classList.toggle("hidden", !expanded);
  elements.taskDockToggle.textContent = expanded ? "⌄" : "⌃";
  elements.taskDockToggle.setAttribute(
    "aria-label",
    expanded ? "折叠运行详情" : "展开运行详情"
  );
  elements.taskDockIndicator.setAttribute(
    "aria-label",
    expanded ? "当前运行状态" : "展开运行详情"
  );
  localStorage.setItem("taskDockExpanded", String(expanded));
}

function setSettingsOpen(open) {
  elements.settingsDrawer.classList.toggle("open", open);
  elements.settingsDrawer.setAttribute("aria-hidden", String(!open));
  elements.settingsBackdrop.classList.toggle("hidden", !open);
  document.body.classList.toggle("drawer-open", open);
}

function secretaryElements() {
  return {
    shell: document.querySelector("#secretaryDrawer"),
    panel: document.querySelector("#secretaryPanel"),
    toggle: document.querySelector("#secretaryToggle"),
    collapse: document.querySelector("#secretaryCollapse"),
    modeToggle: document.querySelector("#secretaryModeToggle"),
    close: document.querySelector("#secretaryClose"),
    header: document.querySelector("#secretaryHeader"),
    context: document.querySelector("#secretaryContext"),
    input: document.querySelector("#secretaryInput"),
    output: document.querySelector("#secretaryOutput"),
    messageList: document.querySelector("#secretaryMessageList"),
    intent: document.querySelector("#secretaryIntent"),
    nextAction: document.querySelector("#secretaryNextAction"),
    risk: document.querySelector("#secretaryRisk"),
    confirmation: document.querySelector("#secretaryConfirmation"),
    raw: document.querySelector("#secretaryRawOutput"),
    send: document.querySelector("#secretarySend"),
    codexPrompt: document.querySelector("#secretaryCodexPrompt")
  };
}

function updateSecretaryContext(view = activeViewName()) {
  const secretary = secretaryElements();
  if (!secretary.context) return;
  const workspace = viewWorkspace[normalizeView(view)] || "today";
  const copy = commerceTopbarCopy[normalizeView(view)] || commerceTopbarCopy["daily-cockpit"];
  secretary.context.textContent = `当前页面：${copy.title || "今日指挥台"}｜工作区：${workspace}`;
}

function applySecretaryMode(mode = secretaryMode) {
  const secretary = secretaryElements();
  if (!secretary.shell) return;
  secretaryMode = ["collapsed", "docked", "floating"].includes(mode) ? mode : "docked";
  secretary.shell.classList.toggle("is-collapsed", secretaryMode === "collapsed");
  secretary.shell.classList.toggle("is-docked", secretaryMode === "docked");
  secretary.shell.classList.toggle("is-floating", secretaryMode === "floating");
  document.body.classList.toggle("secretary-docked", secretaryMode === "docked");
  if (secretary.modeToggle) {
    secretary.modeToggle.textContent = secretaryMode === "floating" ? "⇥" : "⇱";
    secretary.modeToggle.setAttribute(
      "aria-label",
      secretaryMode === "floating" ? "停靠右侧" : "切换为浮动"
    );
  }
  if (secretaryMode === "floating") restoreSecretaryFloatingRect();
  localStorage.setItem("yk_secretary_mode", secretaryMode);
  updateSecretaryContext();
}

function clampSecretaryRect(left, top, width, height) {
  const margin = 12;
  const maxWidth = Math.max(320, Math.floor(window.innerWidth * 0.7));
  const safeWidth = Math.min(Math.max(width, 320), maxWidth);
  const safeHeight = Math.min(Math.max(height, 420), Math.max(420, window.innerHeight - margin * 2));
  return {
    left: Math.min(Math.max(left, margin), Math.max(margin, window.innerWidth - safeWidth - margin)),
    top: Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - safeHeight - margin)),
    width: safeWidth,
    height: safeHeight
  };
}

function restoreSecretaryFloatingRect() {
  const secretary = secretaryElements();
  if (!secretary.shell) return;
  let rect = null;
  try {
    rect = JSON.parse(localStorage.getItem("yk_secretary_rect") || "null");
  } catch {
    rect = null;
  }
  const safe = clampSecretaryRect(
    Number(rect?.left ?? window.innerWidth - 440),
    Number(rect?.top ?? 80),
    Number(rect?.width ?? 400),
    Number(rect?.height ?? 560)
  );
  Object.assign(secretary.shell.style, {
    left: `${safe.left}px`,
    top: `${safe.top}px`,
    width: `${safe.width}px`,
    height: `${safe.height}px`
  });
}

function saveSecretaryFloatingRect() {
  const secretary = secretaryElements();
  if (!secretary.shell || secretaryMode !== "floating") return;
  const rect = secretary.shell.getBoundingClientRect();
  const safe = clampSecretaryRect(rect.left, rect.top, rect.width, rect.height);
  localStorage.setItem("yk_secretary_rect", JSON.stringify(safe));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function appendSecretaryMessage(role, text) {
  const secretary = secretaryElements();
  if (!secretary.messageList) return;
  const article = document.createElement("article");
  article.className = `secretary-message ${role}`;
  article.innerHTML = `<strong>${role === "user" ? "你" : "秘书"}</strong><p>${escapeHtml(text)}</p>`;
  secretary.messageList.append(article);
  secretary.messageList.scrollTop = secretary.messageList.scrollHeight;
}

function renderSecretaryResponse(body) {
  const secretary = secretaryElements();
  const result = body?.result || body || {};
  const draft = result.draft_command ? JSON.stringify(result.draft_command, null, 2) : "暂无草稿";
  if (secretary.intent) secretary.intent.textContent = result.interpreted_intent || "已收到指令";
  if (secretary.nextAction) secretary.nextAction.textContent = result.suggested_next_action || "生成本地草稿";
  if (secretary.risk) secretary.risk.textContent = result.risk_level || "-";
  if (secretary.confirmation) secretary.confirmation.textContent = result.requires_confirmation ? "需要确认" : "不需要确认";
  if (secretary.raw) secretary.raw.textContent = JSON.stringify(body, null, 2);
  appendSecretaryMessage(
    "agent",
    `${result.suggested_next_action || "已生成占位结果"}。风险等级：${result.risk_level || "-"}。可执行草稿：${draft}`
  );
}

async function loadTodayDashboardProjection() {
  const fields = {
    hiddenTodayTaskCount: "today_task_count",
    hiddenQclawPendingCount: "qclaw_pending_approval",
    hiddenQclawRunningCount: "qclaw_running",
    hiddenQclawFailedCount: "qclaw_failed_or_needs_human",
    hiddenReviewPendingCount: "pending_review_count",
    hiddenKnowledgePendingCount: "knowledge_pending_review"
  };
  try {
    const body = await request(`/api/today-dashboard?includeTestData=${hiddenDashboardIncludeTestData ? "true" : "false"}`);
    Object.entries(fields).forEach(([id, key]) => {
      const node = document.querySelector(`#${id}`);
      if (node) node.textContent = String(body.dashboard?.[key] ?? 0);
    });
    const dashboard = body.dashboard || {};
    const includesTest = dashboard.include_test_data === true;
    const badge = document.querySelector("#hiddenDataModeBadge");
    const note = document.querySelector("#hiddenDataModeNote");
    const toggle = document.querySelector("#hiddenTestDataToggle");
    const json = document.querySelector("#hiddenDashboardJsonText");
    if (badge) {
      badge.textContent = includesTest ? "包含测试数据" : "正式数据";
      badge.classList.toggle("is-warning", includesTest);
    }
    if (note) {
      note.textContent = includesTest
        ? "smoke / qa 测试记录：当前包含。当前包含 smoke / qa 测试记录，不可同步 3000。"
        : "smoke / qa 测试记录：已过滤。当前已过滤 smoke / qa 测试记录。";
      note.classList.toggle("is-warning", includesTest);
    }
    if (toggle) toggle.textContent = includesTest ? "隐藏测试数据" : "包含测试数据";
    if (json) json.textContent = JSON.stringify(dashboard, null, 2);
  } catch (error) {
    const node = document.querySelector("#hiddenQclawFailedCount");
    if (node) node.textContent = "!";
  }
}

async function submitSecretaryMessage(kind = "chat") {
  const secretary = secretaryElements();
  if (!secretary.input || !secretary.output) return;
  const message = secretary.input.value.trim();
  if (!message) {
    appendSecretaryMessage("agent", "请输入指令。");
    return;
  }
  appendSecretaryMessage("user", message);
  appendSecretaryMessage("agent", "正在生成本地草稿...");
  try {
    const body = await request("/api/secretary/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        page_context: {
          view: activeViewName(),
          workspace: viewWorkspace[normalizeView(activeViewName())] || "today",
          mode: kind
        },
        risk_level: "L1"
      })
    });
    renderSecretaryResponse(body);
    await loadTodayDashboardProjection();
  } catch (error) {
    appendSecretaryMessage("agent", error.message);
  }
}

function setProductionFlowStep(view) {
  const step = PRODUCTION_FLOW_STEPS[normalizeView(view)] || PRODUCTION_FLOW_STEPS.materials;
  document.querySelectorAll(".scene-tabs[aria-label=\"上品场景页内入口\"] .scene-tab").forEach((tab) => {
    tab.classList.toggle("active", normalizeView(tab.dataset.homeView) === step.view);
  });
}

function createProductionFlowTabs() {
  const tabs = document.createElement("div");
  tabs.className = "scene-tabs production-flow-tabs";
  tabs.setAttribute("aria-label", "上品场景页内入口");
  for (const step of Object.values(PRODUCTION_FLOW_STEPS)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "scene-tab";
    button.dataset.homeView = step.view;
    button.textContent = step.label;
    tabs.append(button);
  }
  return tabs;
}

function ensureProductionFlowTabs() {
  for (const view of PRODUCTION_FLOW_VIEWS) {
    const panel = document.querySelector(`[data-view-panel="${view}"]`);
    if (!panel || panel.querySelector(".scene-tabs[aria-label=\"上品场景页内入口\"]")) continue;
    const heading = panel.querySelector(".section-heading");
    const tabs = createProductionFlowTabs();
    if (heading) heading.insertAdjacentElement("afterend", tabs);
    else panel.prepend(tabs);
  }
}

function isStandardRecoverableState(state) {
  return (
    state &&
    state.workflowMode !== "luxury_insert" &&
    !state.running &&
    !state.autoRun &&
    Boolean(state.chatUrl) &&
    ["FAILED", "PAUSED"].includes(state.stage)
  );
}

function isResearchRecoveryState(state) {
  return (
    isStandardRecoverableState(state) &&
    !state.researchCompleted &&
    (
      ["WAITING_FOR_RESEARCH", "SENDING_RESEARCH"].includes(state.interruptedStage) ||
      state.completedPhase === "MVP1"
    )
  );
}

function planningEndpointForState(state) {
  if (!state.chatUrl) {
    return "/api/run";
  }
  return isResearchRecoveryState(state) ? "/api/run/resume" : "/api/run/planning";
}

function renderProductionConsole(state, availableImages, busy, queueLocked) {
  const tabs = document.querySelector("[data-view-panel=\"materials\"] .scene-tabs[aria-label=\"上品场景页内入口\"]");
  if (!tabs) return;
  let console = document.querySelector("#productionConsole");
  if (!console) {
    console = document.createElement("div");
    console.id = "productionConsole";
    console.className = "production-console";
    tabs.insertAdjacentElement("afterend", console);
  }

  /* ── 流程模式 ── */
  const seoOnly = state?.standardWorkflowGoal === "seo_content_only";
  const generatedCount = (state?.generatedImageNumbers || []).length;
  const overallProgress = workflowProgress(state || {});
  const hasImages = (availableImages || []).length > 0;
  const canRecoverResearch = isResearchRecoveryState(state);
  const readyToArchive =
    !busy &&
    !queueLocked &&
    state?.workflowMode !== "luxury_insert" &&
    Boolean(state?.chatUrl) &&
    completedAtLeast(state, "MVP5");

  /* ── 面板标题区（含模式切换） ── */
  const header = document.createElement("div");
  header.className = "workbench-header";
  header.innerHTML = `<span class="mini-label workbench-kicker">${
    seoOnly ? "ENHANCED SEO CONTENT WORKFLOW" : "AUTOMATED COMMERCE WORKFLOW"
  }</span><strong>${
    seoOnly ? "从产品事实到高转化文案，跳过作图。" : "从产品素材到高转化 Listing，一次完成。"
  }</strong><p class="workbench-desc">${
    seoOnly
      ? "自动完成产品识别、联网市场调研、VOC、SEO 关键词、标题、属性词和详情页内容。"
      : "自动完成产品识别、市场调研、视觉规划、10 张图片生成，以及 SEO 商品文案。"
  }</p>`;

  /* 模式切换器 */
  const modeSwitch = document.createElement("div");
  modeSwitch.className = "workbench-mode-switch";
  modeSwitch.setAttribute("aria-label", "选择流程模式");
  const modeLabel = document.createElement("span");
  modeLabel.className = "mode-label";
  modeLabel.textContent = "流程模式";
  const fullBtn = document.createElement("button");
  fullBtn.type = "button";
  fullBtn.className = `mode-option${!seoOnly ? " active" : ""}`;
  fullBtn.textContent = "完整 Listing";
  fullBtn.addEventListener("click", () => void selectStandardWorkflowGoal("full_listing"));
  const seoBtn = document.createElement("button");
  seoBtn.type = "button";
  seoBtn.className = `mode-option${seoOnly ? " active" : ""}`;
  seoBtn.textContent = "仅 SEO 与商品文案";
  seoBtn.addEventListener("click", () => void selectStandardWorkflowGoal("seo_content_only"));
  const insertBtn = document.createElement("button");
  insertBtn.type = "button";
  insertBtn.className = "mode-option";
  insertBtn.title = "切换到奢侈包内胆 Listing 制作流程";
  insertBtn.textContent = "内胆 Listing";
  insertBtn.addEventListener("click", () => void selectWorkflowMode("luxury_insert"));
  modeSwitch.append(modeLabel, fullBtn, seoBtn, insertBtn);

  /* ── 指标卡片 ── */
  const metrics = document.createElement("div");
  metrics.className = "workbench-metrics";
  const phaseText =
    seoOnly && state?.completedPhase === "MVP5"
      ? "SEO 完成"
      : seoOnly && state?.researchCompleted
        ? "调研完成"
        : (phaseLabels[state?.completedPhase] || (busy ? "运行中" : "待开始"));
  metrics.innerHTML =
    `<article><strong>${hasImages ? availableImages.length : 0}</strong><span>产品素材</span></article>` +
    `<article><strong>${escapeHtml(phaseText)}</strong><span>当前阶段</span></article>` +
    `<article><strong>${seoOnly ? "已跳过" : `${generatedCount}/10`}</strong><span>${seoOnly ? "图片生成" : "生成图片"}</span></article>`;

  /* ── 进度条 ── */
  const progressWrap = document.createElement("div");
  progressWrap.className = "workbench-progress";
  progressWrap.innerHTML = `<div><span>整体进度</span><strong>${Math.round(overallProgress)}%</strong></div>` +
    `<div class="progress${busy || queueLocked ? " is-running" : ""}"><span style="width:${overallProgress}%"></span></div>`;

  /* ── 操作按钮区 ── */
  const actions = document.createElement("div");
  actions.className = "workbench-actions";

  /* 一键全部流程按钮（复用 runAllButton 逻辑） */
  const runAllBtn = document.createElement("button");
  runAllBtn.type = "button";
  runAllBtn.id = "workbenchRunAllButton";
  runAllBtn.className = "flow-primary-action workbench-run-all";
  const runAllDisabled =
    busy ||
    queueLocked ||
    hasImages === 0 ||
    completedAtLeast(state, "MVP5") ||
    !(window.latestPrompts?.research?.ready) ||
    (!seoOnly && !(window.latestPrompts?.planning?.ready)) ||
    !(window.latestPrompts?.seoKeywords?.ready) ||
    !(window.latestPrompts?.listingContent?.ready);
  runAllBtn.disabled = runAllDisabled;
  /* 禁用时给出明确原因，帮助用户快速定位下一步操作 */
  if (runAllDisabled) {
    let reason = "";
    if (busy || queueLocked) reason = "当前有任务正在运行，请稍候。";
    else if (completedAtLeast(state, "MVP5")) reason = seoOnly ? "SEO 与商品文案已全部完成。" : "全部流程已完成，可归档并开始下一个产品。";
    else if (hasImages === 0) reason = "请先上传当前商品素材，再开始流程。";
    else if (!(window.latestPrompts?.research?.ready)) reason = "市场调研 Prompt 尚未就绪。";
    else if (!seoOnly && !(window.latestPrompts?.planning?.ready)) reason = "视觉规划 Prompt 尚未就绪。";
    else if (!(window.latestPrompts?.seoKeywords?.ready)) reason = "SEO 关键词 Prompt 尚未就绪。";
    else if (!(window.latestPrompts?.listingContent?.ready)) reason = "商品文案 Prompt 尚未就绪。";
    runAllBtn.title = reason;
    runAllBtn.setAttribute("aria-disabled", "true");
  } else {
    runAllBtn.title = "一键执行当前模式下的全部上品流程";
    runAllBtn.removeAttribute("aria-disabled");
  }
  if (completedAtLeast(state, "MVP5")) {
    runAllBtn.textContent = seoOnly ? "SEO 与商品文案已完成" : "全部流程已完成";
  } else if (state?.completedPhase) {
    runAllBtn.textContent = seoOnly ? "一键继续 SEO 专线" : "一键继续剩余流程";
  } else {
    runAllBtn.textContent = seoOnly ? "一键生成 SEO 与商品文案" : "一键开始全部流程";
  }
  /* 运行态：显示加载环，提示操作已受理 */
  if (busy || queueLocked) runAllBtn.classList.add("is-busy");
  runAllBtn.addEventListener("click", () => void runAction(runAllBtn, "/api/run/all"));


  /* 原有：按步骤操作按钮 */
  const primaryLabel = canRecoverResearch
    ? "从断点继续市场调研"
    : readyToArchive
      ? "归档并开始下一个产品"
      : state?.chatUrl
        ? "继续当前上品流程"
        : "开始产品识别";
  const primaryTarget = canRecoverResearch
    ? "planning"
    : readyToArchive
      ? "archive"
      : state?.chatUrl
        ? (state.researchCompleted ? "content" : "planning")
        : "identity";
  const stepBtn = document.createElement("button");
  stepBtn.type = "button";
  stepBtn.className = "flow-secondary-action";
  stepBtn.textContent = primaryLabel;
  stepBtn.disabled = busy || queueLocked || (!state?.chatUrl && !hasImages);
  stepBtn.addEventListener("click", () => {
    if (primaryTarget === "archive") { void startNextProduct(); return; }
    goProductionFlowStep(primaryTarget);
  });

  /* 查看商品事实 */
  const factsBtn = document.createElement("button");
  factsBtn.type = "button";
  factsBtn.className = "text-button quick-action-btn";
  factsBtn.textContent = "查看商品事实";
  factsBtn.addEventListener("click", () => goProductionFlowStep("materials"));

  /* 选品快捷入口 */
  const quickActions = document.createElement("div");
  quickActions.className = "workbench-quick-actions";
  const radarBtn = document.createElement("button");
  radarBtn.type = "button";
  radarBtn.className = "text-button quick-action-btn";
  radarBtn.textContent = "机会雷达";
  radarBtn.setAttribute("data-home-view", "selection-radar");
  radarBtn.addEventListener("click", () => switchView("selection-radar"));
  const reviewBtn = document.createElement("button");
  reviewBtn.type = "button";
  reviewBtn.className = "text-button quick-action-btn";
  reviewBtn.textContent = "选品复盘";
  reviewBtn.setAttribute("data-home-view", "operation-review");
  reviewBtn.addEventListener("click", () => switchView("operation-review"));
  quickActions.append(radarBtn, reviewBtn);

  /* 上架店小秘（来自上品资料包）：MVP5 完成后出现 */
  // 稳定性关键：选择器做成 document.body 上的「单例」，任何面板每秒重建都摘不到它，
  // 因此 <select> 永不被 detach/attach，下拉可稳定展开、不再闪跳。位置每 tick 重新锚定到按钮。
  let listBtn;
  if (readyToArchive) {
    // 确保可用类目 profile 已加载（乳贴/箱包配件）
    void dxLoadProfiles();

    const profiles = dianxiaomiState.profiles && dianxiaomiState.profiles.length
      ? dianxiaomiState.profiles
      : [
          { key: "ruTie", label: "乳贴", templateProductId: "1005005575013300" },
          { key: "xiangBao", label: "箱包配件", templateProductId: "1005012741652735" }
        ];
    const currentKey = dianxiaomiState.profileKey || "ruTie";
    const selectedProfile = profiles.find((p) => p.key === currentKey);

    // 单例：只创建一次，挂在 body 上，永不被任何面板重建摘除
    let dxProfileBar = document.getElementById("dx-console-profile-bar");
    if (!dxProfileBar) {
      dxProfileBar = document.createElement("div");
      dxProfileBar.id = "dx-console-profile-bar";
      dxProfileBar.className = "dx-console-profile-bar";
      dxProfileBar.style.position = "fixed";
      dxProfileBar.style.zIndex = "50";
      document.body.appendChild(dxProfileBar);

      const dxProfileWrap = document.createElement("div");
      dxProfileWrap.id = "dx-console-profile-wrap";
      dxProfileWrap.className = "dx-console-profile-wrap";
      dxProfileWrap.style.display = "inline-flex";
      dxProfileWrap.style.alignItems = "center";
      dxProfileWrap.style.gap = "6px";
      dxProfileWrap.style.padding = "4px 8px";
      dxProfileWrap.style.background = "var(--surface, #fff)";
      dxProfileWrap.style.border = "1px solid var(--border, #ddd)";
      dxProfileWrap.style.borderRadius = "6px";
      dxProfileWrap.style.boxShadow = "0 2px 8px rgba(0,0,0,.12)";

      const dxProfileLabel = document.createElement("label");
      dxProfileLabel.textContent = "上架模板:";
      dxProfileLabel.style.fontSize = "12px";
      dxProfileLabel.style.color = "var(--text-secondary)";

      const dxProfileSelect = document.createElement("select");
      dxProfileSelect.id = "dx-console-profile";
      dxProfileSelect.className = "dx-console-profile-select";
      profiles.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.key;
        opt.textContent = p.label + " (" + p.templateProductId + ")";
        dxProfileSelect.appendChild(opt);
      });
      dxProfileSelect.value = currentKey;
      dxProfileSelect.addEventListener("change", (e) => {
        dianxiaomiState.profileKey = e.target.value;
        dxLogLine("⋅ 上架模板已切换: " + e.target.value);
        // 轻量更新按钮 title，不触发全局重绘（避免闪跳）
        const btn = document.getElementById("dx-console-apply-btn");
        if (btn) {
          const sp = profiles.find((pp) => pp.key === e.target.value);
          btn.title = "把当前产品资料包填入店小秘 ERP 并保存草稿（不发布）。当前模板：" +
            (sp ? sp.label + " / " + sp.templateProductId : e.target.value);
        }
      });

      dxProfileWrap.append(dxProfileLabel, dxProfileSelect);
      dxProfileBar.appendChild(dxProfileWrap);
    }
    else {
      // 已存在：仅同步选中值（可能从店小秘面板切换过），绝不重建 DOM
      const existingSelect = dxProfileBar.querySelector("#dx-console-profile");
      if (existingSelect && existingSelect.value !== currentKey) {
        existingSelect.value = currentKey;
      }
    }

    listBtn = document.createElement("button");
    listBtn.id = "dx-console-apply-btn";
    listBtn.type = "button";
    listBtn.className = "flow-secondary-action dx-console-apply";
    listBtn.textContent = "上架店小秘（草稿）";
    listBtn.disabled = busy || queueLocked;
    listBtn.title = "把当前产品资料包填入店小秘 ERP 并保存草稿（不发布）。当前模板：" +
      (selectedProfile ? selectedProfile.label + " / " + selectedProfile.templateProductId : currentKey);
    listBtn.addEventListener("click", () => void listingApplyToDianxiaomi());
  }
  const consoleActions = [runAllBtn, stepBtn, factsBtn];
  if (listBtn) consoleActions.push(listBtn);
  consoleActions.push(quickActions);
  actions.append(...consoleActions);

  /* 组装面板 */
  const leftCol = document.createElement("div");
  leftCol.className = "workbench-left";
  leftCol.append(header, modeSwitch, actions);
  const rightCol = document.createElement("div");
  rightCol.className = "workbench-right";
  rightCol.append(metrics, progressWrap);
  console.replaceChildren(leftCol, rightCol);

  /* 把「上架模板」选择器锚定到「上架店小秘」按钮正下方（仅 MVP5 完成后、控制台可见时显示） */
  const dxBar = document.getElementById("dx-console-profile-bar");
  if (dxBar) {
    if (readyToArchive && console.offsetParent !== null && listBtn) {
      dxBar.style.display = "block";
      const dxSel = dxBar.querySelector("#dx-console-profile");
      // 用户正在操作下拉时本 tick 不重定位，避免抖动/误关下拉
      if (!(dxSel && document.activeElement === dxSel)) {
        const r = listBtn.getBoundingClientRect();
        dxBar.style.top = (r.bottom + 6) + "px";
        dxBar.style.left = r.left + "px";
      }
    }
    else {
      dxBar.style.display = "none";
    }
  }
}

function renderVisualReferenceLock(assets) {
  const panel = document.querySelector("[data-view-panel=\"images\"] .panel");
  if (!panel) return;
  let box = document.querySelector("#visualReferenceLock");
  if (!box) {
    box = document.createElement("div");
    box.id = "visualReferenceLock";
    box.className = "visual-reference-lock";
    const anchor = document.querySelector("#generationSteps");
    if (anchor) anchor.insertAdjacentElement("beforebegin", box);
    else panel.prepend(box);
  }
  const images = assets?.source_images || [];
  const ready = Boolean(assets?.active_reference_set_id && images.length);
  const header = document.createElement("div");
  header.className = "visual-reference-header";
  const text = document.createElement("div");
  text.innerHTML = `<span class="mini-label">PRODUCT IDENTITY LOCK</span><strong></strong><p></p>`;
  text.querySelector("strong").textContent = ready
    ? "已锁定为唯一产品视觉参考"
    : "缺少产品源图绑定，禁止生成";
  text.querySelector("p").textContent = ready
    ? `Product ID：${assets.product_id}｜Reference Set：${assets.active_reference_set_id}`
    : "请回到商品事实上传或重新绑定产品参考图。";
  const badge = document.createElement("span");
  badge.className = ready ? "visual-lock-badge ready" : "visual-lock-badge blocked";
  badge.textContent = ready ? "可生成" : "阻断";
  header.append(text, badge);

  const thumbs = document.createElement("div");
  thumbs.className = "visual-reference-thumbs";
  images.forEach((image) => {
    const item = document.createElement("article");
    item.className = "visual-reference-thumb";
    const img = document.createElement("img");
    img.src = image.thumbnailUrl;
    img.alt = image.original_filename;
    img.loading = "lazy";
    const caption = document.createElement("span");
    caption.textContent = `${image.role} · ${image.original_filename}`;
    item.append(img, caption);
    thumbs.append(item);
  });
  if (!images.length) {
    const empty = document.createElement("p");
    empty.className = "visual-reference-empty";
    empty.textContent = "未找到 active reference source image。";
    thumbs.append(empty);
  }
  box.classList.toggle("blocked", !ready);
  box.replaceChildren(header, thumbs);
}

function renderGenerationQcPanel(state) {
  const panel = document.querySelector("[data-view-panel=\"images\"] .panel");
  if (!panel) return;
  let box = document.querySelector("#generationQcPanel");
  if (!box) {
    box = document.createElement("div");
    box.id = "generationQcPanel";
    box.className = "generation-qc-panel";
    const anchor = document.querySelector("#generationSteps");
    if (anchor) anchor.insertAdjacentElement("beforebegin", box);
    else panel.prepend(box);
  }
  const storyboard = state?.storyboardGate;
  const preQc = state?.currentPreGenerationQc;
  const postQc = state?.postGenerationQc || {};
  const postEntries = Object.entries(postQc);
  const storyboardReady = Boolean(storyboard?.qc_summary?.can_generate_prompt_pack);
  const statusRows = [
    {
      label: "Storyboard Gate",
      value: storyboardReady ? "通过" : "未通过 / 待生成",
      tone: storyboardReady ? "pass" : "pending",
      detail: storyboard?.qc_summary?.errors?.[0] || storyboard?.qc_summary?.warnings?.[0] || "10 图角色、买家问题、卖点与视觉证据检查"
    },
    {
      label: "Pre-generation QC",
      value: preQc?.qc_status === "pass" ? `Image ${preQc.image_number} 通过` : preQc ? `Image ${preQc.image_number || "-"} 未通过` : "待生图",
      tone: preQc?.qc_status === "pass" ? "pass" : preQc ? "failed" : "pending",
      detail: preQc?.errors?.[0] || preQc?.warnings?.[0] || "每张图生成前按 Storyboard Gate 拦截"
    },
    {
      label: "Post QC",
      value: postEntries.length ? `${postEntries.length} 张已记录` : "待生成后检查",
      tone: postEntries.length ? "pending" : "pending",
      detail: postEntries.length
        ? "已完成技术保存检查；货不对板、文字错误和构图重复需人工视觉 QC"
        : "生成后写入 QC 状态，失败则阻断后续"
    }
  ];
  const header = document.createElement("div");
  header.className = "generation-qc-header";
  header.innerHTML = "<span class=\"mini-label\">SOP GATES</span><strong>生图流程质量闸</strong>";
  const list = document.createElement("div");
  list.className = "generation-qc-list";
  statusRows.forEach((row) => {
    const item = document.createElement("article");
    item.className = `generation-qc-item ${row.tone}`;
    const title = document.createElement("div");
    title.innerHTML = `<strong></strong><span></span>`;
    title.querySelector("strong").textContent = row.label;
    title.querySelector("span").textContent = row.value;
    const detail = document.createElement("p");
    detail.textContent = row.detail;
    item.append(title, detail);
    list.append(item);
  });
  box.replaceChildren(header, list);
}

function goProductionFlowStep(view) {
  const step = PRODUCTION_FLOW_STEPS[normalizeView(view)];
  if (!step) return;
  setProductionFlowStep(step.view);
  switchView(step.view);
}

async function createProductionQclawDraft(button) {
  const originalText = button?.textContent;
  const hint = document.querySelector("#productionQclawDraftHint");
  if (button) {
    button.disabled = true;
    button.textContent = "正在生成草稿...";
  }
  try {
    const body = await request("/api/qclaw/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "qclaw.task",
        source: "website",
        title: "上架质检 QClaw 上架任务草稿",
        description: "来自业务场景 > 上品 > 上架质检。仅生成草稿，等待人工确认后才允许外部执行。",
        risk_level: "L3",
        status: "pending_approval",
        payload: {
          flow: "production_listing",
          step: "qa",
          requires_human_approval: true
        }
      })
    });
    const status = body.task?.status || "pending_approval";
    if (hint) hint.textContent = `已生成草稿：${body.task?.id || "-"}，状态 ${status}。不会直接执行。`;
    await loadTodayDashboardProjection();
  } catch (error) {
    if (hint) hint.textContent = `草稿生成失败：${error.message}`;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText || "生成 QClaw 上架任务草稿";
    }
  }
}

function initializeSecretaryDrag() {
  const secretary = secretaryElements();
  if (!secretary.shell || !secretary.header) return;
  let dragState = null;
  secretary.header.addEventListener("pointerdown", (event) => {
    if (secretaryMode !== "floating" || event.target.closest("button")) return;
    const rect = secretary.shell.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height
    };
    secretary.header.setPointerCapture(event.pointerId);
  });
  secretary.header.addEventListener("pointermove", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const safe = clampSecretaryRect(
      event.clientX - dragState.offsetX,
      event.clientY - dragState.offsetY,
      dragState.width,
      dragState.height
    );
    Object.assign(secretary.shell.style, {
      left: `${safe.left}px`,
      top: `${safe.top}px`,
      width: `${safe.width}px`,
      height: `${safe.height}px`
    });
  });
  secretary.header.addEventListener("pointerup", (event) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragState = null;
    saveSecretaryFloatingRect();
  });
  secretary.shell.addEventListener("mouseup", saveSecretaryFloatingRect);
  window.addEventListener("resize", () => {
    if (secretaryMode === "floating") restoreSecretaryFloatingRect();
  });
}

function loadListingVisualWorkflowState() {
  try {
    return JSON.parse(localStorage.getItem(LISTING_VISUAL_WORKFLOW_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveListingVisualWorkflowState(patch = {}) {
  const next = {
    ...loadListingVisualWorkflowState(),
    ...patch,
    workflow_status: patch.workflow_status || "draft",
    updated_at: new Date().toISOString()
  };
  localStorage.setItem(LISTING_VISUAL_WORKFLOW_STORAGE_KEY, JSON.stringify(next));
  return next;
}

function listingVisualValue(key) {
  const state = loadListingVisualWorkflowState();
  return state[key] || "";
}

function hydrateListingVisualWorkflow(state = {}) {
  const saved = loadListingVisualWorkflowState();
  const productFacts = saved.product_facts || state.responseText || "";
  if (elements.listingVisualProductFactsInput && !elements.listingVisualProductFactsInput.matches(":focus")) {
    elements.listingVisualProductFactsInput.value = productFacts;
  }
  [
    [elements.listingVisualMarketAuditResult, "market_visual_audit"],
    [elements.listingVisualStrategyResult, "visual_strategy_decision"],
    [elements.listingVisualPlanResult, "visual_plan"]
  ].forEach(([element, key]) => {
    if (element && !element.matches(":focus")) element.value = saved[key] || "";
  });
  updateListingVisualWorkflowStatus();
}

function updateListingVisualWorkflowStatus() {
  const state = loadListingVisualWorkflowState();
  const productFacts = elements.listingVisualProductFactsInput?.value.trim() || state.product_facts || "";
  const status = {
    productFacts: productFacts ? "Draft" : "Not Started",
    marketAudit: state.market_visual_audit ? "Reviewed" : "Not Started",
    strategy: state.visual_strategy_decision ? "Reviewed" : "Not Started",
    visualPlan: state.visual_plan ? "Approved" : "Not Started",
    singlePrompt: state.single_image_prompt ? "Draft" : "Not Started"
  };
  document.querySelectorAll("[data-listing-visual-status]").forEach((node) => {
    node.textContent = status[node.dataset.listingVisualStatus] || "Not Started";
  });
  const warnings = {
    marketAudit: false,
    strategy: false,
    visualPlan: false,
    singlePrompt: false
  };
  document.querySelectorAll("[data-listing-visual-warning]").forEach((node) => {
    node.classList.toggle("hidden", !warnings[node.dataset.listingVisualWarning]);
  });
}

function fillListingVisualTemplate(template, kind) {
  const state = loadListingVisualWorkflowState();
  const productFacts = elements.listingVisualProductFactsInput?.value.trim() || state.product_facts || "";
  const imageNumber = elements.listingVisualImageNumber?.value || "01";
  return template
    .replaceAll("{{PRODUCT_FACTS}}", productFacts || "不确定 / 待人工确认")
    .replaceAll("{{CHROME_AI_REPORT}}", state.market_visual_audit || elements.listingVisualMarketAuditResult?.value || "")
    .replaceAll("{{VISUAL_STRATEGY_DECISION}}", state.visual_strategy_decision || elements.listingVisualStrategyResult?.value || "")
    .replaceAll("{{VISUAL_PLAN}}", state.visual_plan || elements.listingVisualPlanResult?.value || "")
    .replaceAll("{{IMAGE_NUMBER}}", imageNumber)
    .replaceAll("{{IMAGE_NAME}}", `Image ${imageNumber}`)
    .replaceAll("{{SELLING_SUBJECT}}", "当前产品事实底稿中的销售主体")
    .replaceAll("{{HEADLINE}}", "Short Headline")
    .replaceAll("{{SUBTITLE}}", "Mobile readable subtitle")
    .replaceAll("{{CALLOUT_1}}", "Callout 1")
    .replaceAll("{{CALLOUT_2}}", "Callout 2")
    .replaceAll("{{CALLOUT_3}}", "Callout 3");
}

async function generateListingVisualPrompt(kind) {
  const target = listingVisualPromptTargets[kind];
  if (!target) return;
  const response = await fetch(`/api/prompts/${kind}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Prompt 模板读取失败");
  const content = fillListingVisualTemplate(data.content, kind);
  const element = elements[target.promptElement];
  if (element) element.value = content;
  saveListingVisualWorkflowState({
    product_facts: elements.listingVisualProductFactsInput?.value.trim() || listingVisualValue("product_facts"),
    [target.outputKey]: target.outputKey === "single_image_prompt" ? content : listingVisualValue(target.outputKey)
  });
  updateListingVisualWorkflowStatus();
}

async function copyListingVisualPrompt(stage) {
  const prompt = {
    marketAudit: elements.listingVisualMarketAuditPrompt,
    strategy: elements.listingVisualStrategyPrompt,
    visualPlan: elements.listingVisualPlanPrompt,
    singlePrompt: elements.listingVisualSinglePromptText
  }[stage];
  if (!prompt?.value) return;
  await navigator.clipboard.writeText(prompt.value);
}

function bindListingVisualWorkflow() {
  document.querySelectorAll("[data-listing-visual-generate]").forEach((button) => {
    button.addEventListener("click", () => {
      void generateListingVisualPrompt(button.dataset.listingVisualGenerate).catch((error) => {
        alert(error instanceof Error ? error.message : String(error));
      });
    });
  });
  document.querySelectorAll("[data-listing-visual-copy]").forEach((button) => {
    button.addEventListener("click", () => {
      void copyListingVisualPrompt(button.dataset.listingVisualCopy);
    });
  });
  document.querySelector("[data-listing-visual-save=\"productFacts\"]")?.addEventListener("click", () => {
    saveListingVisualWorkflowState({
      product_facts: elements.listingVisualProductFactsInput?.value.trim() || ""
    });
    updateListingVisualWorkflowStatus();
  });
  [
    [elements.listingVisualMarketAuditResult, "market_visual_audit"],
    [elements.listingVisualStrategyResult, "visual_strategy_decision"],
    [elements.listingVisualPlanResult, "visual_plan"]
  ].forEach(([element, key]) => {
    element?.addEventListener("input", () => {
      saveListingVisualWorkflowState({ [key]: element.value.trim() });
      updateListingVisualWorkflowStatus();
    });
  });
}

let objectiveInfoSaveTimer = null;
async function saveObjectiveInfo() {
  if (!elements.objectiveInfoInput) return;
  const value = elements.objectiveInfoInput.value;
  if (elements.objectiveInfoStatus) {
    elements.objectiveInfoStatus.textContent = "保存中…";
    elements.objectiveInfoStatus.className = "objective-info-status saving";
  }
  try {
    await request("/api/state/objective-info", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectiveInfo: value })
    });
    if (elements.objectiveInfoStatus) {
      elements.objectiveInfoStatus.textContent = "已自动保存";
      elements.objectiveInfoStatus.className = "objective-info-status saved";
    }
  } catch (error) {
    if (elements.objectiveInfoStatus) {
      elements.objectiveInfoStatus.textContent = `保存失败：${error.message}`;
      elements.objectiveInfoStatus.className = "objective-info-status";
    }
  }
}
function debouncedSaveObjectiveInfo() {
  if (objectiveInfoSaveTimer) window.clearTimeout(objectiveInfoSaveTimer);
  if (elements.objectiveInfoStatus) {
    elements.objectiveInfoStatus.textContent = "待保存";
    elements.objectiveInfoStatus.className = "objective-info-status";
  }
  objectiveInfoSaveTimer = window.setTimeout(() => saveObjectiveInfo(), 600);
}
function hydrateObjectiveInfo(state) {
  if (elements.objectiveInfoInput && !elements.objectiveInfoInput.matches(":focus")) {
    elements.objectiveInfoInput.value = state.objectiveInfo || "";
  }
}
function bindObjectiveInfo() {
  elements.objectiveInfoInput?.addEventListener("input", debouncedSaveObjectiveInfo);
}

function render(payload) {
  latestPayload = payload;
  const {
    state,
    systemAwake,
    productDirectory,
    availableImages,
    prompts,
    outputFiles,
    contentFiles,
    queue,
    operations,
    productVisualAssets,
    insertBagImages = [],
    insertLinerImages = [],
    insertOutputFiles = []
  } = payload;
  window.latestPrompts = prompts || {};
  const busy = state.running || state.autoRun;
  const imagesLocked = busy || Boolean(state.chatUrl);
  const generatedCount = (state.generatedImageNumbers || []).length;
  const overallProgress = workflowProgress(state);
  const providerName = state.provider === "gemini" ? "Gemini" : "ChatGPT";
  const insertMode = state.workflowMode === "luxury_insert";
  const seoOnly = state.standardWorkflowGoal === "seo_content_only";
  const queueLocked =
    queue.status === "running" ||
    queue.status === "preparing" ||
    Boolean(queue.currentTaskId);
  renderQueue(queue, state);
  renderOperations(operations || emptyOperations());
  dailyWaitingItems = payload.daily?.waitingItems || [];
  renderDailyWaitingQueue();
  renderV2HomeDashboard();
  renderDailyCockpit();
  void loadTodayDashboardProjection();
  updateSecretaryContext();
  renderProductionConsole(state, availableImages, busy, queueLocked);
  renderPromptLibrary(prompts, busy, queueLocked);
  renderVisualReferenceLock(productVisualAssets);
  renderGenerationQcPanel(state);
  hydrateListingVisualWorkflow(state);
  hydrateObjectiveInfo(state);
  /* 每日市场选款设计独立渲染（selection-radar 视图）——与 insertWorkspace 解耦 */
  renderSelectionRadar(state, busy);
  /* 标品选品（Bob 选品研究）独立渲染——与内胆包型选品互不干扰 */
  renderProductSelection(state, busy);
  /* 店小秘自动化上品（乳贴 v1.0）板块 —— 复用每秒刷新，状态用模块级变量保持 */
  renderDianxiaomiListing();
  /* 批量流水线上架（v1.4.0）—— 复用每秒刷新，状态用模块级变量保持 */
  renderBatchListing();
  /* 爆款研究中心 —— 复用每秒刷新，状态用模块级变量保持 */
  renderResearchCenter();
  if (selectedArchivedProfile) {
    renderProfileDetail(selectedArchivedProfile, true);
    elements.profileWarning.classList.add("hidden");
  } else {
    renderCurrentProfile(payload.productProfile, payload.productProfileWarning);
  }

  document.body.classList.toggle("insert-mode", insertMode);
  /* 上品视图内：非 luxury_insert 模式时显示「进入内胆 Listing 设计」入口卡片 */
  elements.insertListingEntryCard?.classList.toggle(
    "hidden",
    !!insertMode
  );
  const activeViewBeforeRender = activeViewName();
  elements.insertWorkspace.classList.toggle(
    "hidden",
    !insertMode || elements.viewPanels.some((panel) => panel.classList.contains("active"))
  );
  if (insertMode) {
    const activeView = elements.navItems.find((item) =>
      item.classList.contains("active")
    )?.dataset.view;
    elements.viewPanels.forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.viewPanel === activeView);
    });
  } else if (!elements.viewPanels.some((panel) => panel.classList.contains("active"))) {
    elements.viewPanels.find(
      (panel) => panel.dataset.viewPanel === "daily-cockpit"
    )?.classList.add("active");
    elements.navItems.find(
      (item) => item.dataset.view === "daily-cockpit"
    )?.classList.add("active");
  }
  updateWorkspaceHeader(insertMode && !activeViewName() ? "insert-editor" : activeViewName() || "daily-cockpit");
  elements.modeOptions.forEach((option) => {
    option.classList.toggle("active", option.dataset.mode === state.workflowMode);
    option.disabled = busy || queueLocked;
  });
  elements.navItems.forEach((item) => {
    item.disabled = false;
  });
  elements.standardGoalSwitch.classList.toggle("hidden", insertMode);
  elements.returnToInsertEditorButton.classList.toggle(
    "hidden",
    !insertMode ||
      !elements.viewPanels.some((panel) => panel.classList.contains("active"))
  );
  elements.goalOptions.forEach((option) => {
    option.classList.toggle("active", option.dataset.goal === state.standardWorkflowGoal);
    option.disabled =
      busy || queueLocked || Boolean(state.chatUrl) || Boolean(state.completedPhase);
  });
  elements.heroKicker.textContent = seoOnly
    ? "ENHANCED SEO CONTENT WORKFLOW"
    : "AUTOMATED COMMERCE WORKFLOW";
  elements.heroTitle.textContent = seoOnly
    ? "从产品事实到高转化文案，跳过作图。"
    : "从产品素材到高转化 Listing，一次完成。";
  elements.heroDescription.textContent = seoOnly
    ? "自动完成产品识别、联网市场调研、VOC、SEO 关键词、标题、属性词和详情页内容。"
    : "自动完成产品识别、市场调研、视觉规划、10 张图片生成，以及 SEO 商品文案。";

  elements.metricImageCount.textContent = String(availableImages.length);
  elements.metricPhase.textContent =
    seoOnly && state.completedPhase === "MVP5"
      ? "SEO 完成"
      : seoOnly && state.researchCompleted
        ? "调研完成"
        : phaseLabels[state.completedPhase] || (busy ? "运行中" : "待开始");
  elements.metricGenerated.textContent = seoOnly ? "已跳过" : `${generatedCount}/10`;
  elements.overallProgressText.textContent = `${Math.round(overallProgress)}%`;
  elements.chatStatus.textContent = state.chatUrl
    ? `${providerName} 已连接`
    : state.browserStarted
      ? `等待 ${providerName} 登录`
      : `${providerName} 未连接`;
  elements.chatStatus.classList.toggle("online", Boolean(state.chatUrl));
  elements.awakeStatus.textContent = systemAwake ? "系统保持唤醒" : "节能模式";
  elements.awakeStatus.classList.toggle("awake", Boolean(systemAwake));
  elements.taskAwake.textContent = systemAwake ? "保持唤醒" : "节能模式";
  elements.taskDockMessage.textContent = state.message;
  elements.taskImageNumber.textContent = state.currentImageNumber
    ? `Image ${state.currentImageNumber}`
    : "";
  elements.taskImageNumber.classList.toggle("hidden", !state.currentImageNumber);
  elements.taskDock.classList.toggle("running", busy);
  elements.taskDock.classList.toggle(
    "failed",
    state.stage === "FAILED" || state.stage === "PAUSED"
  );
  elements.providerHeading.textContent = `连接 ${providerName}`;
  elements.providerDescription.textContent =
    state.provider === "gemini"
      ? "登录 Google 账号后即可使用 Gemini；切换商品引擎时会自动迁移图片和已完成上下文。"
      : "首次使用请在打开的 Chrome 中手动登录，后续会自动保留 ChatGPT 登录状态。";
  elements.providerOptions.forEach((option) => {
    option.classList.toggle("active", option.dataset.provider === state.provider);
    option.disabled = busy;
  });
  elements.productDirectory.textContent = productDirectory;
  elements.productDirectory.title = productDirectory;
  elements.imageCount.textContent = `${availableImages.length} 张`;
  elements.imageList.replaceChildren(
    ...availableImages.map((image) => {
      const card = document.createElement("article");
      card.className = "image-card";

      const preview = document.createElement("img");
      preview.src = image.thumbnailUrl;
      preview.alt = image.name;
      preview.loading = "lazy";

      const footer = document.createElement("div");
      footer.className = "image-card-footer";

      const name = document.createElement("span");
      name.textContent = image.name;
      name.title = image.name;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "remove-image-button";
      removeButton.textContent = "移除";
      removeButton.disabled = imagesLocked;
      removeButton.title = imagesLocked
        ? "图片已用于当前商品对话，不能移除"
        : `移除 ${image.name}`;
      removeButton.addEventListener("click", () => {
        void removeImage(image.name, removeButton);
      });

      footer.append(name, removeButton);
      card.append(preview, footer);
      return card;
    })
  );

  elements.stage.textContent = state.stage;
  elements.statusBadge.textContent = busy
    ? state.autoRun
      ? "一键流程运行中"
      : "运行中"
    : state.message;
  elements.message.textContent = state.message;
  elements.updatedAt.textContent = new Date(state.updatedAt).toLocaleTimeString();
  elements.progress.style.width = `${overallProgress}%`;
  elements.progress.style.background =
    state.stage === "FAILED" ? "#ff453a" : "#2997ff";

  elements.errorBox.classList.toggle("hidden", !state.error);
  elements.errorBox.textContent = state.error || "";
  const queueRunning = queue.status === "running" || queue.status === "preparing";
  const queuePausedCurrent = queue.status === "paused" && Boolean(queue.currentTaskId);
  const hasCurrentProduct =
    Boolean(state.chatUrl) ||
    Boolean(state.completedPhase) ||
    Boolean(state.luxuryInsert?.taskId) ||
    availableImages.length > 0 ||
    Boolean(queue.currentTaskId);
  const canPauseCurrentTask = busy || queueRunning;
  elements.dockPauseButton.disabled =
    !canPauseCurrentTask || Boolean(state.pauseRequested) || queuePausedCurrent;
  elements.dockPauseButton.textContent = state.pauseRequested
    ? "正在安全暂停…"
    : "暂停任务";
  const canRollback =
    !queue.currentTaskId &&
    hasCurrentProduct &&
    state.stage !== "COMPLETED";
  elements.dockRollbackButton.disabled = !canRollback;
  elements.dockAbandonButton.disabled =
    !hasCurrentProduct || state.stage === "COMPLETED";
  const canRecoverInsertReply =
    insertMode &&
    !busy &&
    (state.stage === "PAUSED" || state.stage === "FAILED") &&
    Boolean(state.error);
  const canSyncAiState = Boolean(state.chatUrl) || canRecoverInsertReply;
  elements.syncButton.classList.toggle("hidden", !canSyncAiState);
  elements.syncButton.disabled = !canSyncAiState;
  elements.dockSyncButton.classList.toggle("hidden", !canSyncAiState);
  elements.dockSyncButton.disabled = !canSyncAiState;
  elements.syncButton.textContent = canRecoverInsertReply
    ? "恢复并回填识别结果"
    : "同步 AI 状态";
  elements.dockSyncButton.textContent = canRecoverInsertReply
    ? "恢复并回填识别结果"
    : "同步 AI 状态";
  const insertCanContinue =
    insertMode &&
    Boolean(state.luxuryInsert?.taskId) &&
    state.stage !== "COMPLETED";
  const standardCanContinue =
    Boolean(state.chatUrl) &&
    (state.stage === "PAUSED" || state.stage === "FAILED");
  const resumable =
    !busy && !queueLocked && (insertCanContinue || standardCanContinue);
  elements.resumeButton.classList.toggle("hidden", !resumable);
  elements.resumeButton.disabled = !resumable;
  elements.resumeButton.textContent = insertMode ? "继续内胆下一步" : "修复后继续";
  elements.responseBox.classList.toggle("hidden", !state.responseText);
  elements.responseText.textContent = state.responseText || "";

  elements.runButton.disabled =
    busy || queueLocked || availableImages.length === 0 || Boolean(state.chatUrl);
  elements.runButton.textContent = state.chatUrl
    ? "产品识别已完成"
    : "开始产品识别";
  elements.runAllButton.disabled =
    busy ||
    queueLocked ||
    availableImages.length === 0 ||
    completedAtLeast(state, "MVP5") ||
    !prompts.research.ready ||
    (!seoOnly && !prompts.planning.ready) ||
    !prompts.seoKeywords.ready ||
    !prompts.listingContent.ready;
  elements.runAllButton.textContent = completedAtLeast(state, "MVP5")
    ? seoOnly
      ? "SEO 与商品文案已完成"
      : "全部流程已完成"
    : state.completedPhase
      ? seoOnly
        ? "一键继续 SEO 专线"
        : "一键继续剩余流程"
      : seoOnly
        ? "一键生成 SEO 与商品文案"
        : "一键开始全部流程";
  elements.launchButton.disabled = busy;
  elements.checkButton.disabled = busy;
  elements.folderInput.disabled = imagesLocked || queueLocked;
  elements.imageDropZone.classList.toggle("locked", imagesLocked || queueLocked);
  elements.imageUrls.disabled = imagesLocked || queueLocked;
  elements.importUrlsButton.disabled = imagesLocked || queueLocked;
  elements.urlImportPanel.classList.toggle("locked", imagesLocked || queueLocked);
  elements.objectiveInfoInput.disabled = imagesLocked || queueLocked;
  elements.objectiveInfoPanel.classList.toggle("locked", imagesLocked || queueLocked);
  elements.clearImagesButton.disabled =
    imagesLocked || queueLocked || availableImages.length === 0;
  elements.imageLockHint.classList.toggle("hidden", !state.chatUrl);
  const canRecoverResearch = isResearchRecoveryState(state);
  const needsIdentification = !state.chatUrl;
  elements.planningButton.disabled =
    busy ||
    queueLocked ||
    (!canRecoverResearch &&
      (
        (seoOnly ? Boolean(state.researchCompleted) : completedAtLeast(state, "MVP3")) ||
        !prompts.research.ready ||
        (!seoOnly && !prompts.planning.ready)
      ));
  elements.planningButton.textContent = canRecoverResearch
    ? "从断点继续市场调研"
    : needsIdentification
    ? "开始产品识别（前置步骤）"
    : seoOnly
    ? state.researchCompleted
      ? "联网市场调研与 VOC 已完成"
      : "开始联网市场调研与 VOC"
    : "开始市场调研与视觉规划";
  elements.planningButton.title = needsIdentification
    ? "尚未建立商品对话，点击后将先完成产品识别，再继续市场调研与视觉规划"
    : "";
  elements.planningSkipNotice.classList.toggle("hidden", !seoOnly);
  elements.saveResearchPrompt.disabled = busy || queueLocked;
  elements.savePlanningPrompt.disabled = busy || queueLocked;
  elements.saveSeoKeywordsPrompt.disabled = busy || queueLocked;
  elements.saveListingContentPrompt.disabled = busy || queueLocked;
  elements.saveLuxuryInsertPrompt.disabled = busy || queueLocked;
  elements.saveInsertMarketRadarPrompt.disabled = busy || queueLocked;
  elements.saveInsertListingContentPrompt.disabled = busy || queueLocked;
  elements.researchPromptStatus.textContent = prompts.research.ready
    ? `${prompts.research.characters} 字符`
    : "未配置";
  elements.planningPromptStatus.textContent = prompts.planning.ready
    ? `${prompts.planning.characters} 字符`
    : "未配置";
  elements.seoKeywordsPromptStatus.textContent = prompts.seoKeywords.ready
    ? `${prompts.seoKeywords.characters} 字符`
    : "未配置";
  elements.listingContentPromptStatus.textContent =
    prompts.listingContent.ready
      ? `${prompts.listingContent.characters} 字符`
      : "未配置";
  elements.luxuryInsertPromptStatus.textContent = prompts.luxuryInsert.ready
    ? `${prompts.luxuryInsert.characters} 字符`
    : "未配置";
  elements.insertMarketRadarPromptStatus.textContent =
    prompts.insertMarketRadar.ready
      ? `${prompts.insertMarketRadar.characters} 字符`
      : "未配置";
  elements.insertListingContentPromptStatus.textContent =
    prompts.insertListingContent.ready
      ? `${prompts.insertListingContent.characters} 字符`
      : "未配置";

  const generated = new Set(state.generatedImageNumbers || []);
  elements.imagesSkipNotice.classList.toggle("hidden", !seoOnly);
  elements.generationSteps.classList.toggle("hidden", seoOnly);
  elements.outputGallery.classList.toggle("hidden", seoOnly);
  elements.generationSteps.replaceChildren(
    ...Array.from({ length: 10 }, (_, index) => {
      const number = index + 1;
      const step = document.createElement("span");
      step.className = "generation-step";
      if (generated.has(number)) step.classList.add("done");
      if (busy && state.currentImageNumber === number) {
        step.classList.add("active");
      }
      step.textContent = generated.has(number)
        ? `Image ${number} ✓`
        : `Image ${number}`;
      return step;
    })
  );
  const visualReferenceReady =
    Boolean(productVisualAssets?.active_reference_set_id) &&
    Boolean(productVisualAssets?.source_images?.length);
  elements.imagesButton.disabled =
    seoOnly ||
    busy ||
    queueLocked ||
    completedAtLeast(state, "MVP4") ||
    !completedAtLeast(state, "MVP3") ||
    !visualReferenceReady;
  elements.imagesButton.textContent =
    seoOnly
      ? "当前模式已跳过图片生成"
      : completedAtLeast(state, "MVP4")
      ? "Listing 图片已全部生成"
      : !visualReferenceReady
        ? "缺少产品源图绑定，禁止生成"
      : generated.size > 0
        ? `继续生成（已完成 ${generated.size}/10）`
        : "开始生成 Listing 图片";
  elements.seoListingButton.disabled =
    busy ||
    queueLocked ||
    !(seoOnly
      ? state.completedPhase === "MVP1" && state.researchCompleted
      : completedAtLeast(state, "MVP4")) ||
    completedAtLeast(state, "MVP5") ||
    !prompts.seoKeywords.ready ||
    !prompts.listingContent.ready;
  elements.seoListingButton.textContent = completedAtLeast(state, "MVP5")
    ? "SEO 与商品文案已完成"
    : state.seoKeywordText
      ? "继续生成商品文案"
      : "开始生成 SEO 与商品文案";
  elements.nextProductButton.disabled =
    busy || queueLocked || !state.chatUrl || !completedAtLeast(state, "MVP5");

  elements.outputGallery.replaceChildren(
    ...outputFiles.map((file) => {
      const link = document.createElement("a");
      link.className = "output-card";
      link.href = file.url;
      link.target = "_blank";
      const image = document.createElement("img");
      image.src = file.url;
      image.alt = file.name;
      const label = document.createElement("span");
      label.textContent = file.name;
      link.append(image, label);
      return link;
    })
  );

  elements.contentDownloads.replaceChildren(
    ...contentFiles.map((file) => {
      const link = document.createElement("a");
      link.className = "content-download";
      link.href = file.url;
      link.textContent = `下载 ${file.name}`;
      return link;
    })
  );
  elements.seoResultBox.classList.toggle("hidden", !state.seoKeywordText);
  elements.seoResultText.textContent = state.seoKeywordText || "";
  elements.listingResultBox.classList.toggle(
    "hidden",
    !state.listingContentText
  );
  elements.listingResultText.textContent = state.listingContentText || "";

  renderInsertWorkflow(
    state,
    insertBagImages,
    insertLinerImages,
    insertOutputFiles,
    busy
  );
}

function setProfileInputValue(element, value) {
  if (!element || document.activeElement === element) return;
  element.value = value || "";
}

function renderCurrentProfile(result, warning) {
  elements.profileWarning.classList.toggle("hidden", !warning);
  elements.profileWarning.textContent = warning || "";
  const profile = result?.profile;
  if (!profile) {
    elements.profileDetailTitle.textContent = "当前商品档案";
    elements.backToCurrentProfileButton.classList.add("hidden");
    elements.currentProfileForm.classList.add("hidden");
    elements.currentProfileEmpty.classList.remove("hidden");
    elements.currentProfileStatus.textContent =
      result?.status === "invalid" ? "档案异常" : "尚未建档";
    elements.currentProfileStatus.classList.toggle(
      "invalid",
      result?.status === "invalid"
    );
    if (result?.status === "invalid") {
      elements.currentProfileEmpty.textContent =
        result.error || "product-profile.json 校验失败，系统不会自动覆盖。";
    } else {
      elements.currentProfileEmpty.textContent =
        "产品识别完成后将自动创建长期商品档案。";
    }
    return;
  }
  renderProfileDetail(profile, false);
}

function renderQueue(queue, runState) {
  const tasks = queue.tasks || [];
  const ready = tasks.filter((task) => task.status === "ready").length;
  const completed = tasks.filter((task) => task.status === "completed").length;
  const invalid = tasks.filter((task) => task.status === "invalid").length;
  const abandoned = tasks.filter((task) => task.status === "abandoned").length;
  const executable = tasks.filter(
    (task) => !["invalid", "cancelled", "abandoned"].includes(task.status)
  ).length;
  const progress = executable ? Math.round((completed / executable) * 100) : 0;
  const current = tasks.find((task) => task.taskId === queue.currentTaskId);

  elements.queueStatusBadge.textContent = queue.status.toUpperCase();
  elements.queueStatusBadge.classList.toggle(
    "invalid",
    queue.status === "paused"
  );
  elements.queueReadyCount.textContent = String(ready);
  elements.queueCompletedCount.textContent = String(completed);
  elements.queueAbandonedCount.textContent = String(abandoned);
  elements.queueInvalidCount.textContent = String(invalid);
  elements.queueDuplicateCount.textContent = String(queue.duplicateCount || 0);
  elements.queueProgressText.textContent = `${progress}%`;
  elements.queueProgressBar.style.width = `${progress}%`;
  elements.queueCurrentProduct.textContent = current
    ? `${current.productName} · ${runState.stage} · ${
        (runState.generatedImageNumbers || []).length
      }/10`
    : queue.status === "completed"
      ? "队列已全部处理完成"
      : "当前没有运行商品";
  elements.queueError.classList.toggle("hidden", !queue.error);
  elements.queueError.textContent = queue.error || "";

  const active = queue.status === "running" || queue.status === "preparing";
  elements.queueWorkbookInput.disabled = active;
  elements.queueStartButton.disabled =
    active || Boolean(queue.currentTaskId) || ready === 0;
  elements.queuePauseButton.disabled = queue.status !== "running";
  elements.queueResumeButton.disabled = queue.status !== "paused";
  elements.queueAbandonButton.textContent = ready
    ? "遗弃当前并继续下一商品"
    : "遗弃当前商品";
  elements.queueAbandonButton.disabled =
    queue.status !== "paused" ||
    !queue.currentTaskId ||
    runState.running ||
    runState.autoRun;
  elements.queueClearButton.disabled =
    active ||
    Boolean(queue.currentTaskId) ||
    completed + abandoned === 0;

  elements.queueTaskList.replaceChildren(
    ...(tasks.length
      ? tasks.map((task, index) => createQueueTaskRow(task, index))
      : [createQueueEmptyState()])
  );
}

function createQueueEmptyState() {
  const empty = document.createElement("p");
  empty.className = "profile-empty";
  empty.textContent = "尚未导入商品队列";
  return empty;
}

function createQueueTaskRow(task, index) {
  const row = document.createElement("div");
  row.className = `queue-task-row ${task.status}`;

  const number = document.createElement("span");
  number.className = "queue-task-index";
  number.textContent = String(index + 1).padStart(2, "0");

  const main = document.createElement("div");
  main.className = "queue-task-main";
  const name = document.createElement("strong");
  name.textContent = task.productName;
  const source = document.createElement("small");
  source.textContent = `${task.sourceExcelFile} · 第 ${task.sourceExcelRow} 行 · ${task.imageNames.length} 张图`;
  main.append(name, source);

  const stage = document.createElement("span");
  stage.className = "queue-task-meta";
  stage.textContent = task.archiveDirectory
    ? `已归档：${task.archiveDirectory}`
    : task.notes || "无备注";
  stage.title = stage.textContent;

  const status = document.createElement("span");
  status.className = `library-status queue-task-status ${
    ["invalid", "paused", "abandoned"].includes(task.status)
      ? "invalid"
      : task.status === "ready"
        ? "pending"
        : ""
  }`;
  status.textContent = queueTaskStatusLabel(task.status);

  const action = document.createElement("div");
  if (["ready", "invalid"].includes(task.status)) {
    const cancel = document.createElement("button");
    cancel.className = "text-button";
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => {
      void cancelQueueTask(task.taskId, cancel);
    });
    action.append(cancel);
  }
  row.append(number, main, stage, status, action);
  if (task.error || task.failedUrls?.length) {
    const error = document.createElement("div");
    error.className = "queue-task-error";
    const failed = (task.failedUrls || [])
      .map((item) => `${item.url}：${item.error}`)
      .join("；");
    error.textContent = [task.error, failed].filter(Boolean).join("；");
    row.append(error);
  }
  return row;
}

function queueTaskStatusLabel(status) {
  return {
    preparing: "素材处理中",
    ready: "待执行",
    running: "运行中",
    paused: "已暂停",
    completed: "已完成",
    invalid: "素材无效",
    cancelled: "已取消"
    ,
    abandoned: "已遗弃"
  }[status] || status;
}

function emptyOperations() {
  return {
    products: [],
    operationProfiles: [],
    storeProfiles: [],
    listingCards: [],
    listingSkuMappings: [],
    performanceSnapshots: [],
    dataCollectionTasks: [],
    operationActions: [],
    operationRules: {
      auto_judgement_rules: [],
      threshold_required_rules: [],
      manual_confirmation_rules: [],
      action_suggestion_rules: []
    }
  };
}

function renderOperations(operations) {
  if (!selectedOperationProductId && operations.products.length) {
    selectedOperationProductId = operations.products[0].productId;
  }
  renderCommerceDashboard(operations);
  renderCommerceProductList(operations);
  renderOperationProfileForm(operations);
  renderOperationPool(operations);
  renderCommerceProductDetail(operations);
  renderStoreProfiles(operations);
  renderListingMatrix(operations);
  renderDataTasksAndSnapshots(operations);
  renderOperationActions(operations);
  renderOperationReviews(operations);
  fillOperationSelects(operations);
  applyCommercePrefill(operations);
}

function renderCommerceDashboard(operations) {
  const products = operations.products || [];
  const profiles = operations.operationProfiles || [];
  const tasks = operations.dataCollectionTasks || [];
  const actions = operations.operationActions || [];
  const potentialCount = profiles.filter((profile) => profile.product_tier === "potential").length;
  const hotCount = profiles.filter((profile) => profile.product_tier === "hot").length;
  const pausedDeadCount = profiles.filter((profile) =>
    ["paused", "dead"].includes(profile.product_tier)
  ).length;
  const pendingTaskCount = tasks.filter((task) => task.status !== "reviewed").length;
  const reviewActionCount = actions.filter((action) =>
    ["pending_review", "overdue"].includes(action.review_status)
  ).length;
  elements.commerceKpis?.replaceChildren(
    kpiCard("全量商品", products.length, "来自已建档 product-profile"),
    kpiCard("潜力品", potentialCount, "需要验证是否值得放大", "potential"),
    kpiCard("爆品", hotCount, "重点放大与防回落", "hot"),
    kpiCard("暂停 / 死亡", pausedDeadCount, "减少无效运营消耗", "paused"),
    kpiCard("待采集任务", pendingTaskCount, "等待周期数据录入", pendingTaskCount ? "warning" : ""),
    kpiCard("待复盘动作", reviewActionCount, "pending / overdue", reviewActionCount ? "warning" : "")
  );

  const boardItems = [
    ...tasks
      .filter((task) => task.status !== "reviewed")
      .slice(0, 3)
      .map((task) =>
        commerceCard(
          `采集任务｜${task.period}`,
          ["待录入数据", task.review_due_at && `复盘 ${task.review_due_at}`],
          `请打开对应店铺后台，录入曝光、点击、订单、销售额和广告花费。\nlisting_id：${task.target_listing_id}`,
          { actionLabel: "去数据采集", action: () => switchView("data-tasks") }
        )
      ),
    ...actions
      .filter((action) => ["pending_review", "overdue"].includes(action.review_status))
      .slice(0, 3)
      .map((action) =>
        commerceCard(
          `${action.action_type}｜${reviewStatusLabel(action.review_status)}`,
          ["待复盘", action.review_due_at],
          `这只是复盘提醒，不代表系统已执行动作。\n目标指标：${action.target_metric || "未填写"}`,
          { actionLabel: "去复盘", action: () => switchView("operation-review") }
        )
      )
  ];
  elements.commerceBoardList?.replaceChildren(
    ...(boardItems.length
      ? boardItems
      : [
          emptyStateCard(
            "经营看板还很安静",
            "当前没有待采集任务或待复盘动作。你可以先从已归档商品中设置潜力品，再为链接创建周期采集任务。",
            "进入商品档案 / 商品中枢",
            () => switchView("commerce-products")
          )
        ])
  );

  const focusProducts = products.filter((product) =>
    ["potential", "hot"].includes(product.operationProfile?.product_tier)
  );
  elements.commerceSuggestionList?.replaceChildren(
    ...(focusProducts.length
      ? focusProducts.slice(0, 4).map((product) =>
          commerceCard(
            product.displayName || product.directoryName || product.productId,
            [
              tierLabel(product.operationProfile.product_tier),
              product.reviewAlerts ? `待复盘 ${product.reviewAlerts}` : "建议观察"
            ],
            `下一步建议：${product.operationProfile.agent_summary || "补充最近周期数据后再判断。"}\n当前目标：${product.operationProfile.current_operation_goal || "未设置"}`,
            {
              actionLabel: "进入单品作战台",
              action: () => openCommerceDetail(product.productId)
            }
          )
        )
      : [
          emptyStateCard(
            "还没有重点商品",
            "将有信号的商品标记为潜力品或爆品后，这里会变成你的经营主战场。",
            "去设置商品层级",
            () => switchView("commerce-products")
          )
        ])
  );
}

function renderCommerceProductList(operations) {
  elements.commerceProductList.replaceChildren(
    ...(operations.products.length
      ? operations.products.map((product) => {
          const profile = product.operationProfile;
          const card = commerceCard(
            product.displayName || product.directoryName,
            [
              `ID：${product.productId}`,
              `层级：${tierLabel(profile?.product_tier || "normal")}`,
              `链接：${product.listingCount}`,
              product.reviewAlerts ? `待复盘：${product.reviewAlerts}` : ""
            ].filter(Boolean),
            [
              profile?.entry_reason && `进入原因：${profile.entry_reason}`,
              profile?.current_operation_goal && `目标：${profile.current_operation_goal}`,
              profile?.next_review_at && `下次复盘：${profile.next_review_at}`
            ].filter(Boolean).join("\n") || "尚未设置运营档案",
            { thumbnailUrl: product.thumbnailUrl, thumbnailAlt: product.displayName || product.directoryName }
          );
          card.classList.toggle("selected", product.productId === selectedOperationProductId);
          card.addEventListener("click", () => {
            selectedOperationProductId = product.productId;
            renderOperations(latestPayload?.operations || emptyOperations());
          });
          const detailButton = document.createElement("button");
          detailButton.className = "button secondary compact-button";
          detailButton.textContent = "进入单品作战台";
          detailButton.addEventListener("click", (event) => {
            event.stopPropagation();
            openCommerceDetail(product.productId);
          });
          (card.querySelector(".commerce-card-main") || card).append(detailButton);
          return card;
        })
      : [
          emptyStateCard(
            "还没有可经营的商品",
            "商品完成归档或历史商品建档后，会在这里形成商品经营视图。",
            "商品档案 / 商品中枢",
            () => switchView("profiles")
          )
        ])
  );
}

function renderOperationProfileForm(operations) {
  const product = operations.products.find(
    (item) => item.productId === selectedOperationProductId
  );
  const profile = product?.operationProfile;
  elements.operationSelectedProduct.textContent = product
    ? product.displayName || product.productId
    : "未选择";
  if (
    commerceDirtyForms.has("operationProfile") &&
    product?.productId === operationProfileDirtyProductId
  ) {
    elements.saveOperationProfileButton.disabled = !product;
    elements.deleteOperationProfileButton.disabled = !product || !profile;
    return;
  }
  if (product?.productId !== operationProfileDirtyProductId) {
    commerceDirtyForms.delete("operationProfile");
    operationProfileDirtyProductId = product?.productId;
  }
  setValue(elements.operationProductTier, profile?.product_tier || "normal");
  setValue(elements.operationNextReviewAt, profile?.next_review_at);
  setValue(elements.operationEntryReason, profile?.entry_reason);
  setValue(elements.operationGoal, profile?.current_operation_goal);
  setValue(elements.operationStrategy, profile?.current_strategy);
  setValue(elements.operationPlanType, profile?.current_operation_plan?.plan_type || "");
  setValue(elements.operationTargetMetric, profile?.current_operation_plan?.target_metric);
  setValue(elements.operationPlanObjective, profile?.current_operation_plan?.objective);
  setValue(elements.operationSuccessCondition, profile?.current_operation_plan?.success_condition);
  setValue(elements.operationFailureCondition, profile?.current_operation_plan?.failure_condition);
  setValue(elements.operationAgentSummary, profile?.agent_summary);
  elements.saveOperationProfileButton.disabled = !product;
  elements.deleteOperationProfileButton.disabled = !product || !profile;
}

function renderOperationPool(operations) {
  const pool = operations.products.filter((product) =>
    ["potential", "hot"].includes(product.operationProfile?.product_tier)
  );
  elements.operationPool.replaceChildren(
    ...(pool.length
      ? pool.map((product) => {
          const profile = product.operationProfile;
          const snapshot = product.latestSnapshot;
          const action = product.latestAction;
          const card = commerceCard(
            product.displayName || product.productId,
            [
              tierLabel(profile.product_tier),
              `${product.listingCount} 个链接`,
              action?.review_status && `复盘：${reviewStatusLabel(action.review_status)}`
            ],
            [
              `进入原因：${profile.entry_reason || "未填写"}`,
              `当前目标：${profile.current_operation_goal || "未填写"}`,
              `最近数据：${snapshot ? metricSummary(snapshot) : "暂无快照"}`,
              `当前动作：${action ? `${action.action_type} / ${action.status}` : "暂无动作"}`,
              `下一步建议：${profile.agent_summary || "等待人工判断"}`,
              `下次复盘：${profile.next_review_at || "未设置"}`
            ].join("\n"),
            { thumbnailUrl: product.thumbnailUrl, thumbnailAlt: product.displayName || product.productId }
          );
          const detailButton = document.createElement("button");
          detailButton.className = "button primary compact-button";
          detailButton.textContent = "进入单品作战台";
          detailButton.addEventListener("click", () => openCommerceDetail(product.productId));
          (card.querySelector(".commerce-card-main") || card).append(detailButton);
          return card;
        })
      : [
          emptyStateCard(
            "重点商品池为空",
            "这里只收纳潜力品和爆品。先在商品档案 / 商品中枢里为值得跟进的商品设置层级。",
            "去设置商品层级",
            () => switchView("commerce-products")
          )
        ])
  );
}

function renderCommerceProductDetail(operations) {
  if (!elements.commerceDetailContent) return;
  const product = operations.products.find(
    (item) => item.productId === selectedOperationProductId
  );
  if (!product) {
    elements.commerceDetailTitle.textContent = "单品作战台";
    elements.commerceDetailSubtitle.textContent = "请选择一个已建档商品。";
    elements.commerceDetailContent.replaceChildren(
      emptyStateCard(
        "还没有选择商品",
        "从重点商品池或商品档案 / 商品中枢进入后，这里会聚合展示商品事实、Listing、SKU、动作和复盘入口。",
        "返回商品档案 / 商品中枢",
        () => switchView("commerce-products")
      )
    );
    return;
  }
  const hubProfile = productHubProfiles.get(product.productId);
  const profile = product.operationProfile;
  const listings = operations.listingCards.filter((listing) => listing.product_id === product.productId);
  const listingIds = new Set(listings.map((listing) => listing.listing_id));
  const skuMappings = operations.listingSkuMappings.filter(
    (mapping) => mapping.product_id === product.productId || listingIds.has(mapping.listing_id)
  );
  const snapshots = operations.performanceSnapshots.filter((snapshot) => listingIds.has(snapshot.listing_id));
  const actions = operations.operationActions.filter((action) => action.product_id === product.productId);
  const flow = inferProductFlowStage(product, listings, skuMappings, snapshots, actions);
  const nextAction = productNextAction(flow, product, listings, skuMappings, snapshots, actions);
  if (!["overview", "artifacts", "listings", "sku", "snapshots", "actions"].includes(selectedCommerceDetailTab)) {
    selectedCommerceDetailTab = "overview";
  }
  elements.commerceDetailTitle.textContent = product.displayName || product.directoryName || product.productId;
  elements.commerceDetailSubtitle.textContent =
    `product_id：${product.productId}｜${flow.label}｜单品作战台汇总商品事实、Listing、SKU、周期数据、动作与复盘入口。`;
  elements.commerceDetailTabs?.querySelectorAll(".commerce-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.detailTab === selectedCommerceDetailTab);
  });

  const content = document.createElement("div");
  content.className = "commerce-detail-section";
  content.append(productFlowBanner(flow, nextAction));
  if (selectedCommerceDetailTab === "overview") {
    content.append(
      detailGrid([
        ["商品名", product.displayName || product.directoryName || product.productId],
        ["product_id", product.productId],
        ["建档来源", productSourceLabel(product, hubProfile)],
        ["workflow_mode", product.workflowMode || "-"],
        ["类目", hubProfile?.identity?.category || "-"],
        ["当前阶段", product.currentStage || hubProfile?.lifecycle?.currentStage || "-"],
        ["建档时间", product.createdAt || hubProfile?.lifecycle?.createdAt || "-"],
        ["最近更新时间", product.updatedAt || hubProfile?.lifecycle?.updatedAt || "-"],
        ["当前商品流程阶段", flow.label],
        ["下一步建议", nextAction.label],
        ["商品经营状态", tierLabel(profile?.product_tier || "normal")],
        ["当前运营目标", profile?.current_operation_goal || "未设置"],
        ["进入原因", profile?.entry_reason || "未填写"],
        ["当前策略", profile?.current_strategy || "未填写"],
        ["下次复盘", profile?.next_review_at || "未设置"],
        ["链接数量", String(listings.length)],
        ["SKU 映射", String(skuMappings.length)],
        ["最近数据", product.latestSnapshot ? metricSummary(product.latestSnapshot) : "暂无快照"],
        ["最近动作", product.latestAction ? product.latestAction.action_type : "暂无动作"],
        ["内部备注", hubProfile?.notes || product.notes || "-"]
      ])
    );
  } else if (selectedCommerceDetailTab === "artifacts") {
    const artifacts = hubProfile?.artifacts || [];
    content.append(
      ...(artifacts.length
        ? artifacts.map((artifact) =>
            commerceCard(
              artifact.path,
              [artifact.type, formatFileSize(artifact.size), artifact.updatedAt],
              "上新资产来自 product-profile 的 artifacts 索引，不复制到经营 JSON。"
            )
          )
        : [
            emptyStateCard(
              "还没有上新资产",
              "该商品当前没有产品图、生成图、SEO 文案、Listing 文案或 Prompt 文件索引。",
              "继续上品生产",
              () => switchView("materials")
            )
          ])
    );
  } else if (selectedCommerceDetailTab === "listings") {
    content.append(
      ...(listings.length
        ? listings.map((listing) => listingCardForDetail(listing, operations))
        : [
            emptyStateCard(
              "还没有链接数据卡",
              "为该商品绑定店铺、库存 SKU、包型和链接 URL 后，就能追踪哪个链接带来真实表现。",
              "去上架接入",
              () => jumpToProductListing(product.productId)
            )
          ])
    );
    content.append(actionRow([
      ["去上架接入", () => jumpToProductListing(product.productId, listings[0]?.listing_id)],
      ["添加链接", () => jumpToProductListing(product.productId)]
    ]));
  } else if (selectedCommerceDetailTab === "sku") {
    content.append(
      ...(skuMappings.length
        ? skuMappings.map((mapping) =>
            commerceCard(
              mapping.variant_name || mapping.seller_sku_code || mapping.platform_sku_id || mapping.mapping_id,
              [mapping.status, mapping.color, mapping.size],
              [
                `listing_id：${mapping.listing_id}`,
                `seller_sku_code：${mapping.seller_sku_code || "未填"}`,
                `platform_sku_id：${mapping.platform_sku_id || "未填"}`,
                `platform_barcode：${mapping.platform_barcode || "未填"}`,
                `inventory_sku：${mapping.inventory_sku || "未绑定"}`,
                `warehouse_sku：${mapping.warehouse_sku || "未填"}`
              ].join("\n")
            )
          )
        : [
            emptyStateCard(
              "还没有 SKU 映射",
              "补齐 seller_sku_code、platform_sku_id、条码和内部库存 SKU 后，周期数据才能归属到变体。",
              "添加 SKU 映射",
              () => jumpToProductListing(product.productId, listings[0]?.listing_id, "sku")
            )
          ])
    );
    content.append(actionRow([
      ["添加 SKU 映射", () => jumpToProductListing(product.productId, listings[0]?.listing_id, "sku")]
    ]));
  } else if (selectedCommerceDetailTab === "snapshots") {
    content.append(
      ...(snapshots.length
        ? snapshots.slice().reverse().map((snapshot) =>
            commerceCard(
              `周期快照｜${snapshot.period_start} 至 ${snapshot.period_end}`,
              [`CTR ${percent(snapshot.ctr)}`, `CVR ${percent(snapshot.cvr)}`, `ROI ${numberText(snapshot.roi)}`],
              metricSummary(snapshot)
            )
          )
        : [
            emptyStateCard(
              "还没有数据快照",
              "先创建数据采集任务并录入原始字段，系统会自动计算 CTR、CVR、ROI 和退款率。",
              "录入周期数据",
              () => jumpToProductSnapshot(product.productId, listings[0]?.listing_id)
            )
          ])
    );
    content.append(actionRow([
      ["录入周期数据", () => jumpToProductSnapshot(product.productId, listings[0]?.listing_id)]
    ]));
  } else if (selectedCommerceDetailTab === "actions") {
    content.append(
      ...(actions.length
        ? actions.slice().reverse().map((action) =>
            commerceCard(
              action.action_type,
              [actionStatusLabel(action.status), reviewStatusLabel(action.review_status)],
              [
                `原因：${action.reason || "未填写"}`,
                `目标指标：${action.target_metric || "未填写"}`,
                `复盘时间：${action.review_due_at || "未设置"}`,
                `复盘结果：${action.review_result || "未填写"}`,
                `Agent 结论：${action.agent_conclusion || "未填写"}`
              ].join("\n")
            )
          )
        : [
            emptyStateCard(
              "还没有运营动作",
              "系统建议不会自动执行。你可以基于数据快照创建一个待确认的运营动作。",
              "创建运营动作",
              () => jumpToProductAction(product.productId, listings[0]?.listing_id)
            )
          ])
    );
    content.append(actionRow([
      ["创建运营动作", () => jumpToProductAction(product.productId, listings[0]?.listing_id)],
      ["查看复盘", () => jumpToProductReview(product.productId, actions[0]?.action_id)]
    ]));
  }
  elements.commerceDetailContent.replaceChildren(content);
}

function inferProductFlowStage(product, listings, skuMappings, snapshots, actions) {
  const tier = product.operationProfile?.product_tier;
  const lifecycleStatus = product.lifecycleStatus;
  const sourceTag = productSourceTag(product, productHubProfiles.get(product.productId));
  if (
    ["paused", "dead"].includes(tier) ||
    ["paused", "failed"].includes(lifecycleStatus) ||
    listings.some((listing) => ["dead", "offline"].includes(listing.listing_lifecycle))
  ) {
    return { key: "paused_dead", label: "暂停 / 死亡", tone: "dead" };
  }
  if (actions.some((action) => ["pending_review", "overdue"].includes(action.review_status))) {
    return { key: "review_due", label: "有待复盘动作", tone: "warning" };
  }
  if (listings.length && skuMappings.length && snapshots.length) {
    return { key: "observing", label: "观察中", tone: "done" };
  }
  if (listings.length && skuMappings.length && !snapshots.length) {
    return { key: "need_snapshot", label: "已映射，待录入周期数据", tone: "warning" };
  }
  if (listings.length && !skuMappings.length) {
    return { key: "need_sku", label: "已上架，待 SKU 映射", tone: "warning" };
  }
  if (sourceTag === "asset_ready_pending_listing") {
    return { key: "ready_to_list", label: "已有素材，待上架接入", tone: "suggested" };
  }
  if (sourceTag === "inventory_driven") {
    return { key: "inventory_ready", label: "现货库存驱动，待创建或绑定链接", tone: "suggested" };
  }
  if (hasListingAssets(product)) {
    return { key: "ready_to_list", label: "已完成资产，待上架", tone: "suggested" };
  }
  return { key: "in_production", label: "未完成上新资产", tone: "neutral" };
}

function hasListingAssets(product) {
  if (["COMPLETED"].includes(product.currentStage) || product.lifecycleStatus === "archived") return true;
  const types = new Set(product.artifactTypes || []);
  return ["generated_image", "seo", "listing_content", "prompt"].some((type) => types.has(type)) ||
    (product.artifactCount || 0) > 0;
}

function productNextAction(flow, product, listings, _skuMappings, _snapshots, actions) {
  if (flow.key === "in_production") {
    return { label: "继续上品生产", action: () => switchView("materials") };
  }
  if (flow.key === "ready_to_list") {
    return { label: "去上架接入", action: () => jumpToProductListing(product.productId) };
  }
  if (flow.key === "inventory_ready") {
    return { label: "创建链接或绑定已有链接", action: () => jumpToProductListing(product.productId) };
  }
  if (flow.key === "need_sku") {
    return { label: "补充 SKU 映射", action: () => jumpToProductListing(product.productId, listings[0]?.listing_id, "sku") };
  }
  if (flow.key === "need_snapshot") {
    return { label: "录入首个周期数据", action: () => jumpToProductSnapshot(product.productId, listings[0]?.listing_id) };
  }
  if (flow.key === "review_due") {
    const action = actions.find((item) => ["pending_review", "overdue"].includes(item.review_status));
    return { label: "处理到期复盘", action: () => jumpToProductReview(product.productId, action?.action_id) };
  }
  if (flow.key === "paused_dead") {
    return { label: "检查暂停 / 死亡原因后再决定是否恢复", action: () => jumpToProductAction(product.productId, listings[0]?.listing_id) };
  }
  return { label: "继续按周期观察", action: () => jumpToProductSnapshot(product.productId, listings[0]?.listing_id) };
}

function productFlowBanner(flow, nextAction) {
  const card = commerceCard(
    `当前商品所处流程阶段：${flow.label}`,
    [flow.label],
    `下一步建议：${nextAction.label}`,
    { actionLabel: nextAction.label, action: nextAction.action }
  );
  card.classList.add("product-flow-card");
  return card;
}

function actionRow(items) {
  const row = document.createElement("div");
  row.className = "row-actions";
  items.forEach(([label, action]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button secondary compact-button";
    button.textContent = label;
    button.addEventListener("click", action);
    row.append(button);
  });
  return row;
}

function renderStoreProfiles(operations) {
  elements.storeProfileList.replaceChildren(
    ...(operations.storeProfiles.length
      ? operations.storeProfiles.map((store) =>
          commerceCard(
            store.store_alias,
            [store.platform, store.hitoor_env_name || "未绑定 Hitoor", store.status],
            [
              `store_id：${store.store_id}`,
              `Hitoor ID：${store.hitoor_env_id || "未填写"}`,
              `角色：${store.store_role}`,
              store.remark && `备注：${store.remark}`
            ].filter(Boolean).join("\n"),
            {
              actions: [
            {
              label: "编辑",
              action: () => editStoreProfile(store)
            },
            {
              label: "删除",
              danger: true,
              action: () =>
                    deleteOperationResource(
                      `/api/operations/stores/${encodeURIComponent(store.store_id)}`,
                      "确认删除这个店铺环境？关联链接会显示店铺缺失。"
                    )
                }
              ]
            }
          )
        )
      : [
          emptyStateCard(
            "还没有店铺环境",
            "先维护 AliExpress 店铺别名和 Hitoor 环境，后续上架接入只需要引用 store_id。",
            "创建店铺环境",
            () => switchView("store-settings")
          )
        ])
  );
}

function renderListingMatrix(operations) {
  const stores = new Map(operations.storeProfiles.map((store) => [store.store_id, store]));
  const products = new Map(operations.products.map((product) => [product.productId, product]));
  const listingCards = operations.listingCards.flatMap((listing) => {
    const store = stores.get(listing.store_id);
    const product = products.get(listing.product_id);
    const skuMappings = (operations.listingSkuMappings || []).filter(
      (mapping) => mapping.listing_id === listing.listing_id
    );
    const listingCard = commerceCard(
      listing.listing_title ||
        listing.target_bag_model ||
        listing.inventory_sku ||
        listing.platform_product_id ||
        listing.listing_id,
      [
        lifecycleLabel(listing.listing_lifecycle),
        store?.store_alias || "店铺缺失",
        store?.hitoor_env_name || "Hitoor 未填",
        skuMappings.length ? `SKU ${skuMappings.length}` : ""
      ],
      [
        `商品：${product?.displayName || listing.product_id}`,
        `平台商品 ID：${listing.platform_product_id || "未填"}`,
        `平台状态：${listing.listing_status || "未填"}`,
        `库存 SKU：${listing.inventory_sku || "未填"}`,
        `尺寸：${listing.target_size || "未填"}`,
        `图片版本：${listing.image_version || "未填"} / 标题版本：${listing.title_version || "未填"}`,
        `链接：${listing.listing_url || "未填"}`,
        skuMappings.length
          ? `SKU 映射：${skuMappings
              .map((mapping) =>
                `${mapping.variant_name || mapping.platform_sku_id || mapping.seller_sku_code || "未命名"} → ${mapping.inventory_sku || "未绑定内部 SKU"}`
              )
              .join("；")}`
          : "SKU 映射：未添加"
      ].join("\n"),
      {
        actions: [
          {
            label: "编辑链接",
            action: () => editListingCard(listing)
          },
          {
            label: "删除链接",
            danger: true,
            action: () =>
              deleteOperationResource(
                `/api/operations/listings/${encodeURIComponent(listing.listing_id)}`,
                "确认删除这个链接数据卡？该链接下的 SKU 映射也会删除。"
              )
          }
        ]
      }
    );
    const mappingCards = skuMappings.map((mapping) =>
      commerceCard(
        `SKU 映射｜${mapping.variant_name || mapping.platform_sku_id || mapping.seller_sku_code || mapping.mapping_id}`,
        [mapping.status, mapping.color, mapping.size],
        [
          `平台 SKU ID：${mapping.platform_sku_id || "未填"}`,
          `SKU 编码：${mapping.seller_sku_code || "未填"}`,
          `条码：${mapping.platform_barcode || "未填"}`,
          `内部库存 SKU：${mapping.inventory_sku || "未绑定"}`,
          `仓库 SKU：${mapping.warehouse_sku || "未填"}`,
          mapping.remark && `备注：${mapping.remark}`
        ].filter(Boolean).join("\n"),
        {
          actions: [
            {
              label: "编辑 SKU",
              action: () => editSkuMapping(mapping)
            },
            {
              label: "删除 SKU",
              danger: true,
              action: () =>
                deleteOperationResource(
                  `/api/operations/listing-sku-mappings/${encodeURIComponent(mapping.mapping_id)}`,
                  "确认删除这个 SKU 变体映射？"
                )
            }
          ]
        }
      )
    );
    return [listingCard, ...mappingCards];
  });
  elements.listingMatrixList.replaceChildren(
    ...(operations.listingCards.length
      ? listingCards
      : [
          emptyStateCard(
            "还没有链接数据卡",
            "一个商品可以绑定多个店铺、包型和链接。先维护店铺经营资料，再记录第一个链接。",
            "去店铺经营设置",
            () => switchView("store-settings")
          )
        ])
  );
}

function renderDataTasksAndSnapshots(operations) {
  elements.dataTaskList.replaceChildren(
    ...(operations.dataCollectionTasks.length
      ? operations.dataCollectionTasks.map((task) =>
          commerceCard(
            `采集任务｜${task.period}`,
            [task.status, task.review_due_at],
            [
              `listing_id：${task.target_listing_id}`,
              `platform_product_id：${task.platform_product_id || "未绑定"}`,
              `platform_sku_id：${task.platform_sku_id || "按链接采集"}`,
              `snapshot_id：${task.snapshot_id || "未填写"}`
            ].join("\n"),
            {
              actions: [
                {
                  label: "删除任务",
                  danger: true,
                  action: () =>
                    deleteOperationResource(
                      `/api/operations/tasks/${encodeURIComponent(task.task_id)}`,
                      "确认删除这个数据采集任务？"
                    )
                }
              ]
            }
          )
        )
      : [
          emptyStateCard(
            "还没有数据采集任务",
            "先在上架接入里创建 Listing 数据卡，再创建周期采集任务，让运营动作有真实数据依据。",
            "去上架接入",
            () => switchView("listing-matrix")
          )
        ])
  );
  elements.snapshotList.replaceChildren(
    ...(operations.performanceSnapshots.length
      ? operations.performanceSnapshots.slice(-8).reverse().map((snapshot) =>
          commerceCard(
            `周期快照｜${snapshot.period_start} 至 ${snapshot.period_end}`,
            [`CTR ${percent(snapshot.ctr)}`, `CVR ${percent(snapshot.cvr)}`, `ROI ${numberText(snapshot.roi)}`, `退款率 ${percent(snapshot.refund_rate)}`],
            [
              metricSummary(snapshot),
              `平台商品：${snapshot.platform_product_id || "未绑定"}｜SKU：${snapshot.platform_sku_id || "按链接"}`,
              ...(snapshot.suggestions || []).map((item) => `建议：${item}`)
            ].join("\n"),
            {
              actions: [
                {
                  label: "删除快照",
                  danger: true,
                  action: () =>
                    deleteOperationResource(
                      `/api/operations/snapshots/${encodeURIComponent(snapshot.snapshot_id)}`,
                      "确认删除这个周期快照？"
                    )
                }
              ]
            }
          )
        )
      : [
          emptyStateCard(
            "还没有周期快照",
            "录入曝光、点击、订单、销售额、广告花费等原始字段后，系统会自动计算 CTR、CVR、ROI 和退款率。",
            "录入周期数据",
            () => switchView("data-tasks")
          )
        ])
  );
}

function renderOperationActions(operations) {
  elements.operationActionList.replaceChildren(
    ...(operations.operationActions.length
      ? operations.operationActions.slice().reverse().map((action) =>
          commerceCard(
            action.action_type,
            [actionStatusLabel(action.status), reviewStatusLabel(action.review_status)],
            [
              `原因：${action.reason || "未填写"}`,
              `目标指标：${action.target_metric || "未填写"}`,
              `观察周期：${action.observation_period || "未填写"}`,
              `复盘时间：${action.review_due_at || "未设置"}`,
              action.review_result && `复盘结果：${action.review_result}`
            ].filter(Boolean).join("\n"),
            {
              actions: [
                {
                  label: "删除动作",
                  danger: true,
                  action: () =>
                    deleteOperationResource(
                      `/api/operations/actions/${encodeURIComponent(action.action_id)}`,
                      "确认删除这个运营动作？"
                    )
                }
              ]
            }
          )
        )
      : [
          emptyStateCard(
            "还没有运营动作",
            "基于周期快照创建测图、改标题、广告测试等动作。系统只提示，必须人工确认后才执行。",
            "创建运营动作",
            () => switchView("operation-actions")
          )
        ])
  );
}

function renderOperationReviews(operations) {
  const activeReviewInput =
    document.activeElement?.classList?.contains("commerce-review-input") &&
    elements.operationReviewList.contains(document.activeElement);
  if (activeReviewInput || commerceDirtyForms.has("review")) return;

  const due = operations.operationActions.filter((action) =>
    ["pending_review", "overdue"].includes(action.review_status)
  );
  const reviewed = operations.operationActions
    .filter((action) => action.review_status === "reviewed" && action.review_result)
    .slice()
    .reverse()
    .slice(0, 5);
  const reviewItems = [
    ...due,
    ...reviewed.filter(
      (action) => !due.some((dueAction) => dueAction.action_id === action.action_id)
    )
  ];
  elements.operationReviewList.replaceChildren(
    ...(reviewItems.length
      ? reviewItems.map((action) => {
          const reviewedAction = action.review_status === "reviewed";
          const card = commerceCard(
            `${action.action_type}｜${reviewStatusLabel(action.review_status)}`,
            [action.status, action.review_due_at || "未设置"],
            [
              `动作原因：${action.reason}`,
              `目标指标：${action.target_metric}`,
              action.review_result && `复盘结果：${action.review_result}`,
              `Agent 结论：${action.agent_conclusion || "待填写"}`
            ].filter(Boolean).join("\n")
          );
          card.dataset.actionId = action.action_id;
          if (reviewedAction) return card;
          const result = document.createElement("textarea");
          result.placeholder = "填写复盘结果";
          result.className = "commerce-review-input";
          result.value = reviewDrafts.get(action.action_id) ?? action.review_result ?? "";
          result.addEventListener("input", () => {
            reviewDrafts.set(action.action_id, result.value);
            markCommerceFormDirty("review");
          });
          const button = document.createElement("button");
          button.type = "button";
          button.className = "button secondary";
          button.textContent = "保存复盘";
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            void updateActionReview(action.action_id, result.value, button);
          });
          card.append(result, button);
          return card;
        })
      : [
          emptyStateCard(
            "当前没有到期复盘动作",
            "当动作进入 pending_review 或 overdue，这里会提醒你填写复盘结果，判断继续、放大或停止。",
            "查看今日执行记录",
            () => switchView("operation-actions")
          )
        ])
  );
}

function fillOperationSelects(operations) {
  fillSelect(elements.listingProductSelect, operations.products, "productId", "displayName");
  fillSelect(elements.actionProductSelect, operations.products, "productId", "displayName");
  fillSelect(
    elements.listingStoreSelect,
    operations.storeProfiles,
    "store_id",
    "store_alias"
  );
  fillSelect(
    elements.legacyStoreSelect,
    operations.storeProfiles,
    "store_id",
    "store_alias"
  );
  const listingLabel = (listing) =>
    `${listing.platform_product_id || listing.inventory_sku || listing.target_bag_model || listing.listing_id}｜${listing.listing_lifecycle}`;
  fillSelect(elements.taskListingSelect, operations.listingCards, "listing_id", listingLabel);
  fillSelect(elements.snapshotListingSelect, operations.listingCards, "listing_id", listingLabel);
  fillSelect(elements.actionListingSelect, operations.listingCards, "listing_id", listingLabel);
  fillSelect(elements.skuMappingListingSelect, operations.listingCards, "listing_id", listingLabel);
  fillSkuMappingSelects(operations);
  fillSelect(
    elements.snapshotTaskSelect,
    [{ task_id: "", label: "不关联任务" }, ...operations.dataCollectionTasks],
    "task_id",
    (task) => task.label || `${task.period}｜${task.status}`
  );
  restoreDirtyCommerceForms();
}

function fillSkuMappingSelects(operations) {
  const mappingLabel = (mapping) =>
    `${mapping.variant_name || mapping.platform_sku_id || mapping.seller_sku_code || "未命名变体"}｜${mapping.inventory_sku || "未绑定内部 SKU"}`;
  const byTaskListing = (operations.listingSkuMappings || []).filter(
    (mapping) => mapping.listing_id === elements.taskListingSelect?.value
  );
  const bySnapshotListing = (operations.listingSkuMappings || []).filter(
    (mapping) => mapping.listing_id === elements.snapshotListingSelect?.value
  );
  fillSelect(
    elements.taskSkuMappingSelect,
    [{ platform_sku_id: "", label: "不绑定 SKU，按链接采集" }, ...byTaskListing],
    "platform_sku_id",
    (mapping) => mapping.label || mappingLabel(mapping)
  );
  fillSelect(
    elements.snapshotSkuMappingSelect,
    [{ platform_sku_id: "", label: "不绑定 SKU，按链接保存" }, ...bySnapshotListing],
    "platform_sku_id",
    (mapping) => mapping.label || mappingLabel(mapping)
  );
}

function fillSelect(select, items, valueKey, labelKey) {
  if (!select) return;
  const current = select.value;
  select.replaceChildren(
    ...items.map((item) => {
      const option = document.createElement("option");
      option.value = item[valueKey] || "";
      option.textContent =
        typeof labelKey === "function" ? labelKey(item) : item[labelKey] || item[valueKey] || "未命名";
      return option;
    })
  );
  if ([...select.options].some((option) => option.value === current)) {
    select.value = current;
  }
}

function editStoreProfile(store) {
  editingStoreId = store.store_id;
  setValue(elements.storeAlias, store.store_alias);
  setValue(elements.storePlatform, store.platform || "AliExpress");
  setValue(elements.storeHitoorEnvName, store.hitoor_env_name);
  setValue(elements.storeHitoorEnvId, store.hitoor_env_id);
  setValue(elements.storeRole, store.store_role);
  setValue(elements.storeStatus, store.status);
  setValue(elements.storeRemark, store.remark);
  elements.saveStoreProfileButton.textContent = "更新店铺与环境";
  markCommerceFormDirty("storeProfile");
}

function editListingCard(listing) {
  editingListingId = listing.listing_id;
  setValue(elements.listingProductSelect, listing.product_id);
  setValue(elements.listingStoreSelect, listing.store_id);
  setValue(elements.listingPlatformProductId, listing.platform_product_id);
  setValue(elements.listingTitle, listing.listing_title);
  setValue(elements.listingStatus, listing.listing_status);
  setValue(elements.listingInventorySku, listing.inventory_sku);
  setValue(elements.listingLifecycle, listing.listing_lifecycle);
  setValue(elements.listingBagModel, listing.target_bag_model);
  setValue(elements.listingTargetSize, listing.target_size);
  setValue(elements.listingUrl, listing.listing_url);
  setValue(elements.listingImageVersion, listing.image_version);
  setValue(elements.listingTitleVersion, listing.title_version);
  elements.saveListingCardButton.textContent = "更新链接数据卡";
  markCommerceFormDirty("listingCard");
}

function editSkuMapping(mapping) {
  editingSkuMappingId = mapping.mapping_id;
  setValue(elements.skuMappingListingSelect, mapping.listing_id);
  setValue(elements.skuPlatformSkuId, mapping.platform_sku_id);
  setValue(elements.skuSellerSkuCode, mapping.seller_sku_code);
  setValue(elements.skuPlatformBarcode, mapping.platform_barcode);
  setValue(elements.skuVariantName, mapping.variant_name);
  setValue(elements.skuColor, mapping.color);
  setValue(elements.skuSize, mapping.size);
  setValue(elements.skuInventorySku, mapping.inventory_sku);
  setValue(elements.skuWarehouseSku, mapping.warehouse_sku);
  setValue(elements.skuMappingStatus, mapping.status);
  setValue(elements.skuMappingRemark, mapping.remark);
  elements.saveSkuMappingButton.textContent = "更新 SKU 映射";
  markCommerceFormDirty("skuMapping");
}

function openCommerceDetail(productId) {
  void openProductHub(productId);
}

async function openProductHub(productId, options = {}) {
  selectedOperationProductId = productId;
  selectedCommerceDetailTab = options.tab || selectedCommerceDetailTab || "overview";
  await loadProductHubProfile(productId);
  renderOperations(latestPayload?.operations || emptyOperations());
  switchView("commerce-product-detail");
}

async function loadProductHubProfile(productId) {
  if (!productId || productHubProfiles.has(productId)) return productHubProfiles.get(productId);
  try {
    const body = await request(`/api/product-profiles/${encodeURIComponent(productId)}`);
    productHubProfiles.set(productId, body.profile);
    return body.profile;
  } catch {
    return undefined;
  }
}

function jumpToProductListing(productId, listingId, target = "listing") {
  commercePrefillContext = { productId, listingId, target };
  switchView("listing-matrix");
  renderOperations(latestPayload?.operations || emptyOperations());
}

function jumpToProductSnapshot(productId, listingId) {
  commercePrefillContext = { productId, listingId, target: "snapshot" };
  switchView("data-tasks");
  renderOperations(latestPayload?.operations || emptyOperations());
}

function jumpToProductAction(productId, listingId) {
  commercePrefillContext = { productId, listingId, target: "action" };
  switchView("operation-actions");
  renderOperations(latestPayload?.operations || emptyOperations());
}

function jumpToProductReview(productId, actionId) {
  commercePrefillContext = { productId, actionId, target: "review" };
  switchView("operation-review");
  renderOperations(latestPayload?.operations || emptyOperations());
}

function applyCommercePrefill(operations) {
  if (!commercePrefillContext) return;
  const context = commercePrefillContext;
  commercePrefillContext = undefined;
  const listings = (operations.listingCards || []).filter(
    (listing) => listing.product_id === context.productId
  );
  const listingId = context.listingId || listings[0]?.listing_id || "";
  if (context.target === "listing" || context.target === "sku") {
    const forms = context.target === "sku" ? ["skuMapping"] : ["listingCard"];
    if (!confirmPrefillOverwrite(forms)) return;
    setValue(elements.listingProductSelect, context.productId);
    if (listingId) {
      setValue(elements.skuMappingListingSelect, listingId);
      const listing = listings.find((item) => item.listing_id === listingId);
      if (listing && context.target === "listing") editListingCard(listing);
    }
    if (context.target === "sku") markCommerceFormDirty("skuMapping");
    return;
  }
  if (context.target === "snapshot") {
    if (!confirmPrefillOverwrite(["dataTask", "snapshot"])) return;
    setValue(elements.taskListingSelect, listingId);
    setValue(elements.snapshotListingSelect, listingId);
    fillSkuMappingSelects(operations);
    markCommerceFormDirty("snapshot");
    return;
  }
  if (context.target === "action") {
    if (!confirmPrefillOverwrite(["operationAction"])) return;
    setValue(elements.actionProductSelect, context.productId);
    setValue(elements.actionListingSelect, listingId);
    markCommerceFormDirty("operationAction");
    return;
  }
  if (context.target === "review" && context.actionId) {
    window.setTimeout(() => {
      const card = document.querySelector(`[data-action-id="${CSS.escape(context.actionId)}"]`);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      card?.classList.add("selected");
    }, 0);
  }
}

function confirmPrefillOverwrite(formNames) {
  const dirty = formNames.filter((name) => commerceDirtyForms.has(name));
  if (!dirty.length) return true;
  return confirm("目标页面有未保存表单。是否用当前商品上下文覆盖选择项？未保存草稿仍会保留在当前页面内存中。");
}

function kpiCard(label, value, hint, tone = "") {
  const card = document.createElement("article");
  card.className = ["kpi-card", tone].filter(Boolean).join(" ");
  const strong = document.createElement("strong");
  strong.textContent = numberText(value);
  const title = document.createElement("span");
  title.textContent = label;
  const text = document.createElement("p");
  text.textContent = hint;
  card.append(strong, title, text);
  return card;
}

function detailGrid(rows) {
  const grid = document.createElement("dl");
  grid.className = "detail-grid";
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value || "-";
    grid.append(dt, dd);
  }
  return grid;
}

function listingCardForDetail(listing, operations) {
  const store = operations.storeProfiles.find((item) => item.store_id === listing.store_id);
  const skuMappings = (operations.listingSkuMappings || []).filter(
    (mapping) => mapping.listing_id === listing.listing_id
  );
  return commerceCard(
    listing.listing_title ||
      listing.target_bag_model ||
      listing.inventory_sku ||
      listing.platform_product_id ||
      listing.listing_id,
    [
      lifecycleLabel(listing.listing_lifecycle),
      store?.store_alias || "店铺缺失",
      store?.hitoor_env_name || "Hitoor 未填",
      skuMappings.length ? `SKU ${skuMappings.length}` : ""
    ],
    [
      `平台商品 ID：${listing.platform_product_id || "未填"}`,
      `库存 SKU：${listing.inventory_sku || "未填"}`,
      `目标尺寸：${listing.target_size || "未填"}`,
      `链接：${listing.listing_url || "未填"}`,
      skuMappings.length
        ? `变体：${skuMappings
            .map((mapping) => `${mapping.variant_name || mapping.platform_sku_id || "未命名"} / ${mapping.inventory_sku || "未绑定"}`)
            .join("；")}`
        : "变体：未添加 SKU 映射"
    ].join("\n")
  );
}

function commerceCard(title, chips, body, options = {}) {
  const card = document.createElement("article");
  card.className = "commerce-card";
  const main = document.createElement("div");
  main.className = "commerce-card-main";
  if (options.thumbnailUrl) {
    card.classList.add("with-thumb");
    const thumb = document.createElement("div");
    thumb.className = "commerce-thumb";
    const image = document.createElement("img");
    image.src = `${options.thumbnailUrl}?v=${encodeURIComponent(options.thumbnailVersion || "")}`;
    image.alt = options.thumbnailAlt || title || "商品缩略图";
    image.loading = "lazy";
    image.addEventListener("error", () => {
      thumb.textContent = "图";
      image.remove();
    });
    thumb.append(image);
    card.append(thumb);
  }
  const heading = document.createElement("h4");
  heading.textContent = title || "未命名";
  const meta = document.createElement("div");
  meta.className = "commerce-meta";
  for (const chip of chips.filter(Boolean)) {
    const item = document.createElement("span");
    item.textContent = chip;
    item.classList.add(statusTone(chip));
    meta.append(item);
  }
  const text = document.createElement("p");
  text.textContent = body || "";
  main.append(heading, meta, text);
  const actions = options.actions || (options.actionLabel && options.action
    ? [{ label: options.actionLabel, action: options.action }]
    : []);
  if (actions.length) {
    const actionBox = document.createElement("div");
    actionBox.className = "card-actions";
    actions.forEach((item) => {
    const button = document.createElement("button");
      button.className = item.danger
        ? "button danger compact-button"
        : "button secondary compact-button";
    button.type = "button";
      button.textContent = item.label;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
        item.action();
    });
      actionBox.append(button);
    });
    main.append(actionBox);
  }
  card.append(main);
  return card;
}

function emptyCard(message) {
  const card = document.createElement("p");
  card.className = "profile-empty";
  card.textContent = message;
  return card;
}

function emptyStateCard(title, message, actionLabel, action) {
  const card = document.createElement("article");
  card.className = "empty-state-card";
  const icon = document.createElement("span");
  icon.className = "empty-state-icon";
  icon.textContent = "·";
  const heading = document.createElement("h4");
  heading.textContent = title;
  const text = document.createElement("p");
  text.textContent = message;
  card.append(icon, heading, text);
  if (actionLabel && action) {
    const button = document.createElement("button");
    button.className = "button secondary compact-button";
    button.type = "button";
    button.textContent = actionLabel;
    button.addEventListener("click", action);
    card.append(button);
  }
  return card;
}

function tierLabel(value) {
  return {
    normal: "普通商品",
    potential: "潜力品",
    hot: "爆品",
    paused: "暂停品",
    dead: "死亡品"
  }[value] || value;
}

function statusTone(value) {
  const text = String(value || "");
  if (/爆品|hot|暖/.test(text)) return "hot";
  if (/潜力品|potential|approved|蓝色/.test(text)) return "potential";
  if (/建议|suggested/.test(text)) return "suggested";
  if (/执行中|executing/.test(text)) return "executing";
  if (/已完成|已复盘|done|reviewed|绿色/.test(text)) return "done";
  if (/暂停|paused|灰黄/.test(text)) return "paused";
  if (/死亡|dead|下架|offline|cancelled|已取消/.test(text)) return "dead";
  if (/待复盘|pending|逾期|overdue/.test(text)) return "warning";
  return "neutral";
}

function lifecycleLabel(value) {
  return {
    not_listed: "未上架",
    listed: "已上架",
    observing: "观察中",
    first_order: "首单",
    growing: "增长中",
    stable: "稳定",
    declining: "下滑",
    dead: "死亡",
    offline: "下架"
  }[value] || value;
}

function reviewStatusLabel(value) {
  return {
    not_due: "未到复盘",
    pending_review: "待复盘",
    reviewed: "已复盘",
    overdue: "逾期复盘"
  }[value] || value;
}

function actionStatusLabel(value) {
  return {
    suggested: "建议",
    approved: "已确认",
    executing: "执行中",
    done: "已完成",
    cancelled: "已取消"
  }[value] || value;
}

function metricSummary(snapshot) {
  return `曝光 ${numberText(snapshot.impressions)}｜点击 ${numberText(snapshot.clicks)}｜订单 ${numberText(snapshot.orders)}｜销售额 ${numberText(snapshot.revenue)}｜花费 ${numberText(snapshot.ad_spend)}`;
}

function numberText(value) {
  return value === undefined || value === null ? "-" : String(value);
}

function percent(value) {
  return value === undefined || value === null ? "-" : `${(value * 100).toFixed(2)}%`;
}

function setValue(element, value) {
  if (element && document.activeElement !== element) element.value = value || "";
}

function markCommerceFormDirty(formName) {
  commerceDirtyForms.add(formName);
  if (formName === "operationProfile") {
    operationProfileDirtyProductId = selectedOperationProductId;
  }
}

function clearCommerceFormDirty(formName) {
  commerceDirtyForms.delete(formName);
  commerceFormDrafts.delete(formName);
  if (formName === "operationProfile") {
    operationProfileDirtyProductId = selectedOperationProductId;
  }
}

function trackCommerceForm(formName, controls) {
  controls.filter(Boolean).forEach((control) => {
    ["focusin", "input", "change"].forEach((eventName) => {
      control.addEventListener(eventName, () => {
        markCommerceFormDirty(formName);
        captureCommerceFormDraft(formName);
      });
    });
  });
}

function commerceFormControls(formName) {
  return {
    operationProfile: [
      elements.operationProductTier,
      elements.operationNextReviewAt,
      elements.operationEntryReason,
      elements.operationGoal,
      elements.operationStrategy,
      elements.operationPlanType,
      elements.operationTargetMetric,
      elements.operationPlanObjective,
      elements.operationSuccessCondition,
      elements.operationFailureCondition,
      elements.operationAgentSummary
    ],
    storeProfile: [
      elements.storeAlias,
      elements.storePlatform,
      elements.storeHitoorEnvName,
      elements.storeHitoorEnvId,
      elements.storeRole,
      elements.storeStatus,
      elements.storeRemark
    ],
    listingCard: [
      elements.listingProductSelect,
      elements.listingStoreSelect,
      elements.listingPlatformProductId,
      elements.listingTitle,
      elements.listingStatus,
      elements.listingInventorySku,
      elements.listingLifecycle,
      elements.listingBagModel,
      elements.listingTargetSize,
      elements.listingUrl,
      elements.listingImageVersion,
      elements.listingTitleVersion
    ],
    skuMapping: [
      elements.skuMappingListingSelect,
      elements.skuPlatformSkuId,
      elements.skuSellerSkuCode,
      elements.skuPlatformBarcode,
      elements.skuVariantName,
      elements.skuColor,
      elements.skuSize,
      elements.skuInventorySku,
      elements.skuWarehouseSku,
      elements.skuMappingStatus,
      elements.skuMappingRemark
    ],
    dataTask: [
      elements.taskListingSelect,
      elements.taskSkuMappingSelect,
      elements.taskPeriod,
      elements.taskReviewDueAt,
      elements.taskRelatedPlanId
    ],
    snapshot: [
      elements.snapshotListingSelect,
      elements.snapshotTaskSelect,
      elements.snapshotSkuMappingSelect,
      elements.snapshotPeriodStart,
      elements.snapshotPeriodEnd,
      elements.snapshotImpressions,
      elements.snapshotVisitors,
      elements.snapshotClicks,
      elements.snapshotAddToCart,
      elements.snapshotOrders,
      elements.snapshotRevenue,
      elements.snapshotAdSpend,
      elements.snapshotRefundCount,
      elements.snapshotBadReviews,
      elements.snapshotSearchTerms,
      elements.snapshotInventoryStatus
    ],
    operationAction: [
      elements.actionProductSelect,
      elements.actionListingSelect,
      elements.actionType,
      elements.actionStatus,
      elements.actionReason,
      elements.actionTargetMetric,
      elements.actionObservationPeriod,
      elements.actionOperator,
      elements.actionReviewDueAt
    ],
    newProduct: [
      elements.newProductDisplayName,
      elements.newProductCategory,
      elements.newProductCreationType,
      elements.newProductInventorySku,
      elements.newProductWarehouseSku,
      elements.newProductSize,
      elements.newProductColor,
      elements.newProductInventoryRemark,
      elements.newProductNotes,
    ],
    legacyOnboard: [
      elements.legacyProductDisplayName,
      elements.legacyStoreSelect,
      elements.legacyPlatformProductId,
      elements.legacyListingUrl,
      elements.legacyListingTitle,
      elements.legacyInventorySku,
      elements.legacyListingLifecycle,
      elements.legacyPlatformSkuId,
      elements.legacySellerSkuCode,
      elements.legacyPlatformBarcode,
      elements.legacyVariantName,
      elements.legacyWarehouseSku,
      elements.legacyNotes
    ]
  }[formName] || [];
}

function captureCommerceFormDraft(formName) {
  const values = {};
  commerceFormControls(formName).filter(Boolean).forEach((control) => {
    if (control.id) values[control.id] = control.type === "checkbox" ? control.checked : control.value;
  });
  commerceFormDrafts.set(formName, values);
}

function restoreCommerceFormDraft(formName) {
  const values = commerceFormDrafts.get(formName);
  if (!values) return;
  commerceFormControls(formName).filter(Boolean).forEach((control) => {
    if (control.id && Object.prototype.hasOwnProperty.call(values, control.id)) {
      if (control.type === "checkbox") control.checked = Boolean(values[control.id]);
      else control.value = values[control.id] || "";
    }
  });
}

function restoreDirtyCommerceForms() {
  commerceDirtyForms.forEach((formName) => {
    if (formName !== "review") restoreCommerceFormDraft(formName);
  });
}

function hasUnsavedCommerceForms() {
  return commerceDirtyForms.size > 0;
}

function trackProfileForm(controls) {
  controls.filter(Boolean).forEach((control) => {
    ["focusin", "input", "change"].forEach((eventName) => {
      control.addEventListener(eventName, () => {
        profileFormDirty = true;
        profileFormProductId =
          latestPayload?.productProfile?.profile?.productId || profileFormProductId;
      });
    });
  });
}

async function importQueueWorkbook(file) {
  if (!file) return;
  elements.queueWorkbookInput.disabled = true;
  elements.queueImportMessage.textContent = "正在解析 Excel 并下载全部商品图片…";
  const form = new FormData();
  form.append("workbook", file);
  try {
    const body = await request("/api/queue/import", {
      method: "POST",
      body: form
    });
    elements.queueImportMessage.textContent =
      `已加入 ${body.summary.imported} 个，素材无效 ${body.summary.invalid} 个，重复跳过 ${body.summary.duplicates} 个`;
    await refreshTwice();
  } catch (error) {
    elements.queueImportMessage.textContent = `导入失败：${error.message}`;
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    elements.queueWorkbookInput.disabled = false;
    elements.queueWorkbookInput.value = "";
  }
}

async function saveOperationProfile() {
  if (!selectedOperationProductId) return;
  const planType = elements.operationPlanType.value;
  const saved = await operationRequest(elements.saveOperationProfileButton, `/api/operations/profiles/${encodeURIComponent(selectedOperationProductId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      product_tier: elements.operationProductTier.value,
      current_operation_goal: elements.operationGoal.value,
      entry_reason: elements.operationEntryReason.value,
      current_strategy: elements.operationStrategy.value,
      next_review_at: elements.operationNextReviewAt.value,
      agent_summary: elements.operationAgentSummary.value,
      current_operation_plan: planType
        ? {
            plan_id: "",
            plan_type: planType,
            objective: elements.operationPlanObjective.value,
            start_date: "",
            end_date: "",
            target_metric: elements.operationTargetMetric.value,
            success_condition: elements.operationSuccessCondition.value,
            failure_condition: elements.operationFailureCondition.value
          }
        : undefined
    })
  }, {
    successText: "已保存运营档案",
    beforeRefresh: () => clearCommerceFormDirty("operationProfile")
  });
}

async function saveStoreProfile() {
  const saved = await operationRequest(elements.saveStoreProfileButton, "/api/operations/stores", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      store_id: editingStoreId || undefined,
      store_alias: elements.storeAlias.value,
      platform: elements.storePlatform.value || "AliExpress",
      hitoor_env_name: elements.storeHitoorEnvName.value,
      hitoor_env_id: elements.storeHitoorEnvId.value,
      store_role: elements.storeRole.value,
      status: elements.storeStatus.value,
      remark: elements.storeRemark.value
    })
  }, {
    successText: "已保存店铺",
    finalText: "保存店铺与环境",
    beforeRefresh: () => {
      editingStoreId = "";
      clearCommerceFormDirty("storeProfile");
    }
  });
}

async function saveListingCard() {
  const saved = await operationRequest(elements.saveListingCardButton, "/api/operations/listings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      listing_id: editingListingId || undefined,
      product_id: elements.listingProductSelect.value,
      store_id: elements.listingStoreSelect.value,
      platform_product_id: elements.listingPlatformProductId.value,
      listing_title: elements.listingTitle.value,
      listing_status: elements.listingStatus.value,
      inventory_sku: elements.listingInventorySku.value,
      target_bag_model: elements.listingBagModel.value,
      target_size: elements.listingTargetSize.value,
      listing_url: elements.listingUrl.value,
      image_version: elements.listingImageVersion.value,
      title_version: elements.listingTitleVersion.value,
      listing_lifecycle: elements.listingLifecycle.value
    })
  }, {
    successText: "已保存链接",
    finalText: "保存链接数据卡",
    beforeRefresh: () => {
      editingListingId = "";
      clearCommerceFormDirty("listingCard");
    }
  });
}

async function saveSkuMapping() {
  const saved = await operationRequest(elements.saveSkuMappingButton, "/api/operations/listing-sku-mappings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mapping_id: editingSkuMappingId || undefined,
      listing_id: elements.skuMappingListingSelect.value,
      platform_sku_id: elements.skuPlatformSkuId.value,
      seller_sku_code: elements.skuSellerSkuCode.value,
      platform_barcode: elements.skuPlatformBarcode.value,
      variant_name: elements.skuVariantName.value,
      color: elements.skuColor.value,
      size: elements.skuSize.value,
      inventory_sku: elements.skuInventorySku.value,
      warehouse_sku: elements.skuWarehouseSku.value,
      status: elements.skuMappingStatus.value,
      remark: elements.skuMappingRemark.value
    })
  }, {
    successText: "已保存 SKU 映射",
    finalText: "保存 SKU 映射",
    beforeRefresh: () => {
      editingSkuMappingId = "";
      clearCommerceFormDirty("skuMapping");
    }
  });
}

async function createNewProductProfile() {
  const button = elements.createNewProductButton;
  const originalText = button.textContent;
  const sourceTag = elements.newProductCreationType.value || "new_product_development";
  if (sourceTag === "live_legacy_import") {
    elements.newProductHint.textContent = productSourceCopy.live_legacy_import.hint;
    switchView("listing-matrix");
    elements.legacyOnboardHint.textContent = "请在这里填写店铺、平台商品 ID、商品链接和平台标题，创建老品档案并接入。";
    elements.legacyProductDisplayName?.scrollIntoView({ behavior: "smooth", block: "center" });
    elements.legacyProductDisplayName?.focus();
    return;
  }
  const displayName = elements.newProductDisplayName.value.trim();
  if (!displayName) {
    elements.newProductHint.textContent = "请先填写商品名称。商品档案必须是一个具体商品主体，不能是空名称。";
    elements.newProductDisplayName.focus();
    return;
  }
  button.disabled = true;
  button.textContent = "正在建档…";
  try {
    const inventoryLines = sourceTag === "inventory_driven"
      ? [
          elements.newProductInventorySku.value.trim() && `inventory_sku: ${elements.newProductInventorySku.value.trim()}`,
          elements.newProductWarehouseSku.value.trim() && `warehouse_sku: ${elements.newProductWarehouseSku.value.trim()}`,
          elements.newProductSize.value.trim() && `size: ${elements.newProductSize.value.trim()}`,
          elements.newProductColor.value.trim() && `color: ${elements.newProductColor.value.trim()}`,
          elements.newProductInventoryRemark.value.trim() && `stock_note: ${elements.newProductInventoryRemark.value.trim()}`
        ].filter(Boolean)
      : [];
    const inventoryNotes = inventoryLines.length ? ["[inventory]", ...inventoryLines].join("\n") : "";
    const notes = [elements.newProductNotes.value, inventoryNotes].filter(Boolean).join("\n");
    const body = await request("/api/product-profiles/lightweight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName,
        category: elements.newProductCategory.value,
        notes,
        sourceTag,
        nextAction: productSourceCopy[sourceTag]?.nextAction,
        entry_reason: productSourceEntryReasons[sourceTag]
      })
    });
    selectedOperationProductId = body.profile.productId;
    productHubProfiles.set(body.profile.productId, body.profile);
    clearCommerceFormDirty("newProduct");
    resetControls(commerceFormControls("newProduct"));
    elements.newProductCreationType.value = "new_product_development";
    updateNewProductCreationTypeUI();
    elements.newProductHint.textContent = productSourceCopy[sourceTag]?.hint || "已创建商品档案。";
    await loadProductLibrary();
    await refresh();
    if (sourceTag === "new_product_development") {
      switchView("materials");
      elements.folderHint.textContent = "请上传产品素材，开始 AI 识别";
    } else {
      await openProductHub(body.profile.productId);
    }
  } catch (error) {
    elements.newProductHint.textContent = `建档失败：${error.message}`;
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function createLegacyProductOnboarding() {
  const button = elements.legacyOnboardButton;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "正在创建并接入…";
  try {
    const body = await request("/api/product-profiles/legacy-onboard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: elements.legacyProductDisplayName.value,
        store_id: elements.legacyStoreSelect.value,
        platform_product_id: elements.legacyPlatformProductId.value,
        listing_url: elements.legacyListingUrl.value,
        listing_title: elements.legacyListingTitle.value,
        inventory_sku: elements.legacyInventorySku.value,
        listing_lifecycle: elements.legacyListingLifecycle.value,
        platform_sku_id: elements.legacyPlatformSkuId.value,
        seller_sku_code: elements.legacySellerSkuCode.value,
        platform_barcode: elements.legacyPlatformBarcode.value,
        variant_name: elements.legacyVariantName.value,
        sku_inventory_sku: elements.legacyInventorySku.value,
        warehouse_sku: elements.legacyWarehouseSku.value,
        notes: elements.legacyNotes.value
      })
    });
    selectedOperationProductId = body.profile.productId;
    productHubProfiles.set(body.profile.productId, body.profile);
    clearCommerceFormDirty("legacyOnboard");
    resetControls(commerceFormControls("legacyOnboard"));
    elements.legacyOnboardHint.textContent = "已创建老品档案、默认经营档案和上架接入记录。";
    await refresh();
    await loadProductLibrary();
    await openProductHub(body.profile.productId, { tab: body.mapping ? "snapshots" : "sku" });
  } catch (error) {
    elements.legacyOnboardHint.textContent = `接入失败：${error.message}`;
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function resetControls(controls) {
  controls.filter(Boolean).forEach((control) => {
    if (control.type === "checkbox") control.checked = false;
    else control.value = "";
  });
}

async function deleteOperationResource(url, message) {
  if (
    hasUnsavedCommerceForms() &&
    !confirm("当前经营表单有未保存内容。继续删除会刷新数据，但未保存草稿仍只保留在当前页面内存中。确定继续吗？")
  ) return;
  if (!confirm(message)) return;
  await request(url, { method: "DELETE" });
  await refresh();
}

async function previewInsertStockSheet() {
  elements.previewInsertStockSheetButton.disabled = true;
  elements.previewInsertStockSheetButton.textContent = "正在生成库存行…";
  try {
    const body = await request("/api/insert/stock-sheet/preview");
    renderInsertStockSheetPreview(body.rows || [], body.tsv || "", body.webhook || {});
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    elements.previewInsertStockSheetButton.disabled = false;
    elements.previewInsertStockSheetButton.textContent = "写入内胆库存尺寸表";
  }
}

function renderInsertStockSheetPreview(rows, tsv, webhook = {}) {
  elements.insertStockSheetPreview.classList.remove("hidden");
  const title = document.createElement("h4");
  title.textContent = "内胆现货尺寸表写入预览";
  const note = document.createElement("p");
  note.textContent =
    webhook.configured
      ? "已配置 Google Sheets 自动写入。确认数据无误后可直接写入「内胆现货尺寸表」工作表1。"
      : "当前本机还没有 Google Sheets 自动写入授权。可先配置 Apps Script Webhook；未配置时仍可复制 TSV 手工粘贴。";
  const table = document.createElement("table");
  table.className = "mini-table";
  const head = document.createElement("thead");
  head.innerHTML = "<tr><th>编码</th><th>材质</th><th>底长</th><th>底宽</th><th>高</th><th>适配区间</th><th>状态</th></tr>";
  const body = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    [
      row.skuCode,
      row.material,
      row.length,
      row.width,
      row.height,
      row.fitRange || "-",
      row.status === "skipped_duplicate"
        ? "重复，默认跳过"
        : row.status === "auto_written"
          ? "已自动写入"
          : row.status === "write_failed"
            ? "写入失败"
            : "待写入"
    ].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = String(value ?? "");
      tr.append(td);
    });
    body.append(tr);
  });
  table.append(head, body);
  const textarea = document.createElement("textarea");
  textarea.readOnly = true;
  textarea.value = tsv;
  textarea.rows = Math.max(3, Math.min(8, rows.length + 1));
  const actions = document.createElement("div");
  actions.className = "row-actions";
  const webhookPanel = document.createElement("div");
  webhookPanel.className = "stock-webhook-panel";
  const webhookSummary = document.createElement("p");
  webhookSummary.textContent = webhook.configured
    ? `自动写入已启用：${webhook.webhookUrl || "已保存 Webhook"}`
    : "配置一次 Google Apps Script Webhook 后，后续可自动写入，不再需要复制 TSV。";
  const webhookUrl = document.createElement("input");
  webhookUrl.placeholder = "Google Apps Script Web App URL";
  webhookUrl.value = webhook.webhookUrl || "";
  const webhookToken = document.createElement("input");
  webhookToken.placeholder = "写入密钥 token";
  webhookToken.type = "password";
  const saveWebhook = document.createElement("button");
  saveWebhook.className = "button secondary";
  saveWebhook.textContent = webhook.configured ? "更新自动写入授权" : "保存自动写入授权";
  saveWebhook.addEventListener("click", async () => {
    saveWebhook.disabled = true;
    try {
      await request("/api/insert/stock-sheet/webhook", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          webhookUrl: webhookUrl.value,
          token: webhookToken.value
        })
      });
      saveWebhook.textContent = "已保存授权";
      await previewInsertStockSheet();
    } catch (error) {
      elements.errorBox.classList.remove("hidden");
      elements.errorBox.textContent = error.message;
    } finally {
      saveWebhook.disabled = false;
    }
  });
  webhookPanel.append(webhookSummary, webhookUrl, webhookToken, saveWebhook);
  const copy = document.createElement("button");
  copy.className = "button secondary";
  copy.textContent = "复制 TSV";
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(tsv);
    copy.textContent = "已复制";
    setTimeout(() => (copy.textContent = "复制 TSV"), 1200);
  });
  const autoWrite = document.createElement("button");
  autoWrite.className = "button primary";
  autoWrite.textContent = "自动写入 Google Sheet";
  autoWrite.disabled = !webhook.configured || rows.every((row) => row.status === "skipped_duplicate");
  autoWrite.addEventListener("click", async () => {
    if (!window.confirm("确认自动写入内胆现货尺寸表吗？重复编码默认跳过。")) return;
    autoWrite.disabled = true;
    autoWrite.textContent = "正在写入…";
    try {
      await request("/api/insert/stock-sheet/write", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows })
      });
      autoWrite.textContent = "已自动写入";
      await refresh();
      await previewInsertStockSheet();
    } catch (error) {
      elements.errorBox.classList.remove("hidden");
      elements.errorBox.textContent = error.message;
      autoWrite.textContent = "自动写入 Google Sheet";
    } finally {
      autoWrite.disabled = false;
    }
  });
  const record = document.createElement("button");
  record.className = "button primary";
  record.textContent = "确认已写入并记录";
  record.addEventListener("click", async () => {
    await request("/api/insert/stock-sheet/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rows })
    });
    await refresh();
    record.textContent = "已记录";
  });
  actions.append(autoWrite, copy, record);
  elements.insertStockSheetPreview.replaceChildren(title, note, table, webhookPanel, textarea, actions);
}

async function createDataCollectionTask() {
  const saved = await operationRequest(elements.createDataTaskButton, "/api/operations/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      target_listing_id: elements.taskListingSelect.value,
      platform_sku_id: elements.taskSkuMappingSelect.value,
      period: elements.taskPeriod.value,
      review_due_at: elements.taskReviewDueAt.value,
      related_plan_id: elements.taskRelatedPlanId.value
    })
  }, {
    successText: "已创建采集任务",
    beforeRefresh: () => clearCommerceFormDirty("dataTask")
  });
}

async function savePerformanceSnapshot() {
  const saved = await operationRequest(elements.saveSnapshotButton, "/api/operations/snapshots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      task_id: elements.snapshotTaskSelect.value,
      listing_id: elements.snapshotListingSelect.value,
      platform_sku_id: elements.snapshotSkuMappingSelect.value,
      period_start: elements.snapshotPeriodStart.value,
      period_end: elements.snapshotPeriodEnd.value,
      impressions: elements.snapshotImpressions.value,
      visitors: elements.snapshotVisitors.value,
      clicks: elements.snapshotClicks.value,
      add_to_cart: elements.snapshotAddToCart.value,
      orders: elements.snapshotOrders.value,
      revenue: elements.snapshotRevenue.value,
      ad_spend: elements.snapshotAdSpend.value,
      refund_count: elements.snapshotRefundCount.value,
      bad_reviews: elements.snapshotBadReviews.value,
      search_terms: elements.snapshotSearchTerms.value,
      inventory_status: elements.snapshotInventoryStatus.value
    })
  }, {
    successText: "已保存周期快照",
    beforeRefresh: () => clearCommerceFormDirty("snapshot")
  });
}

async function createOperationAction() {
  const operator = currentOperatorContext();
  const saved = await operationRequest(elements.createActionButton, "/api/operations/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      product_id: elements.actionProductSelect.value,
      listing_id: elements.actionListingSelect.value,
      action_type: elements.actionType.value,
      reason: elements.actionReason.value,
      target_metric: elements.actionTargetMetric.value,
      observation_period: elements.actionObservationPeriod.value,
      operator: elements.actionOperator.value || operator.operator_name,
      operator_id: operator.operator_id,
      operator_name: operator.operator_name,
      created_by_operator_id: operator.operator_id,
      created_by_operator_name: operator.operator_name,
      updated_by_operator_id: operator.operator_id,
      updated_by_operator_name: operator.operator_name,
      status: elements.actionStatus.value,
      review_due_at: elements.actionReviewDueAt.value
    })
  }, {
    successText: "已创建运营动作",
    beforeRefresh: () => clearCommerceFormDirty("operationAction")
  });
}

async function updateActionReview(actionId, reviewResult, button) {
  await operationRequest(button, `/api/operations/actions/${encodeURIComponent(actionId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      review_result: reviewResult,
      status: "done"
    })
  }, {
    successText: "已保存复盘",
    beforeRefresh: () => {
      reviewDrafts.delete(actionId);
      if (!reviewDrafts.size) commerceDirtyForms.delete("review");
    }
  });
}

async function operationRequest(button, url, options, feedback = {}) {
  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "保存中…";
  }
  try {
    await request(url, options);
    feedback.beforeRefresh?.();
    await refresh();
    if (button && feedback.successText) {
      button.textContent = feedback.successText;
      window.setTimeout(() => {
        button.textContent = feedback.finalText || originalText;
      }, 1400);
    } else if (button) {
      button.textContent = originalText;
    }
    return true;
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
    if (button) button.textContent = originalText;
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}

async function queueAction(button, url) {
  button.disabled = true;
  try {
    await request(url, { method: "POST" });
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function cancelQueueTask(taskId, button) {
  button.disabled = true;
  try {
    await request(`/api/queue/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: "POST"
    });
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function abandonCurrentQueueTask() {
  const hasNext = (latestPayload?.queue?.tasks || []).some(
    (task) => task.status === "ready"
  );
  const confirmed = window.confirm(
    hasNext
      ? "确认遗弃当前商品吗？未完成结果会保存在该队列任务目录中，但不会进入已完成商品库。系统将清空当前工作区并自动开始下一个商品。"
      : "确认遗弃当前商品吗？未完成结果会保存在该队列任务目录中，但不会进入已完成商品库。系统将清空当前工作区。"
  );
  if (!confirmed) return;
  elements.queueAbandonButton.disabled = true;
  try {
    await request("/api/queue/abandon-current", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ continueQueue: true })
    });
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    elements.queueAbandonButton.disabled = false;
  }
}

function renderProfileDetail(profile, archived) {
  elements.currentProfileEmpty.classList.add("hidden");
  elements.currentProfileForm.classList.remove("hidden");
  elements.profileDetailTitle.textContent = archived
    ? "历史商品档案详情"
    : "当前商品档案";
  elements.backToCurrentProfileButton.classList.toggle("hidden", !archived);
  elements.currentProfileStatus.classList.remove("invalid");
  elements.currentProfileStatus.textContent =
    archived
      ? "已归档"
      : profile.lifecycle.status === "completed"
        ? "已完成"
        : "正常";
  const editingCurrentProfile =
    profileFormDirty && profileFormProductId === profile.productId && !archived;
  if (!editingCurrentProfile) {
    profileFormDirty = false;
    profileFormProductId = profile.productId;
    setProfileInputValue(elements.profileDisplayName, profile.identity.displayName);
    setProfileInputValue(elements.profileProductId, profile.productId);
    setProfileInputValue(
      elements.profileNextAction,
      profile.nextAction.manualOverride?.value
    );
    setProfileInputValue(elements.profileNotes, profile.notes);
  }
  elements.profileSuggestedAction.textContent = profile.nextAction.suggested;
  elements.profileWorkflowMode.textContent =
    profile.identity.workflowMode === "luxury_insert"
      ? "奢侈包内胆"
      : profile.identity.standardWorkflowGoal === "seo_content_only"
        ? "仅 SEO 与文案"
        : "完整 Listing";
  elements.profileCurrentStage.textContent = profile.lifecycle.currentStage;
  elements.profileArtifactCount.textContent = `${profile.artifacts.length} 个文件`;
  elements.profileDisplayName.readOnly = archived;
  elements.profileNextAction.readOnly = archived;
  elements.profileNotes.readOnly = archived;
  elements.saveProfileButton.classList.toggle("hidden", archived);
  elements.resetProfileActionButton.classList.toggle("hidden", archived);
  elements.profileArtifactsList.replaceChildren(
    ...profile.artifacts.map((artifact) => {
      const row = document.createElement("div");
      row.className = "profile-artifact";
      const file = document.createElement("code");
      file.textContent = artifact.path;
      file.title = artifact.path;
      const meta = document.createElement("span");
      meta.textContent = `${artifact.type} · ${formatFileSize(artifact.size)}`;
      row.append(file, meta);
      return row;
    })
  );
  elements.profileArtifactsBox.classList.toggle(
    "hidden",
    profile.artifacts.length === 0
  );
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isAbnormalProductArchive(product) {
  if (product.status !== "normal" || !product.productId) return false;
  const displayName = (product.displayName || "").trim();
  const directoryName = (product.directoryName || "").trim();
  return (
    !displayName ||
    displayName === "未命名产品" ||
    directoryName === "未命名产品" ||
    /^未命名产品-\d+$/.test(directoryName)
  );
}

async function saveCurrentProfile() {
  elements.saveProfileButton.disabled = true;
  try {
    await request("/api/product-profile/current", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: elements.profileDisplayName.value,
        notes: elements.profileNotes.value,
        manualOverride: elements.profileNextAction.value || null
      })
    });
    profileFormDirty = false;
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    elements.saveProfileButton.disabled = false;
  }
}

async function resetCurrentProfileAction() {
  elements.resetProfileActionButton.disabled = true;
  try {
    await request("/api/product-profile/current/reset-next-action", {
      method: "POST"
    });
    elements.profileNextAction.value = "";
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    elements.resetProfileActionButton.disabled = false;
  }
}

async function loadProductLibrary() {
  elements.refreshProfilesButton.disabled = true;
  try {
    const body = await request("/api/product-profiles");
    renderProductLibrary(body.products || []);
  } catch (error) {
    elements.productLibrary.innerHTML = "";
    const message = document.createElement("p");
    message.className = "profile-empty";
    message.textContent = `读取失败：${error.message}`;
    elements.productLibrary.append(message);
  } finally {
    elements.refreshProfilesButton.disabled = false;
  }
}

function renderProductLibrary(products) {
  elements.productLibrary.innerHTML = "";
  const abnormalProducts = products.filter(isAbnormalProductArchive);
  elements.productArchiveNotice?.classList.toggle("hidden", abnormalProducts.length === 0);
  if (elements.productArchiveNoticeText) {
    elements.productArchiveNoticeText.textContent = abnormalProducts.length
      ? `发现 ${abnormalProducts.length} 个异常商品档案，主要为历史创建的未命名产品。建议先人工确认后再维护，系统不会自动删除。`
      : "";
  }
  if (!products.length) {
    const empty = document.createElement("p");
    empty.className = "profile-empty";
    empty.textContent = "暂无归档商品";
    elements.productLibrary.append(empty);
    return;
  }
  products.forEach((product) => {
    const abnormal = isAbnormalProductArchive(product);
    const row = document.createElement("div");
    row.className = "product-library-row";
    if (abnormal) row.classList.add("abnormal-archive");
    if (product.status === "normal") {
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `进入商品经营档案：${product.displayName || product.directoryName}`);
      row.addEventListener("click", () => {
        void openProductHub(product.productId, { tab: "overview" });
      });
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        void openProductHub(product.productId, { tab: "overview" });
      });
    }
    const thumb = document.createElement("div");
    thumb.className = "product-library-thumb";
    if (product.thumbnailUrl) {
      const image = document.createElement("img");
      image.src = `${product.thumbnailUrl}?v=${encodeURIComponent(product.updatedAt || "")}`;
      image.alt = product.displayName || product.directoryName || "商品缩略图";
      image.loading = "lazy";
      image.addEventListener("error", () => {
        thumb.textContent = "图";
        image.remove();
      });
      thumb.append(image);
    } else {
      thumb.textContent = "图";
    }
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = product.displayName || product.directoryName;
    const details = document.createElement("small");
    details.textContent = abnormal
      ? "商品名称缺失，建议人工补全或确认删除。"
      : product.status === "invalid"
        ? product.error || "product-profile.json 无法通过校验"
        : product.status === "pending"
          ? product.directoryName
          : `${product.currentStage} · ${product.productId}`;
    info.append(title, details);
    if (abnormal) {
      const maintenance = document.createElement("small");
      maintenance.className = "archive-maintenance-hint";
      maintenance.textContent = "如需保留，请进入档案后补全商品名称。";
      info.append(maintenance);
    }
    const actions = document.createElement("div");
    actions.className = "product-library-actions";
    const status = document.createElement("span");
    status.className = `library-status ${abnormal ? "invalid" : product.status}`;
    status.textContent = abnormal ? "异常档案" : product.label;
    actions.append(status);
    if (product.status === "pending") {
      const button = document.createElement("button");
      button.className = "text-button";
      button.textContent = "预览建档";
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        void previewLegacyProduct(product.directoryName, row, button);
      });
      actions.append(button);
    } else if (product.status === "normal") {
      const button = document.createElement("button");
      button.className = "text-button";
      button.textContent = "查看档案";
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        void openArchivedProfile(product.productId, button);
      });
      actions.append(button);
      const deleteButton = document.createElement("button");
      deleteButton.className = "text-button danger";
      deleteButton.textContent = "删除";
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void deleteArchivedProfile(product, deleteButton);
      });
      actions.append(deleteButton);
    }
    row.append(thumb, info, actions);
    elements.productLibrary.append(row);
  });
}

async function previewLegacyProduct(directoryName, row, button) {
  button.disabled = true;
  try {
    const body = await request("/api/product-profiles/legacy-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directoryName })
    });
    row.querySelector(".legacy-preview")?.remove();
    const preview = document.createElement("div");
    preview.className = "legacy-preview";
    const heading = document.createElement("strong");
    heading.textContent = body.preview.displayName;
    const summary = document.createElement("div");
    summary.textContent = `模式：${
      body.preview.workflowMode === "luxury_insert" ? "奢侈包内胆" : "标准 Listing"
    } · 文件：${body.preview.artifacts.length} 个`;
    const filePreview = document.createElement("div");
    const names = body.preview.artifacts
      .slice(0, 6)
      .map((artifact) => artifact.path)
      .join("、");
    filePreview.textContent = names
      ? `包含：${names}${body.preview.artifacts.length > 6 ? " 等" : ""}`
      : "该归档目录中暂未识别到交付文件";
    const confirmButton = document.createElement("button");
    confirmButton.className = "button secondary";
    confirmButton.textContent = "确认创建档案";
    confirmButton.addEventListener("click", () => {
      void createLegacyProduct(directoryName, confirmButton);
    });
    preview.append(heading, summary, filePreview, confirmButton);
    row.append(preview);
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function createLegacyProduct(directoryName, button) {
  button.disabled = true;
  try {
    const body = await request("/api/product-profiles/legacy-create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ directoryName })
    });
    selectedArchivedProfile = body.profile;
    renderProfileDetail(body.profile, true);
    await loadProductLibrary();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function openArchivedProfile(productId, button) {
  button.disabled = true;
  try {
    const body = await request(
      `/api/product-profiles/${encodeURIComponent(productId)}`
    );
    selectedArchivedProfile = {
      ...body.profile,
      thumbnailUrl: body.thumbnailUrl
    };
    renderProfileDetail(selectedArchivedProfile, true);
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function deleteArchivedProfile(product, button) {
  const name = product.displayName || product.directoryName || product.productId;
  const abnormal = isAbnormalProductArchive(product);
  const confirmed = window.confirm(
    abnormal
      ? `确认删除该异常商品档案「${name}」吗？\n\n此操作只应在确认该商品没有有效业务数据后执行。`
      : `确认删除归档商品「${name}」吗？\n\n此操作会删除该商品的归档目录，适合处理确认不上架的产品，删除后无法撤销。`
  );
  if (!confirmed) return;
  button.disabled = true;
  try {
    await request(`/api/product-profiles/${encodeURIComponent(product.productId)}`, {
      method: "DELETE"
    });
    if (selectedArchivedProfile?.productId === product.productId) {
      selectedArchivedProfile = undefined;
      await loadCurrentProfile();
    }
    await loadProductLibrary();
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function renderMarketRadarCandidates(insert, busy, bagImages = []) {
  const candidates = insert.marketRadarCandidates || [];
  elements.insertMarketRadarMeta.classList.toggle(
    "hidden",
    !insert.marketRadarText && candidates.length === 0
  );
  const updatedAt = insert.marketRadarUpdatedAt
    ? new Date(insert.marketRadarUpdatedAt).toLocaleString()
    : "未生成";
  const warning = insert.marketRadarSelectionWarning
    ? `｜${insert.marketRadarSelectionWarning}`
    : "";
  elements.insertMarketRadarMeta.textContent =
    `候选 ${candidates.length} 个｜更新时间 ${updatedAt}${warning}`;

  elements.insertMarketRadarCandidates.classList.toggle(
    "hidden",
    candidates.length === 0
  );
  if (!candidates.length) {
    elements.insertMarketRadarCandidates.replaceChildren();
    return;
  }
  const tiers = ["P0", "P1", "P2", "Reject"];
  elements.insertMarketRadarCandidates.replaceChildren(
    ...tiers
      .map((tier) => {
        const group = candidates.filter((candidate) => candidate.poolTier === tier);
        if (!group.length) return undefined;
        const section = document.createElement("section");
        section.className = "radar-tier";
        const heading = document.createElement("h4");
        heading.textContent = `${tier}｜${group.length} 个`;
        section.append(heading);
        const grid = document.createElement("div");
        grid.className = "radar-grid";
        grid.append(
          ...group.map((candidate) =>
            createMarketRadarCandidateCard(
              candidate,
              insert.selectedMarketRadarCandidateId,
              busy,
              bagImages
            )
          )
        );
        section.append(grid);
        return section;
      })
      .filter(Boolean)
  );
}

function createMarketRadarCandidateCard(candidate, selectedId, busy, bagImages = []) {
  const card = document.createElement("article");
  card.className = "radar-card-item";
  const isSelected = candidate.candidateId === selectedId;
  const selectedWithoutBagImage = isSelected && bagImages.length === 0;
  if (isSelected) card.classList.add("selected");
  const media = document.createElement("div");
  media.className = "radar-card-media";
  if (looksLikeImageUrl(candidate.officialFrontImageUrl)) {
    const image = document.createElement("img");
    image.src = `/api/insert/market-radar/preview-image?url=${encodeURIComponent(candidate.officialFrontImageUrl)}`;
    image.alt = `${candidate.bagModel} official front`;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      const placeholder = document.createElement("div");
      placeholder.className = "radar-card-placeholder";
      placeholder.textContent = "图片直链无法预览，请打开来源或人工上传";
      media.replaceChildren(placeholder);
    });
    media.append(image);
  } else if (isHttpUrl(candidate.officialFrontImageUrl)) {
    const placeholder = document.createElement("div");
    placeholder.className = "radar-card-placeholder";
    placeholder.innerHTML = "<strong>回传的是产品页</strong><span>不是图片直链，请打开产品页取图</span>";
    media.append(placeholder);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "radar-card-placeholder";
    placeholder.textContent = "需要人工上传外包图";
    media.append(placeholder);
  }
  const titleRow = document.createElement("div");
  titleRow.className = "radar-card-title-row";
  const title = document.createElement("h5");
  title.textContent = `${candidate.rank}. ${candidate.bagModel}${
    candidate.sizeVersion ? ` ${candidate.sizeVersion}` : ""
  }`;
  const copyNameBtn = document.createElement("button");
  copyNameBtn.type = "button";
  copyNameBtn.className = "radar-copy-name";
  copyNameBtn.title = "复制品牌包型名称";
  copyNameBtn.textContent = "复制名称";
  copyNameBtn.addEventListener("click", async (event) => {
    event.stopPropagation();
    const fullName = [
      candidate.brand || "",
      candidate.bagModel || "",
      candidate.sizeVersion || ""
    ].filter(Boolean).join(" ");
    const ok = await copyTextToClipboard(fullName);
    copyNameBtn.textContent = ok ? "已复制" : "复制失败";
    setTimeout(() => (copyNameBtn.textContent = "复制名称"), 1400);
  });
  titleRow.append(title, copyNameBtn);
  const chips = document.createElement("div");
  chips.className = "radar-chips";
  for (const value of [
    candidate.evidenceLevel,
    candidate.nativeOrganizationLevel,
    candidate.organizerPotential,
    candidate.inventoryReusePotential
  ].filter(Boolean)) {
    const chip = document.createElement("span");
    chip.textContent = value;
    chips.append(chip);
  }
  const details = document.createElement("dl");
  details.className = "radar-details";
  const rows = [
    ["Pain Gap", candidate.painGap],
    ["Value", (candidate.insertValueType || []).join(", ")],
    ["Safe Angle", candidate.listingSafeAngle],
    ["Next", candidate.nextStep]
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value || "未提供";
    details.append(dt, dd);
  }
  const links = document.createElement("div");
  links.className = "radar-links";
  const frontImage = candidate.officialFrontImageUrl || "";
  const frontIsImage = looksLikeImageUrl(frontImage);
  if (frontIsImage) {
    links.append(createRadarLink("查看图片 URL", frontImage, true));
  }
  if (isHttpUrl(candidate.officialProductUrl)) {
    links.append(createRadarLink("打开产品页", candidate.officialProductUrl, true));
  }
  else if (isHttpUrl(frontImage) && !frontIsImage) {
    links.append(createRadarLink("查看回传来源", frontImage, true));
  }
  else {
    links.append(createRadarLink("打开产品页", "", false));
  }
  const button = document.createElement("button");
  button.className = "button secondary";
  button.textContent =
    selectedWithoutBagImage
      ? "重新导入包型图片"
      : isSelected
        ? "已确认开发此包型"
        : "确认开发此包型";
  button.disabled = busy || (isSelected && !selectedWithoutBagImage);
  button.addEventListener("click", () => {
    void selectMarketRadarCandidate(candidate.candidateId, button);
  });
  card.append(media, titleRow, chips, details, links, button);
  return card;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function looksLikeImageUrl(value) {
  return /\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(String(value || "").trim());
}

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  }
  catch { /* 回退到 execCommand */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
  catch {
    return false;
  }
}

function isMarketRadarPrefill(insert) {
  return /^#\s*市场雷达预填包型/m.test(insert?.identificationText || "");
}

function createRadarLink(label, url, enabled) {
  const link = document.createElement("a");
  link.className = enabled ? "radar-link" : "radar-link disabled";
  link.textContent = enabled ? label : `${label}：未提供`;
  if (enabled) {
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer";
  }
  return link;
}

/* ── 每日市场选款设计（selection-radar 视图独立渲染） ── */

function renderSelectionRadar(state, busy) {
  const insert = state.luxuryInsert || {};
  const candidates = insert.marketRadarCandidates || [];
  const hasCandidates = candidates.length > 0;
  const hasResult = Boolean(insert.marketRadarText);
  const selectedId = insert.selectedMarketRadarCandidateId;
  const hasSelection = Boolean(selectedId);

  /* ── 结果文本（renderMarketRadarCandidates 不覆盖此项） ── */
  if (elements.insertMarketRadarBox) {
    elements.insertMarketRadarBox.classList.toggle("hidden", !hasResult);
  }
  if (elements.insertMarketRadarText) {
    elements.insertMarketRadarText.textContent = insert.marketRadarText || "";
  }

  /* ── 候选列表 + Meta 信息条（由 renderMarketRadarCandidates 统一渲染） ── */
  try {
    renderMarketRadarCandidates(insert, busy, []);
  } catch (e) {
    console.error("[selection-radar] renderMarketRadarCandidates 出错:", e);
  }

  /* ── 运行状态提示 ── */
  const statusEl = document.getElementById("selectionRadarStatus");
  if (statusEl) {
    statusEl.classList.toggle("hidden", !busy);
    statusEl.textContent = busy ? "雷达运行中…" : "";
  }

  /* ── 导入 Listing 面板 ── */
  const importPanel = document.getElementById("selectionRadarImportPanel");
  const importBtn = document.getElementById("selectionImportToListingButton");
  const gotoLink = document.getElementById("selectionGotoInsertWorkspaceLink");
  if (!importPanel || !importBtn) return;

  importPanel.classList.toggle("hidden", !hasCandidates);

  if (hasCandidates && hasSelection) {
    /* 已有选中候选 → 显示"前往工作台"链接 */
    importBtn.classList.add("hidden");
    gotoLink.classList.remove("hidden");
    const selectedCandidate = candidates.find((c) => c.candidateId === selectedId);
    const summary = document.getElementById("selectionRadarImportSummary");
    if (summary && selectedCandidate) {
      summary.classList.remove("hidden");
      summary.innerHTML = `<strong>已选候选：</strong>${escapeHtml(selectedCandidate.bagModel || selectedCandidate.candidateId)}（${escapeHtml(selectedCandidate.poolTier || "")}）`;
    }
  } else if (hasCandidates) {
    /* 有候选但未选 → 显示"选中并启动"按钮 */
    importBtn.classList.remove("hidden");
    importBtn.disabled = false;
    importBtn.textContent = "选择一个候选后一键导入 Listing";
    gotoLink.classList.add("hidden");
    const summary = document.getElementById("selectionRadarImportSummary");
    if (summary) summary.classList.add("hidden");
  } else {
    importBtn.classList.add("hidden");
    gotoLink.classList.add("hidden");
  }

  /* 绑定跳转事件（幂等绑定） */
  if (gotoLink && !gotoLink.dataset.bound) {
    gotoLink.dataset.bound = "1";
    gotoLink.addEventListener("click", (e) => {
      e.preventDefault();
      showInsertEditor();
    });
  }
  if (importBtn && !importBtn.dataset.bound) {
    importBtn.dataset.bound = "1";
    importBtn.addEventListener("click", () => {
      if (!selectedId) {
        alert("请先从上方候选列表中选择一个包型候选。");
        return;
      }
      void importSelectedCandidateToListing(selectedId, importBtn);
    });
  }
}

/* ── 标品选品（Bob 选品研究 v0.1）独立渲染 ── */
function renderProductSelection(state, busy) {
  const sel = state.selection || {};
  const candidates = Array.isArray(sel.candidates) ? sel.candidates : [];
  const text = sel.text || "";
  const hasCandidates = candidates.length > 0;
  const hasResult = Boolean(text);
  const decided = sel.decided || {};
  const running = Boolean(sel.running);
  const evidenceRefs = Array.isArray(sel.evidenceRefs) ? sel.evidenceRefs : [];

  /* 结果文本 */
  const box = document.getElementById("productSelectionBox");
  const textEl = document.getElementById("productSelectionText");
  if (box) box.classList.toggle("hidden", !hasResult);
  if (textEl) textEl.textContent = text;

  /* Meta 信息条 */
  const meta = document.getElementById("productSelectionMeta");
  if (meta) {
    meta.classList.toggle("hidden", !hasResult && !hasCandidates);
    if (hasCandidates || hasResult) {
      const updatedAt = sel.updatedAt ? new Date(sel.updatedAt).toLocaleString() : "未生成";
      meta.textContent = `候选 ${candidates.length} 个｜更新时间 ${updatedAt}`;
    }
  }

  /* 候选列表 */
  const container = document.getElementById("productSelectionCandidates");
  if (container) {
    container.classList.toggle("hidden", !hasCandidates);
    if (!hasCandidates) {
      container.replaceChildren();
    } else {
      container.replaceChildren(
        ...candidates.map((candidate) => createProductSelectionCandidateCard(candidate, decided[candidate.candidate_id], running, evidenceRefs))
      );
    }
  }

  /* 运行状态提示 */
  const statusEl = document.getElementById("productSelectionStatus");
  if (statusEl) {
    if (running) {
      statusEl.classList.remove("hidden");
      statusEl.style.color = "var(--blue, #0071e3)";
      statusEl.textContent = "Bob 选品研究中…";
    } else if (sel.error) {
      statusEl.classList.remove("hidden");
      statusEl.style.color = "var(--red, #d00)";
      statusEl.textContent = `❌ ${sel.error}`;
    } else if (hasCandidates) {
      statusEl.classList.remove("hidden");
      statusEl.style.color = "var(--green, #0a0)";
      statusEl.textContent = "✅ 选品研究完成，可逐条采纳";
    } else {
      statusEl.classList.add("hidden");
    }
  }
}

function createProductSelectionCandidateCard(candidate, decided, running, evidenceRefs = []) {
  const card = document.createElement("article");
  card.className = "radar-card-item";
  const candidateId = candidate.candidate_id || "";
  const title = candidate.recommended_product_name || candidate.generic_product_name || candidateId;
  const opportunity = candidate.one_line_opportunity || "";
  const status = candidate.bob_recommendation_status || "";
  const totalScore = (candidate.scoring && typeof candidate.scoring.total_score === "number") ? candidate.scoring.total_score : null;
  const category = candidate.category || "";
  const imageUrl = candidate.image_url || "";
  const referenceLinks = Array.isArray(candidate.reference_product_links) ? candidate.reference_product_links : [];

  /* 左侧媒体区：产品图预览（图片直链或产品页都交给后端解析主图） */
  const media = document.createElement("div");
  media.className = "radar-card-media";
  if (isHttpUrl(imageUrl)) {
    const image = document.createElement("img");
    image.src = `/api/selection/preview-image?url=${encodeURIComponent(imageUrl)}`;
    image.alt = title;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => {
      const placeholder = document.createElement("div");
      placeholder.className = "radar-card-placeholder";
      placeholder.innerHTML = looksLikeImageUrl(imageUrl)
        ? "<strong>图片直链无法预览</strong><span>请打开来源或人工上传</span>"
        : "<strong>未能从产品页解析出主图</strong><span>请点开右侧参考链接取图</span>";
      media.replaceChildren(placeholder);
    });
    media.append(image);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "radar-card-placeholder";
    placeholder.textContent = "无产品图，请人工补充";
    media.append(placeholder);
  }

  const titleRow = document.createElement("div");
  titleRow.className = "radar-card-title-row";
  const h = document.createElement("h5");
  h.textContent = title;
  titleRow.append(h);

  const sub = document.createElement("p");
  sub.className = "radar-card-opportunity";
  sub.textContent = opportunity || category || "（无一句话机会描述）";

  const chips = document.createElement("div");
  chips.className = "radar-chips";
  const chipValues = [status, totalScore !== null ? `Score ${totalScore}` : null, category]
    .filter(Boolean);
  for (const value of chipValues) {
    const chip = document.createElement("span");
    chip.textContent = value;
    chips.append(chip);
  }

  const details = document.createElement("dl");
  details.className = "radar-details";
  const rows = [
    ["目标客户", (candidate.target_customer || []).join("、")],
    ["客户问题", (candidate.customer_problem || []).slice(0, 3).join("；")],
    ["使用场景", (candidate.use_scenarios || []).join("、")]
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value || "未提供";
    details.append(dt, dd);
  }

  /* 参考产品链接 */
  const links = document.createElement("div");
  links.className = "radar-links";
  if (referenceLinks.length) {
    referenceLinks.slice(0, 3).forEach((url, index) => {
      if (isHttpUrl(url)) {
        links.append(createRadarLink(`参考链接 ${index + 1}`, url, true));
      }
    });
  } else {
    links.append(createRadarLink("参考产品链接", "", false));
  }

  /* 采纳动作区 */
  const actions = document.createElement("div");
  actions.className = "row-actions";
  const decisions = [
    ["approved_for_development_pool", "采纳进开发池"],
    ["observe_pool", "观察"],
    ["rejected", "拒绝"],
    ["manual_review", "人工复核"],
    ["blocked_by_risk", "风险拦截"]
  ];
  for (const [decision, label] of decisions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "button secondary";
    btn.textContent = label;
    btn.disabled = Boolean(running) || Boolean(decided);
    if (decided === decision) {
      btn.classList.add("selected");
      btn.textContent = `${label} ✓`;
    }
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      await adoptProductSelectionCandidate(candidateId, decision);
    });
    actions.append(btn);
  }

  card.append(media, titleRow, sub, chips, details, links, actions);

  /* ── 新增：可折叠深度分析详情区 ── */
  const detailPanel = createSelectionDetailPanel(candidate, evidenceRefs);
  card.append(detailPanel);

  if (decided && !decisions.some(([d]) => d === decided)) {
    const note = document.createElement("p");
    note.className = "radar-card-opportunity";
    note.textContent = `已决策：${decided}`;
    card.append(note);
  }
  return card;
}

/* 创建标品选品候选卡片的深度分析详情区 */
/* 跨重渲染保持展开状态：app 每 1s 调一次 refresh() 会重建卡片 DOM，
   用模块级 Set 记录哪些候选面板是展开的，重建时按状态重新加 is-open，避免「点开又自动收回去」。 */
const openSelectionDetailIds = new Set();

function createSelectionDetailPanel(candidate, evidenceRefs = []) {
  const panel = document.createElement("div");
  panel.className = "selection-detail-panel";
  const candidateId = candidate.candidate_id || "";

  /* 使用自定义按钮 + CSS 折叠，避免不同浏览器/嵌入环境对 <details> 的默认行为差异导致点不开 */
  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "selection-detail-summary";
  summary.textContent = "查看深度分析 / 客户反馈 / 来源";
  summary.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = panel.classList.toggle("is-open");
    if (candidateId) openSelectionDetailIds[open ? "add" : "delete"](candidateId);
  });
  panel.append(summary);

  /* 若该候选面板此前处于展开态，重建后自动恢复（新 DOM 一出生即打开，不闪烁） */
  if (candidateId && openSelectionDetailIds.has(candidateId)) {
    panel.classList.add("is-open");
  }

  const body = document.createElement("div");
  body.className = "selection-detail-body";

  const demand = candidate.demand_assessment || {};
  const competition = candidate.competition_assessment || {};
  const scoring = candidate.scoring || {};
  const recommendation = candidate.recommendation || {};

  /* 1. 客户真实反馈 */
  const feedbackItems = Array.isArray(demand.customer_feedback_items) ? demand.customer_feedback_items : [];
  const reviewSignals = Array.isArray(demand.review_problem_signals) ? demand.review_problem_signals : [];
  if (feedbackItems.length || reviewSignals.length) {
    const section = createSelectionDetailSection("客户真实反馈");
    if (feedbackItems.length) {
      feedbackItems.forEach((item) => {
        const row = document.createElement("div");
        row.className = "selection-detail-feedback";
        const quote = document.createElement("p");
        quote.textContent = item.quote_or_summary || item.summary || "（无反馈内容）";
        const meta = document.createElement("div");
        meta.className = "selection-detail-feedback-meta";
        const badges = [item.source_platform, item.sentiment]
          .filter(Boolean)
          .map((text) => {
            const badge = document.createElement("span");
            badge.className = "selection-sentiment-badge";
            badge.textContent = text;
            return badge;
          });
        meta.append(...badges);
        if (isHttpUrl(item.source_url)) {
          meta.append(createSelectionSourceLink("来源", item.source_url));
        }
        if (item.related_problem) {
          const problem = document.createElement("span");
          problem.className = "selection-feedback-problem";
          problem.textContent = `对应问题：${item.related_problem}`;
          meta.append(problem);
        }
        row.append(quote, meta);
        section.append(row);
      });
    } else {
      reviewSignals.forEach((signal) => {
        section.append(createSelectionDetailItem(signal));
      });
    }
    body.append(section);
  }

  /* 2. 需求信号 */
  const needSignals = Array.isArray(demand.direct_need_signals) ? demand.direct_need_signals : [];
  const intentSignals = Array.isArray(demand.purchase_intent_signals) ? demand.purchase_intent_signals : [];
  if (needSignals.length || intentSignals.length) {
    const section = createSelectionDetailSection("需求信号");
    if (needSignals.length) {
      const sub = createSelectionDetailSubsection("直接需求信号");
      needSignals.forEach((s) => sub.append(createSelectionDetailItem(s)));
      section.append(sub);
    }
    if (intentSignals.length) {
      const sub = createSelectionDetailSubsection("购买意图信号");
      intentSignals.forEach((s) => sub.append(createSelectionDetailItem(s)));
      section.append(sub);
    }
    body.append(section);
  }

  /* 3. 市场深度观点与缺口 */
  const marketGaps = Array.isArray(competition.market_gaps) ? competition.market_gaps : [];
  if (competition.market_depth_viewpoint || marketGaps.length || competition.listing_density) {
    const section = createSelectionDetailSection("市场深度解剖");
    if (competition.market_depth_viewpoint) {
      section.append(createSelectionDetailItem(competition.market_depth_viewpoint, "观点"));
    }
    if (competition.listing_density) {
      section.append(createSelectionDetailItem(competition.listing_density, "listing 密度"));
    }
    if (marketGaps.length) {
      const sub = createSelectionDetailSubsection("市场缺口");
      marketGaps.forEach((gap) => sub.append(createSelectionDetailItem(gap)));
      section.append(sub);
    }
    body.append(section);
  }

  /* 4. 竞品痛点与缺失功能 */
  const competitors = Array.isArray(candidate.competitor_set) ? candidate.competitor_set : [];
  const allComplaints = competitors.flatMap((c) => Array.isArray(c.repeated_complaints) ? c.repeated_complaints : []);
  const allMissing = competitors.flatMap((c) => Array.isArray(c.missing_features) ? c.missing_features : []);
  if (allComplaints.length || allMissing.length) {
    const section = createSelectionDetailSection("竞品痛点与缺失");
    if (allComplaints.length) {
      const sub = createSelectionDetailSubsection("反复出现的差评");
      [...new Set(allComplaints)].forEach((item) => sub.append(createSelectionDetailItem(item)));
      section.append(sub);
    }
    if (allMissing.length) {
      const sub = createSelectionDetailSubsection("用户期望但缺失的功能");
      [...new Set(allMissing)].forEach((item) => sub.append(createSelectionDetailItem(item)));
      section.append(sub);
    }
    body.append(section);
  }

  /* 5. 差异化机会 */
  const diffs = Array.isArray(candidate.differentiation_opportunities) ? candidate.differentiation_opportunities : [];
  if (diffs.length) {
    const section = createSelectionDetailSection("差异化机会");
    diffs.forEach((diff) => {
      const row = document.createElement("div");
      row.className = "selection-diff-row";
      const title = document.createElement("strong");
      title.textContent = diff.opportunity || "差异化机会";
      row.append(title);
      if (diff.customer_value) {
        row.append(createSelectionDetailItem(diff.customer_value, "客户价值"));
      }
      if (Array.isArray(diff.evidence_basis) && diff.evidence_basis.length) {
        row.append(createSelectionDetailItem(diff.evidence_basis.join("、"), "证据依据"));
      }
      if (diff.risk) {
        row.append(createSelectionDetailItem(diff.risk, "风险"));
      }
      section.append(row);
    });
    body.append(section);
  }

  /* 6. 评分理由 */
  const scoreReasoning = Array.isArray(scoring.score_reasoning) ? scoring.score_reasoning : [];
  if (scoreReasoning.length) {
    const section = createSelectionDetailSection("评分理由");
    scoreReasoning.forEach((reason) => section.append(createSelectionDetailItem(reason)));
    body.append(section);
  }

  /* 7. 推荐/观察理由 */
  const recReasons = Array.isArray(recommendation.recommendation_reason) ? recommendation.recommendation_reason : [];
  const observeReasons = Array.isArray(recommendation.observe_reason) ? [recommendation.observe_reason] : [];
  if (recReasons.length || observeReasons.length || recommendation.next_gate) {
    const section = createSelectionDetailSection("推荐与下一步");
    recReasons.forEach((reason) => section.append(createSelectionDetailItem(reason, "推荐理由")));
    observeReasons.forEach((reason) => section.append(createSelectionDetailItem(reason, "观察理由")));
    if (recommendation.next_gate) {
      section.append(createSelectionDetailItem(recommendation.next_gate, "下一验证 Gate"));
    }
    body.append(section);
  }

  /* 8. 证据来源链接 */
  const candidateRefIds = Array.isArray(candidate.evidence_ref_ids) ? candidate.evidence_ref_ids : [];
  const relevantRefs = evidenceRefs.filter((ref) => {
    if (!ref) return false;
    if (candidateRefIds.length && ref.evidence_ref_id && candidateRefIds.includes(ref.evidence_ref_id)) return true;
    return false;
  });
  if (relevantRefs.length) {
    const section = createSelectionDetailSection("证据来源");
    relevantRefs.forEach((ref) => {
      const row = document.createElement("div");
      row.className = "selection-source-row";
      const title = document.createElement("span");
      title.className = "selection-source-title";
      title.textContent = `[${ref.evidence_ref_id}] ${ref.source_title || "未命名来源"}`;
      const platform = document.createElement("span");
      platform.className = "selection-source-platform";
      platform.textContent = ref.platform || ref.source_role || "";
      row.append(title, platform);
      if (isHttpUrl(ref.source_url)) {
        row.append(createSelectionSourceLink("访问来源", ref.source_url));
      }
      section.append(row);
    });
    body.append(section);
  }

  panel.append(body);
  return panel;
}

function createSelectionDetailSection(title) {
  const section = document.createElement("div");
  section.className = "selection-detail-section";
  const h = document.createElement("h6");
  h.textContent = title;
  section.append(h);
  return section;
}

function createSelectionDetailSubsection(title) {
  const sub = document.createElement("div");
  sub.className = "selection-detail-subsection";
  const h = document.createElement("strong");
  h.textContent = title;
  sub.append(h);
  return sub;
}

function createSelectionDetailItem(text, label) {
  const item = document.createElement("p");
  item.className = "selection-detail-item";
  item.textContent = label ? `${label}：${text}` : text;
  return item;
}

function createSelectionSourceLink(label, url) {
  const link = document.createElement("a");
  link.className = "selection-source-link";
  link.textContent = label;
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  return link;
}

async function adoptProductSelectionCandidate(candidateId, decision) {
  try {
    await request("/api/selection/adopt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateId, decision })
    });
    await refresh();
  } catch (error) {
    const errorBox = document.querySelector("#errorBox");
    if (errorBox) {
      errorBox.classList.remove("hidden");
      errorBox.textContent = error.message;
    }
  }
}

async function importSelectedCandidateToListing(candidateId, button) {
  button.disabled = true;
  button.textContent = "正在导入…";
  try {
    await request("/api/insert/market-radar/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateId })
    });
    await refreshTwice();
    /* 导入成功后自动跳转到内胆 Listing 工作台 */
    showInsertEditor();
  } catch (error) {
    const errorBox = document.querySelector("#errorBox");
    if (errorBox) {
      errorBox.classList.remove("hidden");
      errorBox.textContent = error.message;
    }
  } finally {
    button.disabled = false;
    button.textContent = "选择一个候选后一键导入 Listing";
  }
}

function renderInsertWorkflow(
  state,
  bagImages,
  linerImages,
  outputFiles,
  busy
) {
  const insert = state.luxuryInsert || {};
  const variants = insert.variants || [];
  const marketRadarPrefill = isMarketRadarPrefill(insert);
  const hasRealIdentification =
    Boolean(insert.identificationText) && !marketRadarPrefill;
  const needsBagImageAfterMarketSelection =
    Boolean(insert.selectedMarketRadarCandidateId) &&
    bagImages.length === 0 &&
    !hasRealIdentification;
  elements.insertTaskId.textContent = insert.taskId || "待创建";
  const hasInsertTask = Boolean(insert.taskId);
  const canReturnToMarketRadar =
    Boolean(insert.selectedMarketRadarCandidateId) &&
    Boolean((insert.marketRadarCandidates || []).length) &&
    state.stage !== "COMPLETED";
  elements.returnMarketRadarButton.classList.toggle(
    "hidden",
    !canReturnToMarketRadar
  );
  elements.returnMarketRadarButton.disabled = busy;
  elements.insertPauseTaskButton.classList.toggle(
    "hidden",
    !hasInsertTask || !busy
  );
  elements.insertPauseTaskButton.disabled =
    !busy || Boolean(state.pauseRequested);
  elements.insertPauseTaskButton.textContent = state.pauseRequested
    ? "正在安全暂停…"
    : "暂停当前任务";
  elements.insertAbandonTaskButton.classList.toggle(
    "hidden",
    !hasInsertTask || busy || state.stage === "COMPLETED"
  );
  elements.insertAbandonTaskButton.disabled =
    !hasInsertTask || busy || state.stage === "COMPLETED";
  elements.insertIdentificationBox.classList.toggle(
    "hidden",
    !hasRealIdentification
  );
  elements.insertIdentificationText.textContent = hasRealIdentification
    ? insert.identificationText || ""
    : "";
  elements.notebookResultBox.classList.toggle("hidden", !insert.notebookResultText);
  elements.notebookResultText.textContent = insert.notebookResultText || "";
  /* 注意：雷达渲染（marketRadarBox / marketRadarText / marketRadarCandidates）
     已迁移至 renderSelectionRadar()，不再在此处重复渲染。
     returnMarketRadarButton 保留——用户可从 Listing 工作台返回选款池。 */
  if (insert.brand && !elements.insertBrand.matches(":focus")) {
    elements.insertBrand.value = insert.brand;
  }
  if (insert.bagFamily && !elements.insertBagFamily.matches(":focus")) {
    elements.insertBagFamily.value = insert.bagFamily;
  }

  elements.insertBagGallery.replaceChildren(
    ...bagImages.map((image) =>
      imageCard(image, !insert.bagFactsConfirmed && !busy, async () => {
        await request(`/api/insert/bag-images/${encodeURIComponent(image.name)}`, {
          method: "DELETE"
        });
        await refresh();
      })
    )
  );

  const bagSignature = JSON.stringify({
    variants,
    confirmed: insert.bagFactsConfirmed
  });
  if (lastBagVariantSignature !== bagSignature) {
    lastBagVariantSignature = bagSignature;
    elements.bagVariantRows.replaceChildren();
    const source = variants.length
      ? variants
      : [{
          id: "SKU-1",
          label: "Medium",
          bagDimensions: { length: "", width: "", height: "" }
        }];
    source.forEach((variant) =>
      elements.bagVariantRows.append(createBagVariantRow(variant, insert.primaryVariantId))
    );
  }

  const designSignature = JSON.stringify({
    variants,
    frozen: insert.designFrozen
  });
  if (lastDesignVariantSignature !== designSignature) {
    lastDesignVariantSignature = designSignature;
    elements.designVariantRows.replaceChildren(
      ...variants.map((variant) => createDesignVariantRow(variant))
    );
    elements.claimInputs.forEach((input) => {
      input.checked = Boolean(insert.claims?.[input.dataset.claim]);
    });
  }

  const linerUploadSignature = JSON.stringify({
    variants: variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      linerImageName: variant.linerImageName
    })),
    images: linerImages.map((image) => image.name),
    busy
  });
  if (lastLinerUploadSignature !== linerUploadSignature) {
    lastLinerUploadSignature = linerUploadSignature;
    elements.linerUploadGrid.replaceChildren(
      ...variants.map((variant) =>
        createLinerUploadCard(variant, linerImages, busy)
      )
    );
  }

  const generated = new Set(insert.generatedImageNumbers || []);
  elements.insertGenerationSteps.replaceChildren(
    ...Array.from({ length: 7 }, (_, index) => {
      const number = index + 1;
      const step = document.createElement("span");
      step.className = "generation-step";
      if (generated.has(number)) step.classList.add("done");
      if (busy && insert.currentImageNumber === number) step.classList.add("active");
      step.textContent = generated.has(number) ? `Image ${number} ✓` : `Image ${number}`;
      return step;
    })
  );
  elements.insertOutputGallery.replaceChildren(
    ...outputFiles.map((file) => {
      const link = document.createElement("a");
      link.className = "output-card";
      link.href = file.url;
      link.target = "_blank";
      const image = document.createElement("img");
      image.src = file.url;
      image.alt = file.name;
      const label = document.createElement("span");
      label.textContent = file.name;
      link.append(image, label);
      return link;
    })
  );
  elements.insertListingContentBox.classList.toggle(
    "hidden",
    !insert.listingContentText
  );
  elements.insertListingContentText.textContent = insert.listingContentText || "";

  elements.insertBagInput.disabled = busy || Boolean(insert.bagFactsConfirmed);
  elements.runInsertMarketRadarButton.disabled = busy;
  elements.importCurrentChatMarketRadarButton.disabled = busy;
  elements.runInsertMarketRadarButton.textContent =
    busy && state.stage === "INSERT_MARKET_RADAR"
      ? "正在全网搜索包型机会…"
      : insert.marketRadarText
        ? "重新执行每日市场选款雷达"
        : "执行每日市场选款雷达";
  elements.resetInsertMarketRadarButton.disabled =
    busy ||
    !insert.marketRadarText ||
    Boolean(insert.selectedMarketRadarCandidateId) ||
    Boolean(insert.bagFactsConfirmed) ||
    Boolean(insert.designFrozen) ||
    Boolean(insert.promptPackValid) ||
    Boolean((insert.generatedImageNumbers || []).length);
  elements.insertBagUrls.disabled = busy || Boolean(insert.bagFactsConfirmed);
  if (needsBagImageAfterMarketSelection && !elements.insertBagUrls.matches(":focus")) {
    elements.insertBagUrlHint.textContent =
      "当前候选未能自动导入目标外包图，请上传图片、截图或图片直链后再识别。";
  } else if (!elements.insertBagUrls.matches(":focus")) {
    elements.insertBagUrlHint.textContent = "每行一个公开图片直链，最多 12 条。";
  }
  elements.importInsertBagUrlsButton.disabled =
    busy || Boolean(insert.bagFactsConfirmed);
  elements.insertIdentifyButton.disabled =
    busy ||
    bagImages.length === 0 ||
    Boolean(insert.bagFactsConfirmed) ||
    (hasRealIdentification && variants.length > 0);
  elements.insertIdentifyButton.textContent =
    needsBagImageAfterMarketSelection
      ? "请先上传目标外包图"
      : hasRealIdentification && variants.length === 0
      ? "重新识别并自动回填"
      : variants.length > 0
        ? "包型与尺寸已自动识别"
        : "识别包型并联网核对尺寸";
  elements.confirmBagButton.disabled =
    busy ||
    !hasRealIdentification ||
    !variants.length ||
    Boolean(insert.bagFactsConfirmed);
  elements.addBagVariantButton.disabled = busy || Boolean(insert.bagFactsConfirmed);
  elements.unlockBagButton.classList.toggle(
    "hidden",
    !insert.bagFactsConfirmed
  );
  elements.unlockBagButton.disabled = busy;
  elements.runNotebookButton.disabled =
    busy ||
    !insert.bagFactsConfirmed ||
    (Boolean(insert.notebookResultText) &&
      variants.every((variant) => variant.insertDimensions));
  const allVariantsFilled = insert.notebookResultText &&
    variants.length > 0 &&
    variants.every((variant) => variant.insertDimensions);
  elements.runNotebookButton.textContent = allVariantsFilled
    ? "内胆方案已自动回填"
    : insert.notebookResultText
      ? "重新规划并自动回填（会重发 prompt）"
      : "使用 NotebookLM 规划内胆";
  // Show re-extract button when result text exists but variants are not yet filled
  const needsReExtract = insert.notebookResultText && !allVariantsFilled;
  elements.reExtractNotebookButton.classList.toggle("hidden", !needsReExtract);
  elements.reExtractNotebookButton.disabled = busy;
  // Always show import box as fallback when notebook step is active
  elements.notebookImportBox.classList.toggle("hidden", !insert.bagFactsConfirmed);
  elements.freezeDesignButton.disabled =
    busy || !insert.notebookResultText || Boolean(insert.designFrozen);
  elements.unlockDesignButton.classList.toggle(
    "hidden",
    !insert.designFrozen
  );
  elements.unlockDesignButton.disabled = busy;
  elements.bagVariantRows.querySelectorAll("input, button").forEach((control) => {
    control.disabled = busy || Boolean(insert.bagFactsConfirmed);
  });
  elements.insertBrand.disabled = busy || Boolean(insert.bagFactsConfirmed);
  elements.insertBagFamily.disabled = busy || Boolean(insert.bagFactsConfirmed);
  elements.designVariantRows.querySelectorAll("input").forEach((control) => {
    control.disabled = busy || Boolean(insert.designFrozen);
  });
  elements.claimInputs.forEach((input) => {
    input.disabled = busy || Boolean(insert.designFrozen);
  });
  const allLinersReady =
    variants.length > 0 &&
    variants.every((variant) =>
      linerImages.some((image) => image.name === variant.linerImageName)
    );
  elements.buildInsertPromptsButton.disabled =
    busy || !insert.designFrozen || !allLinersReady || Boolean(insert.promptPackValid);
  elements.generateInsertImagesButton.disabled =
    busy || !insert.promptPackValid || generated.size === 7;
  elements.generateInsertImagesButton.textContent =
    generated.size === 7
      ? "7 张图片已完成"
      : generated.size
        ? `继续生成（已完成 ${generated.size}/7）`
        : "逐张生成 7 张图";
  elements.generateInsertListingButton.disabled =
    busy || generated.size < 7 || Boolean(insert.listingContentGenerated);
  elements.generateInsertListingButton.textContent = insert.listingContentGenerated
    ? "内胆 Listing 文案已生成"
    : "生成内胆 Listing 文案";
  elements.importInsertListingContentButton?.classList.toggle(
    "hidden",
    generated.size < 7 || Boolean(insert.listingContentGenerated)
  );
  elements.importInsertListingContentButton && (elements.importInsertListingContentButton.disabled = busy);
  elements.previewInsertStockSheetButton.disabled =
    busy || !insert.designFrozen;
  elements.archiveInsertButton.disabled =
    busy ||
    generated.size < 7 ||
    !insert.listingContentGenerated ||
    state.stage === "COMPLETED";
  elements.insertNextProductButton.disabled =
    busy || state.stage !== "COMPLETED" || !insert.archiveDirectory;
}

function imageCard(image, removable, onRemove) {
  const card = document.createElement("article");
  card.className = "image-card";
  const preview = document.createElement("img");
  preview.src = image.thumbnailUrl;
  preview.alt = image.name;
  const footer = document.createElement("div");
  footer.className = "image-card-footer";
  const name = document.createElement("span");
  name.textContent = image.name;
  const remove = document.createElement("button");
  remove.className = "remove-image-button";
  remove.type = "button";
  remove.textContent = "移除";
  remove.disabled = !removable;
  remove.addEventListener("click", () => void onRemove());
  footer.append(name, remove);
  card.append(preview, footer);
  return card;
}

function field(label, name, value = "", type = "text") {
  const wrapper = document.createElement("label");
  wrapper.textContent = label;
  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.value = value ?? "";
  if (type === "number") input.step = "0.1";
  wrapper.append(input);
  return wrapper;
}

function createBagVariantRow(variant, primaryId) {
  const row = document.createElement("div");
  row.className = "variant-row bag-variant-row";
  row.dataset.variantId = variant.id;
  const primary = document.createElement("label");
  primary.className = "primary-radio";
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "primaryVariant";
  radio.checked = primaryId ? primaryId === variant.id : false;
  primary.append(radio, document.createTextNode("主推"));
  row.append(
    primary,
    field("SKU 编号", "id", variant.id),
    field("版本名称", "label", variant.label),
    field("长 cm", "bagLength", variant.bagDimensions?.length, "number"),
    field("宽 cm", "bagWidth", variant.bagDimensions?.width, "number"),
    field("高 cm", "bagHeight", variant.bagDimensions?.height, "number"),
    field("官网/可信来源", "publicSourceUrl", variant.publicSourceUrl),
    field("版本备注", "version", variant.version)
  );
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "text-button";
  remove.textContent = "删除";
  remove.addEventListener("click", () => row.remove());
  row.append(remove);
  return row;
}

function createDesignVariantRow(variant) {
  const row = document.createElement("div");
  row.className = "variant-row design-variant-row";
  row.dataset.variantId = variant.id;
  const title = document.createElement("strong");
  title.textContent = `${variant.id} · ${variant.label} · 外包 ${dimensionLabel(variant.bagDimensions)}`;
  row.append(
    title,
    field("内胆长 cm", "insertLength", variant.insertDimensions?.length, "number"),
    field("内胆宽 cm", "insertWidth", variant.insertDimensions?.width, "number"),
    field("内胆高 cm", "insertHeight", variant.insertDimensions?.height, "number"),
    field("库存 SKU（无则留空）", "inventorySku", variant.inventorySku),
    field("方案", "designDecision", variant.designDecision),
    field("材质", "material", variant.material || "Felt"),
    field("颜色", "color", variant.color),
    field("结构/隔层", "structure", variant.structure),
    field("适配间隙", "fitClearance", variant.fitClearance),
    field("风险备注", "designRisks", variant.designRisks),
    field("重量 g（未知留空）", "weightGrams", variant.weightGrams, "number")
  );
  return row;
}

function createLinerUploadCard(variant, images, busy) {
  const card = document.createElement("article");
  card.className = "liner-upload-card";
  const title = document.createElement("strong");
  title.textContent = `${variant.id} · ${variant.label}`;
  const image = images.find((candidate) => candidate.name === variant.linerImageName);

  /* ── 主图区（原有逻辑不变） ── */
  if (image) {
    const previewWrap = document.createElement("div");
    previewWrap.className = "liner-preview";
    const preview = document.createElement("img");
    preview.src = image.thumbnailUrl;
    preview.alt = variant.label;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "liner-remove-button";
    remove.textContent = "删除主图";
    remove.title = `删除 ${variant.label} 的内胆主图`;
    remove.disabled = busy;
    remove.addEventListener("click", () => {
      void removeLinerImage(variant.id, remove);
    });
    previewWrap.append(preview, remove);
    card.append(title, previewWrap);
  } else {
    const placeholder = document.createElement("span");
    placeholder.textContent = "尚未上传对应内胆主图";
    card.append(title, placeholder);
  }

  /* ── 主图上传行（文件 + URL） ── */
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".jpg,.jpeg,.png,.webp";
  input.disabled = busy;
  input.addEventListener("change", () => {
    if (input.files?.[0]) void uploadLinerImage(variant.id, input.files[0]);
  });
  const urlRow = document.createElement("div");
  urlRow.className = "liner-url-row";
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.placeholder = "粘贴主图 URL";
  urlInput.disabled = busy;
  const urlButton = document.createElement("button");
  urlButton.type = "button";
  urlButton.className = "button secondary";
  urlButton.textContent = "导入主图";
  urlButton.disabled = busy;
  urlButton.addEventListener("click", () => {
    void uploadLinerImageUrl(variant.id, urlInput.value, urlButton);
  });
  urlRow.append(urlInput, urlButton);
  card.append(input, urlRow);

  /* ══════════════════════════════════════
     细节图区域（新增：多张参考细节图）
     生图时这些图片会一并传给 AI 作为视觉参考，
     防止生成的图片与实物不符（货不对板）。
  ══════════════════════════════════════ */

  const detailNames = variant.linerDetailImageNames || [];
  const detailImages = detailNames
    .map((name) => images.find((c) => c.name === name))
    .filter(Boolean);

  const detailSection = document.createElement("div");
  detailSection.className = "liner-detail-section";

  /* 细节图标题 + 计数 */
  const detailHeader = document.createElement("div");
  detailHeader.className = "liner-detail-header";
  detailHeader.innerHTML = `<span class="liner-detail-label">📷 细节参考图</span><span class="liner-detail-count">${detailImages.length}/12</span>`;

  /* 已有细节图缩略图网格 */
  if (detailImages.length > 0) {
    const thumbGrid = document.createElement("div");
    thumbGrid.className = "liner-detail-grid";
    for (const di of detailImages) {
      const thumb = document.createElement("div");
      thumb.className = "liner-detail-thumb";
      const img = document.createElement("img");
      img.src = di.thumbnailUrl;
      img.alt = `${variant.label} 细节`;
      img.loading = "lazy";

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "liner-detail-remove";
      delBtn.textContent = "×";
      delBtn.title = "移除此细节图";
      delBtn.disabled = busy;
      delBtn.addEventListener("click", () => {
        void removeLinerDetailImage(variant.id, di.name, delBtn);
      });

      thumb.append(img, delBtn);
      thumbGrid.appendChild(thumb);
    }
    detailSection.append(detailHeader, thumbGrid);
  } else {
    detailSection.appendChild(detailHeader);
  }

  /* 细节图操作行：多文件上传 + URL 批量导入 */
  const detailActions = document.createElement("div");
  detailActions.className = "liner-detail-actions";

  /* 多文件选择 */
  const detailFileInput = document.createElement("input");
  detailFileInput.type = "file";
  detailFileInput.accept = ".jpg,.jpeg,.png,.webp";
  detailFileInput.multiple = true;
  detailFileInput.disabled = busy;
  detailFileInput.setAttribute("aria-label", `为 ${variant.label} 上传细节图`);

  const detailFileBtn = document.createElement("button");
  detailFileBtn.type = "button";
  detailFileBtn.className = "button secondary liner-detail-btn";
  detailFileBtn.textContent = "+ 添加细节图";
  detailFileBtn.disabled = busy;
  detailFileBtn.addEventListener("click", () => detailFileInput.click());
  detailFileInput.addEventListener("change", () => {
    if (detailFileInput.files?.length) void uploadLinerDetailImages(variant.id, [...detailFileInput.files], detailFileBtn);
    detailFileInput.value = "";
  });

  /* URL 批量输入 */
  const detailUrlInput = document.createElement("input");
  detailUrlInput.type = "text";
  detailUrlInput.placeholder = "批量粘贴细节图 URL（每行一个，最多12个）";
  detailUrlInput.disabled = busy;
  detailUrlInput.className = "liner-detail-url-input";

  const detailUrlBtn = document.createElement("button");
  detailUrlBtn.type = "button";
  detailUrlBtn.className = "button secondary liner-detail-btn";
  detailUrlBtn.textContent = "URL 导入";
  detailUrlBtn.disabled = busy;
  detailUrlBtn.addEventListener("click", () => {
    void uploadLinerDetailImageUrls(variant.id, detailUrlInput.value, detailUrlBtn);
  });

  detailActions.append(detailFileBtn, detailUrlInput, detailUrlBtn);
  detailSection.appendChild(detailActions);
  card.appendChild(detailSection);

  return card;
}

function dimensionLabel(value) {
  return value ? `${value.length} × ${value.width} × ${value.height} cm` : "未填写";
}

function collectBagVariants() {
  return [...elements.bagVariantRows.querySelectorAll(".bag-variant-row")].map(
    (row, index) => ({
      id: row.querySelector('[name="id"]').value.trim() || `SKU-${index + 1}`,
      label: row.querySelector('[name="label"]').value.trim(),
      bagDimensions: {
        length: Number(row.querySelector('[name="bagLength"]').value),
        width: Number(row.querySelector('[name="bagWidth"]').value),
        height: Number(row.querySelector('[name="bagHeight"]').value)
      },
      publicSourceUrl: row.querySelector('[name="publicSourceUrl"]').value.trim(),
      version: row.querySelector('[name="version"]').value.trim(),
      primary: row.querySelector('[name="primaryVariant"]').checked
    })
  );
}

function collectDesignVariants(stateVariants) {
  return [...elements.designVariantRows.querySelectorAll(".design-variant-row")].map(
    (row) => {
      const original = stateVariants.find((variant) => variant.id === row.dataset.variantId);
      const weight = row.querySelector('[name="weightGrams"]').value;
      return {
        ...original,
        insertDimensions: {
          length: Number(row.querySelector('[name="insertLength"]').value),
          width: Number(row.querySelector('[name="insertWidth"]').value),
          height: Number(row.querySelector('[name="insertHeight"]').value)
        },
        inventorySku: row.querySelector('[name="inventorySku"]').value.trim(),
        designDecision: row.querySelector('[name="designDecision"]').value.trim(),
        material: row.querySelector('[name="material"]').value.trim(),
        color: row.querySelector('[name="color"]').value.trim(),
        structure: row.querySelector('[name="structure"]').value.trim(),
        fitClearance: row.querySelector('[name="fitClearance"]').value.trim(),
        designRisks: row.querySelector('[name="designRisks"]').value.trim(),
        weightGrams: weight ? Number(weight) : undefined
      };
    }
  );
}

async function removeImage(name, button) {
  button.disabled = true;
  try {
    await request(`/api/images/${encodeURIComponent(name)}`, {
      method: "DELETE"
    });
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  }
}

async function clearImages() {
  elements.clearImagesButton.disabled = true;
  try {
    await request("/api/images", { method: "DELETE" });
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  }
}

/* ===== 店小秘自动化上品（乳贴 v1.0）板板块 ===== */
const dianxiaomiState = {
  status: "就绪",
  statusKind: "",
  log: [],
  busy: false,
  scrollTop: 0,
  facts: "",        // 提取/编辑后的产品事实 JSON 文本（模块级保持，防秒级刷新丢编辑）
  uploaded: "",      // 上传图片结果信息
  imageUrls: "",     // URL 输入内容（模块级保持）
  uploadTab: "file", // "file" | "url"
  previews: [],      // 已上传产品图预览列表 [{name, size, url}]
  // SKU 规划（调研前手动填，存模块级防每秒刷新丢失）
  skuColors: "",     // 颜色输入框内容（逗号分隔）
  skuSizes: "One Size (One Size)", // 尺寸默认 = One Size（用户要求），逗号分隔
  skuDefaultPrice: "",
  skuDefaultStock: "",
  skuDefaultWeight: "",
  skuMatrix: null,   // 生成后的组合表 [{color,size,price,stock,weight,barcode,image,customName}]
  skuColorImages: {},// 按颜色共用图 {color: filename}
  skuColorCustomNames: {},// 颜色自定义名（别名）{color: 自定义名}，仅用于本系统 SKU 标签/文案
  skuSourceLoaded: false,
  // listing 资料就绪状态（SOP 守卫用，节流查询避免每秒刷新打爆接口）
  factsStatus: null,       // {ready, missing, imageCount, hasVariants, variantsCount}
  factsStatusCheckedAt: 0,
  factsStatusLoading: false,
  // 店小秘类目 profile（多类目：ruTie 乳贴 / xiangBao 箱包配件）
  profiles: [],            // 从 /api/dianxiaomi/profiles 拉取
  profileKey: "ruTie",     // 当前选中类目（模块级保持，防秒级刷新丢失）
  profilesLoaded: false
};

// 拉取可用类目 profile（箱包配件/乳贴），用于类目切换
async function dxLoadProfiles() {
  if (dianxiaomiState.profilesLoaded) return;
  try {
    const body = await request("/api/dianxiaomi/profiles");
    if (body && Array.isArray(body.profiles)) {
      dianxiaomiState.profiles = body.profiles;
      // 若当前 profileKey 不在列表中（例如首次开放箱包），保持默认 ruTie
      if (!body.profiles.find((p) => p.key === dianxiaomiState.profileKey)) {
        dianxiaomiState.profileKey = body.profiles[0] ? body.profiles[0].key : "ruTie";
      }
      dianxiaomiState.profilesLoaded = true;
      renderDianxiaomiListing();
    }
  }
  catch (e) {
    dianxiaomiState.profiles = [];
  }
}

function dxLogLine(text) {
  dianxiaomiState.log.unshift(typeof text === "string" ? text : JSON.stringify(text, null, 2));
  if (dianxiaomiState.log.length > 200) dianxiaomiState.log.length = 200;
}
function dxSetStatus(text, kind) {
  dianxiaomiState.status = text;
  dianxiaomiState.statusKind = kind || "";
}
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* 拉取已上传产品图列表 → 填入预览网格 */
async function dxRefreshPreview() {
  try {
    const body = await request("/api/dianxiaomi/product-images");
    dianxiaomiState.previews = (body.images || []).map((img) => ({
      name: img.name,
      size: img.size,
      url: img.url
    }));
  } catch (_e) {
    /* 静默失败，预览非关键路径 */
    dianxiaomiState.previews = [];
  }
}

/* ===== SKU 规划（调研前手动填，Step 2.5）===== */
function applySkuDefaults() {
  if (!dianxiaomiState.skuMatrix) return;
  const p = dianxiaomiState.skuDefaultPrice;
  const s = dianxiaomiState.skuDefaultStock;
  const w = dianxiaomiState.skuDefaultWeight;
  dianxiaomiState.skuMatrix.forEach((m) => {
    if (!m._priceEdited) m.price = p;
    if (!m._stockEdited) m.stock = s;
    if (!m._weightEdited) m.weight = w;
  });
}

function dxGenerateSkuMatrix() {
  const colors = dianxiaomiState.skuColors.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const sizes = dianxiaomiState.skuSizes.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  if (!colors.length || !sizes.length) {
    dxSetStatus("请先填颜色和尺寸（逗号分隔）", "err");
    dxLogLine("✗ 生成组合表失败：颜色或尺寸为空");
    renderDianxiaomiListing();
    return;
  }
  const dp = dianxiaomiState.skuDefaultPrice;
  const ds = dianxiaomiState.skuDefaultStock;
  const dw = dianxiaomiState.skuDefaultWeight;
  const seen = new Set();
  const matrix = [];
  colors.forEach((c) => {
    sizes.forEach((s) => {
      const key = c + "|" + s;
      if (seen.has(key)) return;
      seen.add(key);
      matrix.push({
        color: c, size: s,
        price: dp, stock: ds, weight: dw,
        barcode: "", sku: "", image: dianxiaomiState.skuColorImages[c] || "",
        customName: dianxiaomiState.skuColorCustomNames[c] || ""
      });
    });
  });
  const firstColor = {};
  matrix.forEach((m) => {
    if (!(m.color in firstColor)) { firstColor[m.color] = true; m.firstOfColor = true; }
    else { m.firstOfColor = false; }
  });
  dianxiaomiState.skuMatrix = matrix;
  dxSetStatus("已生成 " + matrix.length + " 个组合", "ok");
  dxLogLine("✓ 生成组合表: " + colors.length + " 色 × " + sizes.length + " 尺寸 = " + matrix.length + " 组合");
  renderDianxiaomiListing();
}

async function dxLoadSourceVariants() {
  if (dianxiaomiState.busy) return;
  dianxiaomiState.busy = true;
  dxSetStatus("正在载入源产品变种…", "");
  renderDianxiaomiListing();
  try {
    const body = await request("/api/dianxiaomi/source-variants");
    if (body.colors && body.colors.length) dianxiaomiState.skuColors = body.colors.join(", ");
    // 仅当用户未手动设尺寸时才用源产品尺寸覆盖（保留用户/默认的 One Size 选择）
    if (body.sizes && body.sizes.length && !dianxiaomiState.skuSizes.trim()) dianxiaomiState.skuSizes = body.sizes.join(", ");
    dianxiaomiState.skuSourceLoaded = true;
    dxSetStatus("已载入源产品变种", "ok");
    dxLogLine("✓ 载入源产品变种: 颜色=" + (body.colors || []).join("/") + " 尺寸=" + (body.sizes || []).join("/"));
  } catch (e) {
    dxSetStatus("载入失败: " + e.message, "err");
    dxLogLine("✗ 载入源产品变种失败: " + e.message);
  } finally {
    dianxiaomiState.busy = false;
    renderDianxiaomiListing();
  }
}

async function dxSaveVariants() {
  if (dianxiaomiState.busy) return;
  if (!dianxiaomiState.skuMatrix || !dianxiaomiState.skuMatrix.length) {
    dxSetStatus("请先生成组合表", "err");
    renderDianxiaomiListing();
    return;
  }
  dianxiaomiState.busy = true;
  dxSetStatus("保存 SKU 规划…", "");
  renderDianxiaomiListing();
  try {
    const colorImages = {};
    dianxiaomiState.skuMatrix.forEach((m) => { if (m.firstOfColor) colorImages[m.color] = m.image; });
    const variants = {
      colors: dianxiaomiState.skuColors.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      sizes: dianxiaomiState.skuSizes.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      defaultPrice: dianxiaomiState.skuDefaultPrice,
      defaultStock: dianxiaomiState.skuDefaultStock,
      defaultWeight: dianxiaomiState.skuDefaultWeight,
      colorImages,
      colorCustomNames: dianxiaomiState.skuColorCustomNames,
      matrix: dianxiaomiState.skuMatrix.map((m) => ({
        color: m.color, size: m.size, price: m.price, stock: m.stock,
        weight: m.weight, barcode: m.barcode, sku: m.sku, image: m.image,
        customName: m.customName || dianxiaomiState.skuColorCustomNames[m.color] || ""
      }))
    };
    const body = await request("/api/dianxiaomi/save-variants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variants })
    });
    dxSetStatus("SKU 规划已保存（" + variants.matrix.length + " 组合）", "ok");
    dxLogLine("✓ SKU 规划已保存: " + (body.note || ""));
  } catch (e) {
    dxSetStatus("保存失败: " + e.message, "err");
    dxLogLine("✗ 保存 SKU 规划失败: " + e.message);
  } finally {
    dianxiaomiState.busy = false;
    renderDianxiaomiListing();
  }
}

async function dxReferenceFill() {
  if (dianxiaomiState.busy) return;
  const input = document.getElementById("dx-tpl");
  const id = (input && input.value && input.value.trim()) || "1005005575013300";
  const psel = document.getElementById("dx-profile");
  const profileKey = (psel && psel.value) || dianxiaomiState.profileKey;
  dianxiaomiState.profileKey = profileKey;
  dianxiaomiState.busy = true;
  dxSetStatus("引用并填固定字段中…", "busy");
  dxLogLine("→ POST /api/dianxiaomi/reference-fill  profile=" + profileKey + "  templateId=" + id);
  renderDianxiaomiListing();
  try {
    const body = await request("/api/dianxiaomi/reference-fill", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: id, profileKey })
    });
    dxLogLine("✓ 引用成功 → " + (body.reference && body.reference.url ? body.reference.url : JSON.stringify(body.reference)));
    dxLogLine("✓ 已填固定字段: " + JSON.stringify(body.filled || {}));
    dxSetStatus("引用并填固定字段完成", "ok");
  } catch (e) {
    dxLogLine("✗ 失败: " + e.message);
    dxSetStatus("失败: " + e.message, "err");
  } finally {
    dianxiaomiState.busy = false;
    renderDianxiaomiListing();
  }
}

async function dxSave() {
  if (dianxiaomiState.busy) return;
  dianxiaomiState.busy = true;
  dxSetStatus("保存中（不发布）…", "busy");
  dxLogLine("→ POST /api/dianxiaomi/save");
  renderDianxiaomiListing();
  try {
    const body = await request("/api/dianxiaomi/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    dxLogLine("✓ 已点击保存按钮: " + (body.clicked || JSON.stringify(body)));
    if (body.level === "err") {
      dxLogLine("✗ 保存未通过校验: " + (body.message || ""));
      dxSetStatus("保存失败: " + (body.message || "校验未通过"), "err");
    } else if (body.level === "ok") {
      dxLogLine("✓ 保存成功: " + (body.message || ""));
      dxSetStatus("保存成功（草稿未发布）", "ok");
    } else {
      dxLogLine("⚠️ 已点击保存，未捕获明确结果: " + (body.message || ""));
      dxSetStatus("已点击保存，请人工确认草稿", "busy");
    }
  } catch (e) {
    dxLogLine("✗ 失败: " + e.message);
    dxSetStatus("失败: " + e.message, "err");
  } finally {
    dianxiaomiState.busy = false;
    renderDianxiaomiListing();
  }
}

async function dxUploadImages(files) {
  if (dianxiaomiState.busy) return;
  if (!files || !files.length) {
    dxSetStatus("请先选择产品图", "err");
    renderDianxiaomiListing();
    return;
  }
  dianxiaomiState.busy = true;
  dxSetStatus("上传图片中…", "busy");
  dxLogLine("→ POST /api/dianxiaomi/upload-images (" + files.length + " 张)");
  renderDianxiaomiListing();
  try {
    const fd = new FormData();
    for (const f of files) fd.append("images", f);
    const body = await request("/api/dianxiaomi/upload-images", { method: "POST", body: fd });
    dianxiaomiState.uploaded = "已上传: " + (body.saved || []).join(", ");
    dxLogLine("✓ 上传成功: " + (body.saved || []).join(", "));
    dxSetStatus("图片已上传，可点提取事实", "ok");
    await dxRefreshPreview();
  } catch (e) {
    dxLogLine("✗ 上传失败: " + e.message);
    dxSetStatus("上传失败: " + e.message, "err");
  } finally {
    dianxiaomiState.busy = false;
    renderDianxiaomiListing();
  }
}

async function dxUploadImageUrls(urlText) {
  if (dianxiaomiState.busy) return;
  const trimmed = (urlText || "").trim();
  if (!trimmed) {
    dxSetStatus("请输入至少一个图片 URL", "err");
    renderDianxiaomiListing();
    return;
  }
  dianxiaomiState.busy = true;
  dxSetStatus("从 URL 下载图片中…", "busy");
  dxLogLine("→ POST /api/dianxiaomi/upload-image-urls");
  renderDianxiaomiListing();
  try {
    const body = await request("/api/dianxiaomi/upload-image-urls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls: trimmed })
    });
    const parts = [];
    if (body.saved && body.saved.length) parts.push("下载成功: " + body.saved.join(", "));
    if (body.skipped && body.skipped.length) parts.push("跳过重复: " + body.skipped.join(", "));
    if (body.rejected && body.rejected.length) parts.push("失败: " + body.rejected.join(", "));
    dianxiaomiState.uploaded = parts.join(" | ") || "无结果";
    dxLogLine("✓ URL 导入完成: " + (body.totalSaved || 0) + " 张成功" + (body.rejected && body.rejected.length ? ", " + body.rejected.length + " 失败" : ""));
    dxSetStatus("URL 图片已导入，可点提取事实", "ok");
    await dxRefreshPreview();
  } catch (e) {
    dxLogLine("✗ URL 导入失败: " + e.message);
    dxSetStatus("导入失败: " + e.message, "err");
  } finally {
    dianxiaomiState.busy = false;
    renderDianxiaomiListing();
  }
}

async function dxExtractFacts() {
  if (dianxiaomiState.busy) return;
  dianxiaomiState.busy = true;
  dxSetStatus("AI 提取产品事实中（需 ChatGPT 登录）…", "busy");
  dxLogLine("→ POST /api/dianxiaomi/extract-facts");
  renderDianxiaomiListing();
  try {
    const body = await request("/api/dianxiaomi/extract-facts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    dianxiaomiState.facts = JSON.stringify(body.fact, null, 2);
    dxLogLine("✓ 提取完成" + (body.missing && body.missing.length ? " ⚠️缺失:" + body.missing.join(",") : ""));
    dxSetStatus("事实已提取，可编辑后点③c应用", "ok");
  } catch (e) {
    dxLogLine("✗ 提取失败: " + e.message);
    dxSetStatus("提取失败: " + e.message, "err");
  } finally {
    dianxiaomiState.busy = false;
    renderDianxiaomiListing();
  }
}

async function dxApplyFacts(factsText) {
  if (dianxiaomiState.busy) return;
  let parsed;
  try {
    parsed = JSON.parse(factsText || "{}");
  } catch (e) {
    dxSetStatus("facts JSON 解析失败: " + e.message, "err");
    renderDianxiaomiListing();
    return;
  }
  dianxiaomiState.busy = true;
  dxSetStatus("应用事实覆盖表单中（需已引用并打开表单）…", "busy");
  dxLogLine("→ POST /api/dianxiaomi/apply-facts");
  renderDianxiaomiListing();
  try {
    const body = await request("/api/dianxiaomi/apply-facts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ facts: parsed })
    });
    dxLogLine("✓ 应用结果: " + JSON.stringify(body.applied || body));
    dxSetStatus("已覆盖标题/描述（品牌/材质下一步增强）", "ok");
  } catch (e) {
    dxLogLine("✗ 应用失败: " + e.message);
    dxSetStatus("应用失败: " + e.message, "err");
  } finally {
    dianxiaomiState.busy = false;
    renderDianxiaomiListing();
  }
}

async function dxCheckFactsStatus() {
  const now = Date.now();
  // 节流：10s 内不重复查询（render 每秒跑一次）
  if (dianxiaomiState.factsStatusLoading) return;
  if (now - dianxiaomiState.factsStatusCheckedAt < 10000 && dianxiaomiState.factsStatus) return;
  dianxiaomiState.factsStatusLoading = true;
  try {
    const body = await request("/api/dianxiaomi/facts-status");
    dianxiaomiState.factsStatus = body;
    dianxiaomiState.factsStatusCheckedAt = Date.now();
  }
  catch (e) {
    dianxiaomiState.factsStatus = null;
  }
  finally {
    dianxiaomiState.factsStatusLoading = false;
    renderDianxiaomiListing();
  }
}

async function dxReferenceApply() {
  if (dianxiaomiState.busy) return;
  const input = document.getElementById("dx-tpl");
  const id = (input && input.value && input.value.trim()) || "1005005575013300";
  const psel = document.getElementById("dx-profile");
  const profileKey = (psel && psel.value) || dianxiaomiState.profileKey;
  dianxiaomiState.profileKey = profileKey;
  dianxiaomiState.busy = true;
  dxSetStatus("推荐流程：引用源产品→覆盖资料文档→保存中…", "busy");
  dxLogLine("→ POST /api/dianxiaomi/reference-apply  profile=" + profileKey + "  templateId=" + id);
  renderDianxiaomiListing();
  try {
    const body = await request("/api/dianxiaomi/reference-apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId: id, profileKey })
    });
    // SOP 守卫：listing 资料未就绪，拒绝上架
    if (body && body.step === "facts-incomplete") {
      dxLogLine("✗ 上架被拦截: " + (body.message || ""));
      dxSetStatus("未就绪：" + (body.message || "请先跑完 listing"), "err");
      dianxiaomiState.busy = false;
      renderDianxiaomiListing();
      return;
    }
    const ref = body.reference || {};
    dxLogLine("✓ 引用成功 → " + (ref.url || ""));
    dxLogLine("✓ 固定字段: " + JSON.stringify(body.fixed || {}));
    if (Array.isArray(body.applied)) {
      for (const a of body.applied) {
        const tag = a.ok ? "✓" : "⚠";
        dxLogLine(tag + " " + (a.field || "?") + (a.value !== undefined ? " = " + a.value : "") + (a.via ? " (" + a.via + ")" : "") + (a.note ? " " + a.note : "") + (a.reason ? " reason:" + a.reason : ""));
      }
    }
    const sv = body.saved || {};
    if (sv.level === "err") {
      dxLogLine("✗ 保存未通过校验: " + (sv.message || ""));
      dxSetStatus("推荐流程完成，但保存失败: " + (sv.message || "校验未通过"), "err");
    } else if (sv.level === "ok") {
      dxLogLine("✓ 保存成功: " + (sv.message || ""));
      dxSetStatus("推荐流程完成：草稿保存成功（未发布）", "ok");
    } else {
      dxLogLine("✓ 已保存草稿: " + JSON.stringify(sv));
      dxSetStatus("推荐流程完成：草稿已保存（未发布）", "ok");
    }
  } catch (e) {
    dxLogLine("✗ 失败: " + e.message);
    dxSetStatus("失败: " + e.message, "err");
  } finally {
    dianxiaomiState.busy = false;
    renderDianxiaomiListing();
  }
}

// 从上品控制台「上架店小秘（草稿）」按钮进入：拉取当前产品资料包 → 引用模板 → 填事实 → 存草稿。
// 复用与 dxReferenceApply 相同的后端链路，仅 facts 来源改为 GET /api/product/facts。
async function listingApplyToDianxiaomi() {
  if (dianxiaomiState.busy) return;
  let factsBody;
  try {
    factsBody = await request("/api/product/facts");
  }
  catch (e) {
    window.alert("读取产品资料包失败：" + e.message);
    return;
  }
  if (!factsBody || !factsBody.ready) {
    const miss = factsBody && Array.isArray(factsBody.missing) && factsBody.missing.length
      ? factsBody.missing.join("、")
      : "请先完成 Listing 并生成 product-facts.json";
    window.alert("产品资料包尚未就绪（缺少：" + miss + "）");
    return;
  }
  // 解析类目 profile：优先取上品控制台专用下拉 dx-console-profile，
  // 其次取店小秘面板下拉 dx-profile，最后回退到模块级持久值/默认 ruTie。
  const consolePsel = document.getElementById("dx-console-profile");
  const panelPsel = document.getElementById("dx-profile");
  const profileKey = (consolePsel && consolePsel.value) ||
    (panelPsel && panelPsel.value) ||
    dianxiaomiState.profileKey || "ruTie";
  dianxiaomiState.profileKey = profileKey;
  // 安全确认：展示将引用的类目 + 模板，避免误用错类目模板
  let profiles = [];
  try {
    const pb = await request("/api/dianxiaomi/profiles");
    profiles = (pb && pb.profiles) || [];
  }
  catch (_e) { /* 忽略，走兜底 */ }
  const profile = profiles.find((p) => p.key === profileKey) || profiles[0];
  const templateId = profile ? profile.templateProductId : "1005005575013300";
  const confirmed = window.confirm(
    "即将上架到店小秘：\n类目：" + (profile ? profile.label : profileKey) +
    "\n模板产品ID：" + templateId +
    "\n\n确认引用该模板并把产品资料包填入店小秘 ERP（仅保存草稿，不发布）？"
  );
  if (!confirmed) return;
  // 切到店小秘视图以展示完整日志
  switchView("agent-dianxiaomi");
  dianxiaomiState.busy = true;
  dxSetStatus("引用源产品→覆盖资料文档→保存中…", "busy");
  dxLogLine("→ 上架店小秘（来自上品资料包） profile=" + profileKey + " template=" + templateId);
  renderDianxiaomiListing();
  try {
    const body = await request("/api/dianxiaomi/reference-apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileKey, facts: factsBody.facts })
    });
    if (body && body.step === "facts-incomplete") {
      dxLogLine("✗ 上架被拦截: " + (body.message || ""));
      dxSetStatus("未就绪：" + (body.message || "请先跑完 listing"), "err");
      dianxiaomiState.busy = false;
      renderDianxiaomiListing();
      return;
    }
    const ref = body.reference || {};
    dxLogLine("✓ 引用成功 → " + (ref.url || ""));
    dxLogLine("✓ 固定字段: " + JSON.stringify(body.fixed || {}));
    if (Array.isArray(body.applied)) {
      for (const a of body.applied) {
        const tag = a.ok ? "✓" : "⚠";
        dxLogLine(tag + " " + (a.field || "?") + (a.value !== undefined ? " = " + a.value : "") + (a.via ? " (" + a.via + ")" : "") + (a.note ? " " + a.note : "") + (a.reason ? " reason:" + a.reason : ""));
      }
    }
    const sv = body.saved || {};
    if (sv.level === "err") {
      dxLogLine("✗ 保存未通过校验: " + (sv.message || ""));
      dxSetStatus("推荐流程完成，但保存失败: " + (sv.message || "校验未通过"), "err");
    }
    else {
      dxLogLine("✓ 已保存草稿: " + JSON.stringify(sv));
      dxSetStatus("推荐流程完成：草稿已保存（未发布）", "ok");
    }
  }
  catch (e) {
    dxLogLine("✗ 失败: " + e.message);
    dxSetStatus("失败: " + e.message, "err");
  }
  finally {
    dianxiaomiState.busy = false;
    renderDianxiaomiListing();
  }
}

function renderDianxiaomiListing() {
  const root = document.getElementById("dianxiaomi-root");
  if (!root) return;
  // 重建前记录焦点元素 + 光标位置（防每秒刷新丢失焦点 → 无法连续输入）
  const active = document.activeElement;
  const focusId = active && active.id ? active.id : null;
  const selStart = (active && "selectionStart" in active && typeof active.selectionStart === "number") ? active.selectionStart : null;
  const selEnd = (active && "selectionEnd" in active && typeof active.selectionEnd === "number") ? active.selectionEnd : null;
  const prevLog = document.getElementById("dx-log");
  dianxiaomiState.scrollTop = prevLog ? prevLog.scrollTop : 0;
  const t = dianxiaomiState.uploadTab;
  root.innerHTML = `
    <div class="dx-board">
      <!-- 顶部流程概览 -->
      <div class="dx-overview">
        <div class="dx-overview-icon">⚡</div>
        <div class="dx-overview-text">
          <b>推荐路径</b>：先在上品 listing 跑完资料 → 一键导入店小秘并上架
          <span class="dx-overview-sub">固定：洛慈全托管 / 国内履约 / 内衣配件(乳贴)</span>
        </div>
      </div>

      <!-- listing 资料就绪状态（SOP 守卫可视化） -->
      ${(() => {
        const fs = dianxiaomiState.factsStatus;
        if (!fs) return `<div style="padding:8px 12px;border-radius:8px;font-size:12px;background:#f1f3f5;color:#5f5e5a;border:1px solid #d0d7de;margin-bottom:12px">listing 资料状态：检测中…</div>`;
        if (fs.ready) return `<div style="padding:8px 12px;border-radius:8px;font-size:12px;background:#e6f7ed;color:#173404;border:1px solid #9adcb8;margin-bottom:12px">✓ listing 资料已就绪（主图 ${fs.imageCount} 张${fs.hasVariants ? ` / 变种 ${fs.variantsCount} 组` : ""}）→ 可直接上架</div>`;
        return `<div style="padding:8px 12px;border-radius:8px;font-size:12px;background:#fbe9e9;color:#791f1f;border:1px solid #f3a3a3;margin-bottom:12px">✗ listing 资料未就绪（缺：${fs.missing.join("、")}）→ 请先在上品 listing 跑完资料再上架</div>`;
      })()}

      <!-- Step 1: 引用 + 执行 -->
      <div class="dx-card dx-card-primary">
        <div class="dx-card-header">
          <span class="dx-step-num">1</span>
          <span class="dx-card-title">引用 & 执行</span>
        </div>
        <div class="dx-card-body">
          <div class="dx-field">
            <label for="dx-profile">类目</label>
            <select id="dx-profile">
              ${(dianxiaomiState.profiles && dianxiaomiState.profiles.length) ? dianxiaomiState.profiles.map((p) => `<option value="${p.key}" ${p.key === dianxiaomiState.profileKey ? "selected" : ""}>${p.label}</option>`).join("") : `<option value="ruTie" selected>乳贴</option>`}
            </select>
          </div>
          <div class="dx-field">
            <label for="dx-tpl">引用产品 ID</label>
            <input id="dx-tpl" value="${dianxiaomiState.profileKey === "xiangBao" ? "1005012741652735" : "1005005575013300"}" placeholder="引用模板产品ID" />
          </div>
          <div class="dx-btn-group">
            <button id="dx-refapply" class="dx-btn primary" ${dianxiaomiState.busy ? "disabled" : ""}>
              <span class="dx-btn-icon">★</span> 从 listing 导入并上架
            </button>
            <button id="dx-refill" class="dx-btn" ${dianxiaomiState.busy ? "disabled" : ""}>仅引用+填固定字段</button>
            <button id="dx-save" class="dx-btn ghost" ${dianxiaomiState.busy ? "disabled" : ""}>仅保存</button>
          </div>
        </div>
      </div>

      <!-- Step 2: 产品资料 -->
      <div class="dx-card">
        <div class="dx-card-header">
          <span class="dx-step-num">2</span>
          <span class="dx-card-title">产品资料（图片 + AI 事实）</span>
        </div>
        <div class="dx-card-body">
          <!-- 上传方式切换 -->
          <div class="dx-tabs" role="tablist">
            <button class="dx-tab ${t === "file" ? "active" : ""}" data-tab="file" role="tab" aria-selected="${t === "file"}">📁 本地文件</button>
            <button class="dx-tab ${t === "url" ? "active" : ""}" data-tab="url" role="tab" aria-selected="${t === "url"}">🔗 图片 URL</button>
          </div>
          <!-- 文件上传面板 -->
          <div class="dx-tab-panel ${t === "file" ? "visible" : ""}" data-panel="file">
            <div class="dx-field">
              <label for="dx-imgs">选择产品图（主图 / 详情，可多选）</label>
              <div class="dx-file-wrapper">
                <input type="file" id="dx-imgs" multiple accept="image/*" />
                <span class="dx-file-hint">支持 JPG / PNG / WEBP，最多 12 张</span>
              </div>
            </div>
            <button id="dx-upload" class="dx-btn ${dianxiaomiState.busy ? "disabled" : ""}">上传图片</button>
          </div>
          <!-- URL 上传面板 -->
          <div class="dx-tab-panel ${t === "url" ? "visible" : ""}" data-panel="url">
            <div class="dx-field">
              <label for="dx-urls">图片 URL（每行一个，或逗号分隔）</label>
              <textarea id="dx-urls" class="dx-url-input" rows="3" placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.png"></textarea>
            </div>
            <button id="dx-upload-url" class="dx-btn ${dianxiaomiState.busy ? "disabled" : ""}">从 URL 下载并导入</button>
          </div>
          <!-- 上传结果 + 预览网格 -->
          <div id="dx-uploaded" class="dx-uploaded">${dianxiaomiState.uploaded}</div>
          ${dianxiaomiState.previews.length ? `
          <div class="dx-preview-grid" id="dx-preview-grid">
            <div class="dx-preview-label">🖼️ 已导入产品图（${dianxiaomiState.previews.length} 张）</div>
            <div class="dx-preview-thumbs">
              ${dianxiaomiState.previews.map((p, i) => `
                <div class="dx-thumb" title="${p.name} (${(p.size / 1024).toFixed(1)} KB)">
                  <img src="${p.url}" alt="${p.name}" loading="lazy" onerror="this.parentElement.classList.add('broken')" />
                  <span class="dx-thumb-index">#${i + 1}</span>
                  <span class="dx-thumb-name">${p.name.length > 16 ? p.name.slice(0, 14) + "…" : p.name}</span>
                </div>
              `).join("")}
            </div>
          </div>` : ""}
          <!-- 操作按钮行 -->
          <div class="dx-btn-group dx-btn-group-secondary">
            <button id="dx-extract" class="dx-btn ${dianxiaomiState.busy ? "disabled" : ""}">AI 提取事实</button>
            <button id="dx-apply" class="dx-btn ${dianxiaomiState.facts && dianxiaomiState.facts.trim() ? "primary" : "ghost"} ${dianxiaomiState.busy ? "disabled" : ""}">${dianxiaomiState.facts && dianxiaomiState.facts.trim() ? "<span class='dx-btn-icon'>📋</span> 应用事实到表单" : "应用覆盖到表单"}</button>
          </div>
        </div>
      </div>

      <!-- Step 2.5: SKU 规划（调研前手动填） -->
      <div class="dx-card">
        <div class="dx-card-header">
          <span class="dx-step-num">2.5</span>
          <span class="dx-card-title">SKU 规划（变种矩阵 + 定价）</span>
        </div>
        <div class="dx-card-body">
          <div class="dx-field-row">
            <div class="dx-field">
              <label for="dx-sku-colors">颜色（逗号分隔）</label>
              <input id="dx-sku-colors" placeholder="Beige, Black, Pink" />
            </div>
            <div class="dx-field">
              <label for="dx-sku-sizes">尺寸（逗号分隔，默认 One Size）</label>
              <input id="dx-sku-sizes" placeholder="One Size (One Size)" />
            </div>
          </div>
          <div class="dx-btn-group dx-btn-group-secondary">
            <button id="dx-sku-gen" class="dx-btn">生成组合表</button>
            <button id="dx-sku-load" class="dx-btn ghost" ${dianxiaomiState.busy ? "disabled" : ""}>载入源产品变种</button>
          </div>
          <div class="dx-field-row">
            <div class="dx-field">
              <label for="dx-sku-price">默认售价</label>
              <input id="dx-sku-price" placeholder="9.99" inputmode="decimal" />
            </div>
            <div class="dx-field">
              <label for="dx-sku-stock">默认库存</label>
              <input id="dx-sku-stock" placeholder="100" inputmode="numeric" />
            </div>
            <div class="dx-field">
              <label for="dx-sku-weight">默认重量(g)</label>
              <input id="dx-sku-weight" placeholder="30" inputmode="numeric" />
            </div>
          </div>
          <div class="dx-hint-inline">填默认价/库存/重量会自动套用到所有组合，表格内可逐行单独改。图片按颜色共用（同色不同尺寸同图）。「颜色自定义名」为可选别名，仅用于本系统 SKU 标签与文案，不改变店小秘颜色属性值。</div>
          ${(() => {
            if (!dianxiaomiState.skuMatrix || !dianxiaomiState.skuMatrix.length) return "";
            const previews = dianxiaomiState.previews || [];
            const imgOpts = (sel) => `<option value="">— 不选 —</option>` + previews.map((p) => `<option value="${esc(p.name)}" ${sel === p.name ? "selected" : ""}>${esc(p.name)}</option>`).join("");
            let t = `<table class="dx-sku-table"><thead><tr><th>颜色</th><th>颜色自定义名</th><th>尺寸</th><th>售价</th><th>库存</th><th>重量(g)</th><th>图片(按颜色)</th></tr></thead><tbody>`;
            dianxiaomiState.skuMatrix.forEach((m, i) => {
              t += `<tr>
                <td>${esc(m.color)}</td>
                <td>${m.firstOfColor ? `<input id="sku-customname-${i}" class="dx-sku-cell" value="${esc(m.customName || dianxiaomiState.skuColorCustomNames[m.color] || "")}" placeholder="可选别名" />` : `<span class="dx-sku-samecolor">↳ 同色</span>`}</td>
                <td>${esc(m.size)}</td>
                <td><input id="sku-price-${i}" class="dx-sku-cell" value="${esc(m.price)}" /></td>
                <td><input id="sku-stock-${i}" class="dx-sku-cell" value="${esc(m.stock)}" /></td>
                <td><input id="sku-weight-${i}" class="dx-sku-cell" value="${esc(m.weight)}" /></td>
                <td>${m.firstOfColor ? `<select id="sku-img-${i}" class="dx-sku-img">${imgOpts(m.image)}</select>` : `<span class="dx-sku-samecolor">↳ 同色</span>`}</td>
              </tr>`;
            });
            t += `</tbody></table>`;
            return t;
          })()}
          <div class="dx-btn-group dx-btn-group-secondary">
            <button id="dx-sku-save" class="dx-btn primary" ${dianxiaomiState.busy ? "disabled" : ""}>保存 SKU 规划</button>
          </div>
        </div>
      </div>

      <!-- 事实编辑区 -->
      <div class="dx-card">
        <div class="dx-card-header">
          <span class="dx-card-title">📋 产品事实 JSON（可编辑）</span>
        </div>
        <div class="dx-card-body">
          <textarea id="dx-facts" class="dx-facts" placeholder="提取后的产品事实 JSON 会显示在此…"></textarea>
        </div>
      </div>

      <!-- 动态下一步指引 -->
      ${(() => {
        const hasImages = dianxiaomiState.previews.length > 0;
        const hasFacts = !!(dianxiaomiState.facts && dianxiaomiState.facts.trim());
        const isBusy = dianxiaomiState.busy;
        if (!hasImages && !hasFacts) {
          return `<div class="dx-next-step"><span class="dx-next-icon">①</span> <b>下一步</b>：先在上方上传产品图片（本地文件或 URL 均可），再点「AI 提取事实」</div>`;
        }
        if (hasImages && !hasFacts) {
          return `<div class="dx-next-step dx-next-warn"><span class="dx-next-icon">②</span> <b>下一步</b>：已导入 ${dianxiaomiState.previews.length} 张图片 👉 点击下方 <b>「AI 提取事实」</b></div>`;
        }
        if (hasFacts && !isBusy) {
          const skuNote = (dianxiaomiState.skuMatrix && dianxiaomiState.skuMatrix.length)
            ? `你在「SKU 规划」里配的 ${dianxiaomiState.skuMatrix.length} 个组合（颜色 / 自定义名 / 每色图）会一并带入上架。`
            : `上架前可先在「SKU 规划」配颜色 / 自定义名 / 每色图。`;
          return `<div class="dx-next-step dx-next-go"><span class="dx-next-icon">③</span> <b>下一步</b>：事实已提取 ✅ 现在点击上方 <b>Step 1 的 ★ 一键引用并覆盖填写</b> 完成整个流程！<br/><span class="dx-next-sub">（它会自动引用源产品 → 用这份资料文档覆盖填写 → 保存草稿，一气呵成）<br/>${skuNote}</span></div>`;
        }
        return "";
      })()}

      <!-- 状态 + 日志 -->
      <div class="dx-footer">
        <div id="dx-status" class="dx-status ${dianxiaomiState.statusKind}">${dianxiaomiState.status}</div>
        <pre id="dx-log" class="dx-log">${dianxiaomiState.log.join("\n") || "等待操作…"}</pre>
      </div>

      <p class="dx-hint">
        前提：店小秘需已登录（Chrome CDP :9223）。<br/>
        <b>品牌说明</b>：该品类品牌由「产品属性模板+同步品牌」派生，表单无独立 brand 输入，按模板同步。<br/>
        <b>每色图</b>：店小秘组合表无图列，每色图以实验方式挂到「颜色(Color)」字段的「选择图片」，绑定结果以日志为准，必要时可在店小秘手动校正。
      </p>
    </div>`;
  // 恢复滚动位置
  const logEl = document.getElementById("dx-log");
  if (logEl) logEl.scrollTop = dianxiaomiState.scrollTop;

  // 绑定事件
  document.getElementById("dx-refapply")?.addEventListener("click", () => void dxReferenceApply());
  document.getElementById("dx-refill")?.addEventListener("click", () => void dxReferenceFill());
  document.getElementById("dx-save")?.addEventListener("click", () => void dxSave());
  const profSel = document.getElementById("dx-profile");
  if (profSel) profSel.addEventListener("change", (e) => { dianxiaomiState.profileKey = e.target.value; dxLogLine("⋅ 类目已切换: " + e.target.value); });
  const tpl = document.getElementById("dx-tpl");
  if (tpl) tpl.addEventListener("keydown", (e) => { if (e.key === "Enter") void dxReferenceApply(); });
  // 首次渲染拉取可用类目 profile（箱包配件/乳贴）
  void dxLoadProfiles();

  // 上传绑定
  document.getElementById("dx-upload")?.addEventListener("click", () => void dxUploadImages(document.getElementById("dx-imgs")?.files || null));
  document.getElementById("dx-upload-url")?.addEventListener("click", () => void dxUploadImageUrls(document.getElementById("dx-urls")?.value || ""));
  document.getElementById("dx-extract")?.addEventListener("click", () => void dxExtractFacts());
  const factsTa = document.getElementById("dx-facts");
  document.getElementById("dx-apply")?.addEventListener("click", () => void dxApplyFacts(factsTa?.value || ""));
  if (factsTa) {
    factsTa.value = dianxiaomiState.facts;
    factsTa.addEventListener("input", (e) => { dianxiaomiState.facts = e.target.value; });
  }
  const urlsTa = document.getElementById("dx-urls");
  if (urlsTa) {
    urlsTa.value = dianxiaomiState.imageUrls;
    urlsTa.addEventListener("input", (e) => { dianxiaomiState.imageUrls = e.target.value; });
  }

  // 恢复焦点 + 光标位置（关键：否则每秒刷新会打断 textarea 连续输入）
  if (focusId) {
    const focused = document.getElementById(focusId);
    if (focused && typeof focused.focus === "function") {
      focused.focus();
      if (selStart !== null && typeof focused.setSelectionRange === "function") {
        try { focused.setSelectionRange(selStart, selEnd); } catch (_e) { /* ignore */ }
      }
    }
  }

  // Tab 切换绑定
  root.querySelectorAll(".dx-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      dianxiaomiState.uploadTab = tab.dataset.tab;
      renderDianxiaomiListing();
    });
  });

  // SKU 规划绑定
  const skuColorsEl = document.getElementById("dx-sku-colors");
  if (skuColorsEl) { skuColorsEl.value = dianxiaomiState.skuColors; skuColorsEl.addEventListener("input", (e) => { dianxiaomiState.skuColors = e.target.value; }); }
  const skuSizesEl = document.getElementById("dx-sku-sizes");
  if (skuSizesEl) { skuSizesEl.value = dianxiaomiState.skuSizes; skuSizesEl.addEventListener("input", (e) => { dianxiaomiState.skuSizes = e.target.value; }); }
  const skuPriceEl = document.getElementById("dx-sku-price");
  if (skuPriceEl) { skuPriceEl.value = dianxiaomiState.skuDefaultPrice; skuPriceEl.addEventListener("input", (e) => { dianxiaomiState.skuDefaultPrice = e.target.value; applySkuDefaults(); }); }
  const skuStockEl = document.getElementById("dx-sku-stock");
  if (skuStockEl) { skuStockEl.value = dianxiaomiState.skuDefaultStock; skuStockEl.addEventListener("input", (e) => { dianxiaomiState.skuDefaultStock = e.target.value; applySkuDefaults(); }); }
  const skuWeightEl = document.getElementById("dx-sku-weight");
  if (skuWeightEl) { skuWeightEl.value = dianxiaomiState.skuDefaultWeight; skuWeightEl.addEventListener("input", (e) => { dianxiaomiState.skuDefaultWeight = e.target.value; applySkuDefaults(); }); }
  document.getElementById("dx-sku-gen")?.addEventListener("click", () => void dxGenerateSkuMatrix());
  document.getElementById("dx-sku-load")?.addEventListener("click", () => void dxLoadSourceVariants());
  document.getElementById("dx-sku-save")?.addEventListener("click", () => void dxSaveVariants());
  if (dianxiaomiState.skuMatrix) {
    dianxiaomiState.skuMatrix.forEach((m, i) => {
      const pe = document.getElementById("sku-price-" + i);
      if (pe) pe.addEventListener("input", (e) => { m.price = e.target.value; m._priceEdited = true; });
      const se = document.getElementById("sku-stock-" + i);
      if (se) se.addEventListener("input", (e) => { m.stock = e.target.value; m._stockEdited = true; });
      const we = document.getElementById("sku-weight-" + i);
      if (we) we.addEventListener("input", (e) => { m.weight = e.target.value; m._weightEdited = true; });
      const ie = document.getElementById("sku-img-" + i);
      if (ie) ie.addEventListener("change", (e) => {
        m.image = e.target.value;
        dianxiaomiState.skuMatrix.forEach((o) => { if (o.color === m.color) o.image = e.target.value; });
      });
      const ce = document.getElementById("sku-customname-" + i);
      if (ce) ce.addEventListener("input", (e) => {
        m.customName = e.target.value;
        dianxiaomiState.skuColorCustomNames[m.color] = e.target.value;
      });
    });
  }
  // 节流拉取 listing 资料就绪状态（SOP 守卫可视化）
  dxCheckFactsStatus();
}

/* ───────────────────────── 批量流水线上架（Batch Listing，v1.4.0）───────────────────────── */
const batchListingState = { rows: [], uploaded: false, busy: false, active: false, summary: null, generated: "" };
let batchListingSig = "";
const BL_STATUS_LABEL = { idle: "待上架", running: "进行中", done: "成功", failed: "失败", skipped: "跳过" };

function blEscapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

function parseBatchCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return t !== "" && !t.startsWith("#");
  });
  if (!lines.length) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const idxName = Math.max(header.findIndex((h) => /packageName|产品包名|包名/i.test(h)), 0);
  const idxCat = header.findIndex((h) => /category|类目/i.test(h));
  const idxEn = header.findIndex((h) => /enabled|上架|启用/i.test(h));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const name = (cols[idxName] || "").trim();
    if (!name) continue;
    let category = idxCat >= 0 ? (cols[idxCat] || "").trim() : "";
    if (!category || category === "auto") category = "auto";
    let enabled = true;
    if (idxEn >= 0) {
      const ev = (cols[idxEn] || "").trim().toLowerCase();
      enabled = !(ev === "false" || ev === "0" || ev === "no");
    }
    rows.push({ packageName: name, category, enabled, status: "idle", progress: 0, reason: "" });
  }
  return rows;
}

function downloadXlsx(rows, filename) {
  try {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "上架表");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  } catch (_e) { /* ignore */ }
}

function parseBatchXlsx(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const wb = XLSX.read(data, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (!aoa || !aoa.length) return [];
  const header = (aoa[0] || []).map((h) => String(h || "").trim());
  const idxName = Math.max(header.findIndex((h) => /packageName|产品包名|包名/i.test(h)), 0);
  const idxCat = header.findIndex((h) => /category|类目/i.test(h));
  const idxEn = header.findIndex((h) => /enabled|上架|启用/i.test(h));
  const rows = [];
  for (let i = 1; i < aoa.length; i++) {
    const cols = aoa[i] || [];
    const name = String(cols[idxName] || "").trim();
    if (!name) continue;
    let category = idxCat >= 0 ? String(cols[idxCat] || "").trim() : "";
    if (!category || category === "auto") category = "auto";
    let enabled = true;
    if (idxEn >= 0) {
      const ev = String(cols[idxEn] || "").trim().toLowerCase();
      enabled = !(ev === "false" || ev === "0" || ev === "no" || ev === "否");
    }
    rows.push({ packageName: name, category, enabled, status: "idle", progress: 0, reason: "" });
  }
  return rows;
}

function downloadCsv(text, filename) {
  try {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (_e) { /* ignore */ }
}

async function batchGenerateSource() {
  try {
    const data = await request("/api/dianxiaomi/product-packages");
    const pkgs = (data.packages || []).filter((p) => p.hasFacts);
    const rows = [["packageName", "category", "enabled"]];
    for (const p of pkgs) rows.push([p.name, p.category, true]);
    downloadXlsx(rows, "批量上架数据源.xlsx");
  } catch (e) {
    alert("下载数据源表格失败：" + (e && e.message ? e.message : e));
  }
}

function batchDownloadTemplate() {
  downloadXlsx([
    ["packageName", "category", "enabled"],
    ["产品包名A", "", "true"]
  ], "批量上架模板.xlsx");
}

function batchOnFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const reader = new FileReader();
  reader.onload = () => {
    let rows = [];
    if (ext === "xlsx" || ext === "xls") {
      rows = parseBatchXlsx(reader.result);
    } else {
      rows = parseBatchCsv(String(reader.result || ""));
    }
    batchListingState.rows = rows;
    batchListingState.uploaded = rows.length > 0;
    batchListingState.busy = false;
    batchListingState.active = false;
    batchListingState.summary = null;
    renderBatchListing();
  };
  if (ext === "xlsx" || ext === "xls") reader.readAsArrayBuffer(file);
  else reader.readAsText(file);
}

async function batchStart() {
  if (!batchListingState.uploaded || batchListingState.busy) return;
  const rows = batchListingState.rows;
  if (!rows.length) { alert("请先生成或上传数据源表格"); return; }
  try {
    await request("/api/dianxiaomi/batch-apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: rows.map((r) => ({ packageName: r.packageName, category: r.category, enabled: r.enabled })) })
    });
    batchListingState.busy = true;
    batchListingState.active = true;
    batchListingState.summary = null;
  } catch (e) {
    alert("启动批量上架失败：" + (e && e.message ? e.message : e));
  }
}

async function batchRetry() {
  const failed = batchListingState.rows.filter((r) => r.status === "failed");
  if (!failed.length) return;
  try {
    await request("/api/dianxiaomi/batch-apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: failed.map((r) => ({ packageName: r.packageName, category: r.category, enabled: true })) })
    });
    for (const r of failed) { r.status = "idle"; r.progress = 0; r.reason = ""; }
    batchListingState.busy = true;
    batchListingState.active = true;
  } catch (e) {
    alert("重试失败：" + (e && e.message ? e.message : e));
  }
}

async function pollBatchStatus() {
  try {
    const data = await request("/api/dianxiaomi/batch-status");
    if (!data || !data.ok) return;
    const map = new Map((data.items || []).map((it) => [it.name, it]));
    for (const r of batchListingState.rows) {
      const it = map.get(r.packageName);
      if (it) { r.status = it.status; r.progress = it.progress; r.reason = it.reason || ""; }
    }
    if (data.summary) batchListingState.summary = data.summary;
    if (!data.running) { batchListingState.active = false; batchListingState.busy = false; }
  } catch (_e) { /* ignore */ }
}

function renderBatchListing() {
  const root = document.getElementById("batch-listing-root");
  if (!root) return;
  if (activeViewName() !== "batch-listing") return;
  if (batchListingState.active) void pollBatchStatus();
  const sig = JSON.stringify(batchListingState.rows.map((r) => [r.packageName, r.category, r.enabled, r.status, r.progress, r.reason]));
  if (sig === batchListingSig && root.dataset.rendered === "1") return;
  batchListingSig = sig;
  root.dataset.rendered = "1";
  const rows = batchListingState.rows;
  const hasFailed = rows.some((r) => r.status === "failed");
  const enabledCount = rows.filter((r) => r.enabled !== false).length;
  const catOpts = (val) => `
    <option value="auto" ${val === "auto" || !val ? "selected" : ""}>自动</option>
    <option value="ruTie" ${val === "ruTie" ? "selected" : ""}>乳贴</option>
    <option value="xiangBao" ${val === "xiangBao" ? "selected" : ""}>箱包</option>`;
  root.innerHTML = `
    <div class="bl-board">
      <div class="bl-overview">
        <div class="bl-overview-icon">📦</div>
          <div class="bl-overview-text">
            <b>批量流水线上架</b>：下载 .xlsx 数据源表格 → 在 Excel 里只保留要上架的行 → 上传 → 开始自动上架为草稿
            <span class="bl-overview-sub">表格三列：packageName(产品包名) / category(ruTie乳贴|xiangBao箱包|留空自动) / enabled(true上架|false跳过)</span>
          </div>
        </div>

        <div class="bl-card">
          <div class="bl-controls">
            <button id="bl-template" class="bl-btn ghost" ${batchListingState.busy ? "disabled" : ""}>📄 下载空白模板</button>
            <button id="bl-generate" class="bl-btn ghost" ${batchListingState.busy ? "disabled" : ""}>⚙ 下载数据源表格</button>
            <div class="bl-file-wrap">
              <input type="file" id="bl-file" accept=".xlsx,.xls,.csv" ${batchListingState.busy ? "disabled" : ""} />
              <span class="bl-hint">选择填好的 .xlsx（或 .csv）</span>
            </div>
            <button id="bl-start" class="bl-btn primary" ${(!batchListingState.uploaded || batchListingState.busy) ? "disabled" : ""}>▶ 开始批量上架</button>
            ${hasFailed ? `<button id="bl-retry" class="bl-btn ghost" ${batchListingState.busy ? "disabled" : ""}>↻ 重试失败项</button>` : ""}
          </div>
          <div class="bl-card-note">
            <span>💡 只上传你确认要上架的行即可；原“生成”按钮现在只下载不自动填表，避免一扫所有产品。</span>
          </div>
          ${batchListingState.busy ? `<div class="bl-hint">批量上架进行中，进度每秒刷新…</div>` : ""}
        </div>

      ${rows.length ? `
      <div class="bl-card">
        <table class="bl-table">
          <thead><tr><th>上架</th><th>产品包名</th><th>类目</th><th>状态</th><th>进度</th><th>说明</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td><input type="checkbox" class="bl-enabled" data-name="${blEscapeHtml(r.packageName)}" ${r.enabled !== false ? "checked" : ""} ${batchListingState.busy ? "disabled" : ""}/></td>
                <td>${blEscapeHtml(r.packageName)}</td>
                <td><select class="bl-cat" data-name="${blEscapeHtml(r.packageName)}" ${batchListingState.busy ? "disabled" : ""}>${catOpts(r.category)}</select></td>
                <td><span class="bl-badge ${r.status || "idle"}">${BL_STATUS_LABEL[r.status] || "待上架"}</span></td>
                <td><div class="progress"><span style="width:${Math.max(0, Math.min(100, r.progress || 0))}%"></span></div></td>
                <td class="bl-reason">${blEscapeHtml(r.reason || "")}</td>
              </tr>`).join("")}
          </tbody>
        </table>
        <div class="bl-hint">共 ${rows.length} 行，本次上架 ${enabledCount} 行</div>
      </div>` : `<div class="bl-hint">尚未导入表格。点击「下载空白模板」或「下载数据源表格」，在 Excel 里只保留要上架的行后上传。</div>`}

      ${(batchListingState.summary) ? `<div class="bl-summary">✅ 完成：成功 ${batchListingState.summary.success} · 失败 ${batchListingState.summary.failed} · 跳过 ${batchListingState.summary.skipped} / 共 ${batchListingState.summary.total}</div>` : ""}
    </div>`;

  document.getElementById("bl-template")?.addEventListener("click", () => void batchDownloadTemplate());
  document.getElementById("bl-generate")?.addEventListener("click", () => void batchGenerateSource());
  document.getElementById("bl-file")?.addEventListener("change", batchOnFile);
  document.getElementById("bl-start")?.addEventListener("click", () => void batchStart());
  document.getElementById("bl-retry")?.addEventListener("click", () => void batchRetry());
  root.querySelectorAll(".bl-cat").forEach((sel) => sel.addEventListener("change", (e) => {
    const name = e.target.dataset.name;
    const r = batchListingState.rows.find((x) => x.packageName === name);
    if (r) { r.category = e.target.value; renderBatchListing(); }
  }));
  root.querySelectorAll(".bl-enabled").forEach((cb) => cb.addEventListener("change", (e) => {
    const name = e.target.dataset.name;
    const r = batchListingState.rows.find((x) => x.packageName === name);
    if (r) { r.enabled = e.target.checked; renderBatchListing(); }
  }));
}

/* ───────────────────────── 爆款研究中心（Hit Product Research Center）───────────────────────── */
const RESEARCH_STATIC_HTML = `
  <div class="rc-overview">
    <div class="rc-overview-icon">🔥</div>
    <div class="rc-overview-text"><b>怎么用：</b>① 填来源/类目，上传主图+详情图（或贴商品 URL 自动截图）；② 填经营数据（销量/排名/评分，越全越准）；③ 点「导入爆款」；④ 在下方记录点「拆解」生成爆款因子报告。</div>
  </div>
  <div class="rc-discover">
    <h3>发现源 · 找把产品带火的社媒帖/视频</h3>
    <div class="rc-sub">输入产品词（或上传参考图供反向图搜手动用），在免费门户找强候选源 → 点「导入为爆款」直接进拆解流。定位是「候选 + 人工点选」，平台不公开传播链路，最先带火的那条仍需你眼确认。</div>
    <div class="rc-grid">
      <div class="rc-field full"><label>产品/关键词</label><input id="rcDiscQuery" type="text" placeholder="如 nipple cover / 隐形乳贴 / travel bag organizer"></div>
      <div class="rc-field full"><label>参考图（可选，用于反向图搜手动上传）</label><input id="rcDiscImages" type="file" accept="image/*" multiple></div>
    </div>
    <div class="rc-plats" id="rcDiscPlats">
      <span class="rc-plat on" data-plat="youtube">YouTube</span>
      <span class="rc-plat on" data-plat="tiktok">TikTok</span>
      <span class="rc-plat on" data-plat="meta-ads">Meta 广告库</span>
      <span class="rc-plat on" data-plat="google-images">Google 图片</span>
    </div>
    <div class="rc-actions">
      <button class="rc-btn" data-action="discover">开始发现</button>
      <span class="rc-status" id="rcDiscStatus"></span>
    </div>
    <div id="rcDiscResults" class="rc-disc-results"></div>
  </div>
  <div class="rc-form">
    <h3>导入爆款</h3>
    <div class="rc-grid">
      <div class="rc-field"><label>商品 URL（可选，自动截图）</label><input id="research-sourceUrl" type="text" placeholder="https://www.aliexpress.com/item/..."></div>
      <div class="rc-field"><label>平台</label><select id="research-platform"><option value="aliexpress">速卖通</option><option value="1688">1688</option><option value="amazon">亚马逊</option><option value="other">其他</option></select></div>
      <div class="rc-field"><label>类目</label><input id="research-category" type="text" placeholder="如 箱包配件 / 乳贴"></div>
      <div class="rc-field"><label>标题（可选）</label><input id="research-title" type="text"></div>
      <div class="rc-field"><label>品牌</label><input id="research-brand" type="text"></div>
      <div class="rc-field"><label>价格</label><input id="research-price" type="number" step="0.01" placeholder="如 9.9"></div>
      <div class="rc-field"><label>币种</label><input id="research-currency" type="text" placeholder="USD / CNY"></div>
      <div class="rc-field"><label>销量</label><input id="research-salesVolume" type="number" placeholder="如 5000"></div>
      <div class="rc-field"><label>排名</label><input id="research-salesRank" type="number" placeholder="类目排名，如 12"></div>
      <div class="rc-field"><label>评分</label><input id="research-rating" type="number" step="0.1" placeholder="如 4.8"></div>
      <div class="rc-field"><label>评价数</label><input id="research-reviewCount" type="number" placeholder="如 2300"></div>
      <div class="rc-field"><label>收藏/加购数</label><input id="research-wishlistCount" type="number"></div>
      <div class="rc-field full"><label>爆款图片（主图 + 详情图，可多选）</label><input id="research-images" type="file" accept="image/*" multiple></div>
    </div>
    <div class="rc-actions">
      <button class="rc-btn" id="research-import-btn" data-action="import">导入爆款</button>
      <span class="rc-status" id="researchStatus"></span>
    </div>
    <div class="rc-hint">提示：真实销量/排名平台常不直接展示，手填更准；给 URL 时系统会尝试自动截图并抓取标题/价格作为增强（失败不影响导入）。</div>
  </div>
    <div id="researchResults"></div>
  <div class="rc-factors">
    <h3>跨品爆款因子库 <span class="rc-fac-count" id="rcFacTotal"></span></h3>
    <div class="rc-sub">把已拆解爆款的因子跨品聚合，按「出现频次 × 平均权重」排名。点维度筛选；出现越多、权重越高，越值得复制到自有 listing。</div>
    <div class="rc-fac-dims" id="rcFacDims"></div>
    <div id="rcFacResults" class="rc-fac-results"></div>
  </div>
`;

let researchInited = false;
let researchSelectedId = null;
let researchRendering = false;
let researchResultsSig = "";

function rcEscapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}
function rcStatusLabel(s) {
    return { imported: "已导入", analyzing: "拆解中", analyzed: "已拆解", analyze_failed: "失败" }[s] || s;
}
function rcRepLabel(s) {
    return { copy: "可直接复制", adapt: "需微调", reference: "仅参考" }[s] || s;
}
function rcImgUrl(id, assetId, sha) {
    return `/api/research/${encodeURIComponent(id)}/image/${encodeURIComponent(assetId)}?v=${(sha || "").slice(0, 8)}`;
}
function rcVal(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : "";
}
function rcNum(id) {
    const v = rcVal(id);
    if (v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
}
function rcStatus(msg, kind) {
    const el = document.getElementById("researchStatus");
    if (el) { el.textContent = msg; el.className = "rc-status " + (kind || ""); }
}
function safeResearchProducts() {
    return request("/api/research/products").catch(() => []);
}
function rcEvidenceHtml(ev) {
    if (!ev) return "";
    const imgs = (ev.images || []).filter(Boolean);
    const mets = (ev.metrics || []).filter(Boolean);
    if (!imgs.length && !mets.length) return "";
    const parts = [];
    if (imgs.length) parts.push("证据图：" + imgs.join("、"));
    if (mets.length) parts.push("数据：" + mets.join("；"));
    return `<div class="rc-evidence">${rcEscapeHtml(parts.join(" ｜ "))}</div>`;
}
function rcBuildReportHtml(a) {
    let h = "";
    if (a.summary) h += `<div class="rc-summary">${rcEscapeHtml(a.summary)}</div>`;
    const cb = a.categoryBenchmark || {};
    if (cb.category || cb.visualBaseline || cb.priceBand) {
        h += `<div class="rc-evidence">类目基准：${rcEscapeHtml([cb.category, cb.visualBaseline, cb.priceBand].filter(Boolean).join(" ｜ "))}</div>`;
    }
    for (const f of (a.hitFactors || [])) {
        h += `<div class="rc-factor">
      <div class="rc-factor-top">
        <span class="rc-dim ${f.dimension}">${f.dimension}</span>
        <span class="rc-factor-name">${rcEscapeHtml(f.name)}</span>
        <span class="rc-w">权重 ${f.weight}/5</span>
        <span class="rc-rep ${f.replicability}">${rcRepLabel(f.replicability)}</span>
      </div>
      ${f.note ? `<div class="rc-factor-note">${rcEscapeHtml(f.note)}</div>` : ""}
      ${rcEvidenceHtml(f.evidence)}
    </div>`;
    }
    if ((a.recommendations || []).length) {
        h += `<div style="margin-top:10px;font-size:13px;font-weight:600;color:#0f172a">对自有 listing 的建议</div>`;
        for (const r of a.recommendations) h += `<div class="rc-rec">${rcEscapeHtml(r)}</div>`;
    }
    return h;
}
function renderResearchResults(products) {
    const results = document.getElementById("researchResults");
    if (!results) return;
    // 签名守卫：选中态/记录 id+状态 未变则跳过 innerHTML 重建，避免每秒刷新导致图片闪烁与 CPU 浪费
    const sig = JSON.stringify([researchSelectedId, (products || []).map((p) => [p.id, p.status])]);
    if (sig === researchResultsSig) return;
    researchResultsSig = sig;
    if (!products || !products.length) {
        results.innerHTML = `<div class="rc-empty">还没有爆款记录。在上方导入第一个爆款（图片 + 经营数据），点「拆解」即可生成爆款因子报告。</div>`;
        return;
    }
    let html = "";
    for (const p of products) {
        const sub = [p.identity && p.identity.title, p.sourcePlatform, p.category].filter(Boolean).join(" · ") || "(未命名)";
        const thumbs = (p.images && p.images.analysis || []).slice(0, 6)
            .map((a) => `<div class="rc-thumb"><img src="${rcImgUrl(p.id, a.assetId, a.sha256)}" loading="lazy"></div>`)
            .join("");
        const expanded = researchSelectedId === p.id;
        html += `<div class="rc-card">
      <div class="rc-card-header" data-action="view" data-id="${p.id}">
        <div class="rc-card-title">${rcEscapeHtml(sub)}</div>
        <span class="rc-badge ${p.status}">${rcStatusLabel(p.status)}</span>
      </div>`;
        if (expanded) {
            html += `<div class="rc-card-body">`;
            if (thumbs) html += `<div class="rc-thumbs">${thumbs}</div>`;
            if (p.status === "analyzed" && p.analysis) html += rcBuildReportHtml(p.analysis);
            else if (p.status === "analyzing") html += `<div class="rc-empty">拆解中…（ChatGPT 多模态分析中，约 1–3 分钟，本页会自动刷新）</div>`;
            else if (p.status === "analyze_failed") html += `<div class="rc-empty" style="color:#dc2626">拆解失败：${rcEscapeHtml(p.error || "")}</div>`;
            else html += `<div class="rc-empty">已导入，点「拆解」运行爆款因子分析。</div>`;
            html += `<div class="rc-actions">
        ${p.status !== "analyzing" ? `<button class="rc-btn" data-action="analyze" data-id="${p.id}">${p.status === "analyzed" ? "重新拆解" : "拆解"}</button>` : ""}
        <button class="rc-btn ghost" data-action="delete" data-id="${p.id}">删除</button>
        <button class="rc-btn ghost" data-action="close" data-id="${p.id}">收起</button>
      </div></div>`;
        } else {
            html += `<div class="rc-card-body"><div class="rc-actions">
        <button class="rc-btn" data-action="analyze" data-id="${p.id}">拆解</button>
        <button class="rc-btn ghost" data-action="view" data-id="${p.id}">查看</button>
        <button class="rc-btn ghost" data-action="delete" data-id="${p.id}">删除</button>
      </div></div>`;
        }
        html += `</div>`;
    }
    results.innerHTML = html;
}

function rcFacDimLabel(d) {
    return { visual: "视觉", data: "数据", content: "内容", price: "价格", review: "评价" }[d] || d;
}
let rcFactorDim = "all";
let rcFactorRendering = false;
let rcFactorSig = "";
function rcFacBar(share) {
    const pct = Math.max(2, Math.round((share || 0) * 100));
    return `<div class="rc-fac-bar"><span style="width:${pct}%"></span></div>`;
}
function rcFacBuildHtml(data) {
    const total = data.total || 0;
    if (!total) {
        return `<div class="rc-empty">还没有可聚合的拆解报告。先在上方导入并「拆解」至少 1 个爆款，因子库会自动生成。</div>`;
    }
    const dims = ["all", "visual", "data", "content", "price", "review"];
    let html = `<div class="rc-fac-dims">` +
        dims.map((d) => `<span class="rc-fac-dim ${rcFactorDim === d ? "on" : ""}" data-dim="${d}">${d === "all" ? "全部" : rcFacDimLabel(d)}</span>`).join("") +
        `</div>`;
    const list = rcFactorDim === "all" ? (data.factors || []) : (data.byDimension[rcFactorDim] || []);
    if (!list.length) {
        html += `<div class="rc-empty">该维度暂无因子。</div>`;
        return html;
    }
    for (const f of list) {
        const ex = (f.examples || []).map((e) => `<span class="rc-fac-ex" title="${rcEscapeHtml(e.title)}">${rcEscapeHtml(e.title || "(未命名)")}</span>`).join("");
        const mets = (f.metrics || []).slice(0, 4).map((m) => `<span class="rc-fac-m">${rcEscapeHtml(m)}</span>`).join("");
        html += `<div class="rc-fac-card">
      <div class="rc-fac-top">
        <span class="rc-dim ${f.dimension}">${f.dimension}</span>
        <span class="rc-factor-name">${rcEscapeHtml(f.name)}</span>
        <span class="rc-w">频次 ${f.count}/${total} · 均权 ${f.avgWeight}</span>
        <span class="rc-rep ${f.replicability}">${rcRepLabel(f.replicability)}</span>
      </div>
      <div class="rc-fac-share"><span class="rc-fac-pct">${Math.round(f.share * 100)}%</span>${rcFacBar(f.share)}</div>
      ${mets ? `<div class="rc-fac-mets">${mets}</div>` : ""}
      ${ex ? `<div class="rc-fac-exs"><span class="rc-fac-ex-label">出现在：</span>${ex}</div>` : ""}
    </div>`;
    }
    return html;
}
async function renderResearchFactorLibrary() {
    const root = document.getElementById("rcFacResults");
    if (!root) return;
    if (rcFactorRendering) return;
    rcFactorRendering = true;
    try {
        const data = await request("/api/research/factors").catch(() => ({ total: 0, factors: [], byDimension: {} }));
        // 签名守卫：维度筛选 + 因子聚合结果未变则跳过重建，避免每秒刷新抖动
        const sig = JSON.stringify([rcFactorDim, data.total, (data.factors || []).map((f) => [f.key, f.count, f.avgWeight])]);
        if (sig === rcFactorSig) return;
        rcFactorSig = sig;
        root.innerHTML = rcFacBuildHtml(data);
        const t = document.getElementById("rcFacTotal");
        if (t) t.textContent = data.total ? `（基于 ${data.total} 个已拆解爆款）` : "";
    }
    catch (_e) { /* 静默，下一轮重试 */ }
    finally { rcFactorRendering = false; }
}

function resetResearchImportForm() {
    ["research-sourceUrl", "research-category", "research-title", "research-brand", "research-price", "research-currency", "research-salesVolume", "research-salesRank", "research-rating", "research-reviewCount", "research-wishlistCount"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
    const fi = document.getElementById("research-images");
    if (fi) fi.value = "";
    const plat = document.getElementById("research-platform");
    if (plat) plat.selectedIndex = 0;
}
async function onResearchImport() {
    const fd = new FormData();
    fd.append("sourceUrl", rcVal("research-sourceUrl"));
    fd.append("platform", rcVal("research-platform"));
    fd.append("category", rcVal("research-category"));
    const metrics = {
        title: rcVal("research-title"),
        brand: rcVal("research-brand"),
        price: rcNum("research-price"),
        currency: rcVal("research-currency"),
        salesVolume: rcNum("research-salesVolume"),
        salesRank: rcNum("research-salesRank"),
        rating: rcNum("research-rating"),
        reviewCount: rcNum("research-reviewCount"),
        wishlistCount: rcNum("research-wishlistCount")
    };
    fd.append("metrics", JSON.stringify(metrics));
    const fileInput = document.getElementById("research-images");
    if (fileInput) for (const f of fileInput.files) fd.append("images", f, f.name);
    rcStatus("导入中…", "busy");
    try {
        await request("/api/research/import", { method: "POST", body: fd });
        rcStatus("已导入，可在下方点「拆解」", "ok");
        resetResearchImportForm();
        await refreshTwice();
    }
    catch (err) {
        rcStatus("导入失败：" + err.message, "err");
    }
}
async function onResearchAnalyze(id) {
    try {
        await request(`/api/research/${encodeURIComponent(id)}/analyze`, {
            method: "POST", headers: { "content-type": "application/json" }, body: "{}"
        });
        rcStatus("已启动拆解…", "busy");
        await refreshTwice();
    }
    catch (err) {
        rcStatus("拆解启动失败：" + err.message, "err");
    }
}
async function onResearchDelete(id) {
    try {
        await request(`/api/research/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (researchSelectedId === id) researchSelectedId = null;
        await refreshTwice();
    }
    catch (err) {
        rcStatus("删除失败：" + err.message, "err");
    }
}
// ===== 发现源（二阶段）前端 =====
const PLAT_LABELS = { youtube: "YouTube（按播放量）", tiktok: "TikTok 视频", "meta-ads": "Meta 广告库", "google-images": "Google 图片" };
let rcDiscSelectedPlats = new Set(["youtube", "tiktok", "meta-ads", "google-images"]);
let rcDiscPollTimer = null;

function rcDiscStatus(msg, kind) {
    const el = document.getElementById("rcDiscStatus");
    if (el) { el.textContent = msg; el.className = "rc-status " + (kind || ""); }
}
function rcDiscShotUrl(sessionId, platform) {
    return `/api/research/discover/${encodeURIComponent(sessionId)}/shot/${encodeURIComponent(platform)}`;
}
function renderDiscoverResults(sessionId, data) {
    const box = document.getElementById("rcDiscResults");
    if (!box) return;
    const portals = (data.portals || []).filter((p) => (p.candidates && p.candidates.length) || p.screenshot);
    const flat = data.candidates || [];
    let html = "";
    if (data.status === "running") {
        html += `<div class="rc-empty">发现中…（正在打开门户页并抓候选，约 30–90 秒，本区会自动刷新）</div>`;
    } else if (data.status === "failed") {
        html += `<div class="rc-empty" style="color:#dc2626">发现失败：${rcEscapeHtml(data.error || "")}</div>`;
    } else if (!flat.length && !portals.length) {
        html += `<div class="rc-empty">没抓到候选。可点下方门户深链手动浏览，或换更具体的关键词。</div>`;
    }
    for (const p of portals) {
        html += `<div class="rc-portal">
      <div class="rc-portal-head"><b>${rcEscapeHtml(PLAT_LABELS[p.platform] || p.label || p.platform)}</b>
        <a href="${rcEscapeHtml(p.url)}" target="_blank" rel="noopener">打开门户 ↗</a></div>`;
        if (p.screenshot) html += `<img class="rc-portal-shot" src="${rcDiscShotUrl(sessionId, p.platform)}" loading="lazy">`;
        if (p.candidates && p.candidates.length) {
            html += `<div class="rc-cards">`;
            for (const c of p.candidates) {
                const meta = c.metrics && (c.metrics.info || c.metrics.views || c.metrics.likes) ? (c.metrics.info || [c.metrics.views, c.metrics.likes].filter(Boolean).join(" · ")) : "";
                html += `<div class="rc-cand">
          ${c.thumb ? `<img src="${rcEscapeHtml(c.thumb)}" loading="lazy" referrerpolicy="no-referrer">` : `<div style="height:140px;background:#f1f5f9"></div>`}
          <div class="rc-cand-body">
            <div class="rc-cand-title">${rcEscapeHtml(c.title || "(无标题)")}</div>
            ${meta ? `<div class="rc-cand-meta">${rcEscapeHtml(meta)}</div>` : ""}
            <a class="rc-cand-meta" href="${rcEscapeHtml(c.url)}" target="_blank" rel="noopener">查看原帖 ↗</a>
            <button class="rc-btn" data-action="disc-import" data-url="${rcEscapeHtml(c.url)}" data-plat="${rcEscapeHtml(c.platform || p.platform)}" data-title="${rcEscapeHtml(c.title || "")}">导入为爆款</button>
          </div>
        </div>`;
            }
            html += `</div>`;
        }
    }
    // 反向图搜 + 趋势门户深链（人工浏览）
    const extra = [...(data.reversePortals || []), ...(data.trendPortals || [])];
    if (extra.length) {
        html += `<div class="rc-portal"><div class="rc-portal-head"><b>反向图搜 / 趋势门户（手动浏览）</b></div><div class="rc-hint">`;
        html += extra.map((l) => `<a href="${rcEscapeHtml(l.url)}" target="_blank" rel="noopener" style="color:#2563eb;margin-right:14px">${rcEscapeHtml(l.label)} ↗</a>`).join("");
        html += `</div></div>`;
    }
    box.innerHTML = html;
}
async function pollDiscover(sessionId) {
    if (rcDiscPollTimer) { clearInterval(rcDiscPollTimer); rcDiscPollTimer = null; }
    const tick = async () => {
        let data;
        try { data = await request(`/api/research/discover/${encodeURIComponent(sessionId)}`); }
        catch (_e) { return; }
        renderDiscoverResults(sessionId, data);
        if (data.status !== "running") {
            if (rcDiscPollTimer) { clearInterval(rcDiscPollTimer); rcDiscPollTimer = null; }
            rcDiscStatus(data.status === "done" ? `发现完成，共 ${(data.candidates || []).length} 个候选` : "发现失败", data.status === "done" ? "ok" : "err");
        }
    };
    await tick();
    rcDiscPollTimer = window.setInterval(tick, 3000);
}
async function onResearchDiscover() {
    const query = rcVal("rcDiscQuery");
    const fileInput = document.getElementById("rcDiscImages");
    const hasFiles = fileInput && fileInput.files.length;
    if (!query && !hasFiles) { rcDiscStatus("请填写关键词或上传参考图", "err"); return; }
    const fd = new FormData();
    fd.append("query", query);
    fd.append("platforms", JSON.stringify([...rcDiscSelectedPlats]));
    if (fileInput) for (const f of fileInput.files) fd.append("images", f, f.name);
    rcDiscStatus("启动发现…", "busy");
    const box = document.getElementById("rcDiscResults");
    if (box) box.innerHTML = `<div class="rc-empty">发现中…</div>`;
    try {
        const res = await request("/api/research/discover", { method: "POST", body: fd });
        if (res && res.sessionId) await pollDiscover(res.sessionId);
    }
    catch (err) {
        rcDiscStatus("发现失败：" + err.message, "err");
    }
}
async function onDiscoverImport(url, platform, title) {
    const fd = new FormData();
    fd.append("sourceUrl", url || "");
    fd.append("platform", platform || "other");
    fd.append("category", rcVal("research-category"));
    fd.append("metrics", JSON.stringify({ title: title || "" }));
    rcDiscStatus("导入中…（将自动截图抓取）", "busy");
    try {
        await request("/api/research/import", { method: "POST", body: fd });
        rcDiscStatus("已导入到下方记录，可点「拆解」", "ok");
        await refreshTwice();
    }
    catch (err) {
        rcDiscStatus("导入失败：" + err.message, "err");
    }
}

function wireResearchStatic(root) {
    root.addEventListener("click", async (e) => {
        const plat = e.target.closest(".rc-plat");
        if (plat) {
            const p = plat.dataset.plat;
            if (rcDiscSelectedPlats.has(p)) rcDiscSelectedPlats.delete(p);
            else rcDiscSelectedPlats.add(p);
            plat.classList.toggle("on");
            return;
        }
        const facDim = e.target.closest(".rc-fac-dim");
        if (facDim) {
            rcFactorDim = facDim.dataset.dim;
            renderResearchFactorLibrary();
            return;
        }
        const t = e.target.closest("[data-action]");
        if (!t) return;
        const action = t.dataset.action;
        const id = t.dataset.id;
        if (action === "import") await onResearchImport();
        else if (action === "discover") await onResearchDiscover();
        else if (action === "disc-import") await onDiscoverImport(t.dataset.url, t.dataset.plat, t.dataset.title);
        else if (action === "analyze") await onResearchAnalyze(id);
        else if (action === "view") { researchSelectedId = researchSelectedId === id ? null : id; renderResearchResults(await safeResearchProducts()); }
        else if (action === "close") { researchSelectedId = null; renderResearchResults(await safeResearchProducts()); }
        else if (action === "delete") { if (window.confirm("确认删除该爆款记录？")) await onResearchDelete(id); }
    });
}
async function renderResearchCenter() {
    const root = document.getElementById("research-root");
    if (!root) return;
    if (activeViewName() !== "research-center") return;
    if (!researchInited) {
        root.innerHTML = RESEARCH_STATIC_HTML;
        wireResearchStatic(root);
        researchInited = true;
    }
    if (researchRendering) return;
    researchRendering = true;
    try {
        renderResearchResults(await safeResearchProducts());
        await renderResearchFactorLibrary();
    }
    catch (_err) { /* 静默，下一秒重试 */ }
    finally { researchRendering = false; }
}

async function refresh() {
  try {
    render(await request("/api/status"));
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  }
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function refreshTwice(delay = 350) {
  await refresh();
  await wait(delay);
  await refresh();
}

async function importImages(files) {
  const valid = [...files].filter((file) =>
    /\.(jpe?g|png|webp)$/i.test(file.name)
  );
  if (valid.length === 0) {
    elements.folderHint.textContent = "没有选择支持的图片";
    return;
  }

  const oversized = valid.filter((file) => file.size > 15 * 1024 * 1024);
  if (oversized.length > 0) {
    elements.folderHint.textContent = `有 ${oversized.length} 张图片超过 15 MB，请压缩后重试`;
    return;
  }

  elements.folderHint.textContent = `正在导入 ${valid.length} 张图片…`;
  try {
    let imported = 0;
    let skipped = 0;
    const batchSize = 10;
    for (let index = 0; index < valid.length; index += batchSize) {
      const batch = valid.slice(index, index + batchSize);
      const form = new FormData();
      batch.forEach((file) => form.append("images", file, file.name));
      elements.folderHint.textContent = `正在导入 ${Math.min(index + batch.length, valid.length)} / ${valid.length}…`;
      const body = await request("/api/import-images", {
        method: "POST",
        body: form
      });
      imported += body.result.imported.length;
      skipped += body.result.skippedDuplicates.length;
    }
    elements.folderHint.textContent = `已导入 ${imported} 张，跳过 ${skipped} 张重复图片`;
    await refresh();
  } catch (error) {
    elements.folderHint.textContent = `导入失败：${error.message}`;
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  }
}

async function importInsertBagImages(files) {
  const valid = [...files].filter((file) => /\.(jpe?g|png|webp)$/i.test(file.name));
  if (!valid.length) return;
  const form = new FormData();
  valid.forEach((file) => form.append("images", file, file.name));
  await request("/api/insert/bag-images", { method: "POST", body: form });
  await refreshTwice();
}

async function uploadLinerImage(variantId, file) {
  const form = new FormData();
  form.append("variantId", variantId);
  form.append("image", file, file.name);
  try {
    await request("/api/insert/liner-images", { method: "POST", body: form });
    await refreshTwice();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  }
}

async function importInsertBagImageUrls() {
  const urls = elements.insertBagUrls.value
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean);
  if (!urls.length) {
    elements.insertBagUrlHint.textContent = "请至少输入一个图片 URL";
    return;
  }
  elements.importInsertBagUrlsButton.disabled = true;
  elements.insertBagUrlHint.textContent = `正在下载 ${urls.length} 张图片…`;
  try {
    const body = await request("/api/insert/bag-image-urls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls })
    });
    elements.insertBagUrlHint.textContent =
      `已导入 ${body.result.imported.length} 张，跳过 ${body.result.skippedDuplicates.length} 张，失败 ${body.result.rejected.length} 条`;
    if (!body.result.rejected.length) elements.insertBagUrls.value = "";
    await refresh();
  } catch (error) {
    elements.insertBagUrlHint.textContent = `URL 导入失败：${error.message}`;
  } finally {
    elements.importInsertBagUrlsButton.disabled = false;
  }
}

async function uploadLinerImageUrl(variantId, url, button) {
  if (!url.trim()) return;
  button.disabled = true;
  try {
    await request("/api/insert/liner-image-url", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantId, url: url.trim() })
    });
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function removeLinerImage(variantId, button) {
  button.disabled = true;
  try {
    await request(
      `/api/insert/liner-images/${encodeURIComponent(variantId)}`,
      { method: "DELETE" }
    );
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

/* ── 内胆细节图：上传 / URL导入 / 删除 ── */
async function uploadLinerDetailImages(variantId, files, button) {
  if (!files.length) return;
  if (button) { button.disabled = true; button.textContent = "上传中…"; }
  try {
    const form = new FormData();
    form.append("variantId", variantId);
    for (const file of files) form.append("images", file, file.name);
    await request("/api/insert/liner-detail-images", { method: "POST", body: form });
    await refreshTwice();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    if (button) { button.disabled = false; button.textContent = "+ 添加细节图"; }
  }
}

async function uploadLinerDetailImageUrls(variantId, rawText, button) {
  const urls = rawText.split(/\r?\n/).map((u) => u.trim()).filter(Boolean);
  if (!urls.length) return;
  if (button) { button.disabled = true; button.textContent = "下载中…"; }
  try {
    await request("/api/insert/liner-detail-image-urls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ variantId, urls })
    });
    /* 清空输入框（调用者负责 DOM 引用） */
    if (button?.previousElementSibling?.value !== undefined) {
      button.previousElementSibling.value = "";
    }
    await refreshTwice();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    if (button) { button.disabled = false; button.textContent = "URL 导入"; }
  }
}

async function removeLinerDetailImage(variantId, imageName, button) {
  if (button) button.disabled = true;
  try {
    await request(
      `/api/insert/liner-detail-images/${encodeURIComponent(variantId)}/${encodeURIComponent(imageName)}`,
      { method: "DELETE" }
    );
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
}

async function selectWorkflowMode(mode) {
  try {
    await request("/api/workflow-mode", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode })
    });
    lastBagVariantSignature = undefined;
    lastDesignVariantSignature = undefined;
    if (mode === "luxury_insert") {
      showInsertEditor();
    } else if (!activeViewName()) {
      switchView("materials");
    }
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  }
}

async function selectStandardWorkflowGoal(goal) {
  try {
    await request("/api/standard-workflow-goal", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal })
    });
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  }
}

async function selectMarketRadarCandidate(candidateId, button) {
  button.disabled = true;
  try {
    await request("/api/insert/market-radar/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidateId })
    });
    await refreshTwice();
    /* 若当前在 selection-radar 视图，滚动到导入面板；否则滚动到识别步骤 */
    const importPanel = document.getElementById("selectionRadarImportPanel");
    if (importPanel && !importPanel.classList.contains("hidden")) {
      importPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      elements.insertIdentifyButton?.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
    }
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function returnToMarketRadarPool() {
  const confirmed = window.confirm(
    "确认放弃当前包型开发并返回市场雷达候选池吗？\n\n已生成的识别、NotebookLM、Prompt 和图片会被移入回撤备份；每日市场选款结果会保留，你可以直接选择另一个包型继续开发。"
  );
  if (!confirmed) return;
  elements.returnMarketRadarButton.disabled = true;
  try {
    await request("/api/insert/market-radar/return", { method: "POST" });
    await refresh();
    /* 候选列表现在在 selection-radar 视图中，跳转过去 */
    switchView("selection-radar");
    requestAnimationFrame(() => {
      elements.insertMarketRadarCandidates?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    elements.returnMarketRadarButton.disabled = false;
  }
}

async function resetInsertMarketRadar() {
  const confirmed = window.confirm(
    "确认重置每日市场选款吗？\n\n当前市场雷达结果和候选选择会从工作台清空，归档商品不会触发此操作。"
  );
  if (!confirmed) return;
  elements.resetInsertMarketRadarButton.disabled = true;
  try {
    await request("/api/insert/market-radar/reset", { method: "POST" });
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    elements.resetInsertMarketRadarButton.disabled = false;
  }
}

async function confirmInsertBag() {
  const variants = collectBagVariants();
  const primary = variants.find((variant) => variant.primary) || variants[0];
  try {
    await request("/api/insert/bag-confirmation", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brand: elements.insertBrand.value,
        bagFamily: elements.insertBagFamily.value,
        primaryVariantId: primary?.id,
        variants: variants.map(({ primary: _primary, ...variant }) => variant)
      })
    });
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  }
}

async function freezeInsertDesign() {
  const variants = latestPayload?.state?.luxuryInsert?.variants || [];
  const claims = Object.fromEntries(
    elements.claimInputs.map((input) => [input.dataset.claim, input.checked])
  );
  try {
    await request("/api/insert/design-freeze", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        variants: collectDesignVariants(variants),
        claims
      })
    });
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  }
}

async function unlockInsertBag() {
  const confirmed = window.confirm(
    "返回修改包型尺寸会重置 NotebookLM 方案和生图进度。已生成图片与旧 Prompt 会保存到“回撤备份”，上传素材不会删除。继续吗？"
  );
  if (!confirmed) return;
  try {
    await request("/api/insert/bag-confirmation/unlock", { method: "POST" });
    lastBagVariantSignature = undefined;
    lastDesignVariantSignature = undefined;
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  }
}

async function unlockInsertDesign() {
  const confirmed = window.confirm(
    "返回修改内胆方案会重置生图进度。已生成图片与旧 Prompt 会保存到“回撤备份”，NotebookLM 结果和上传素材不会删除。继续吗？"
  );
  if (!confirmed) return;
  try {
    await request("/api/insert/design-freeze/unlock", { method: "POST" });
    lastDesignVariantSignature = undefined;
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  }
}

async function importImageUrls() {
  const urls = elements.imageUrls.value
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean);
  if (urls.length === 0) {
    elements.urlImportHint.textContent = "请至少输入一个图片 URL";
    return;
  }

  elements.importUrlsButton.disabled = true;
  elements.urlImportHint.textContent = `正在下载并校验 ${urls.length} 个 URL…`;
  try {
    const body = await request("/api/import-image-urls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls })
    });
    const imported = body.result.imported.length;
    const skipped = body.result.skippedDuplicates.length;
    const rejected = body.result.rejected.length;
    elements.urlImportHint.textContent =
      `已导入 ${imported} 张，跳过 ${skipped} 张重复图片，失败 ${rejected} 条`;
    if (rejected === 0) elements.imageUrls.value = "";
    await refresh();
  } catch (error) {
    elements.urlImportHint.textContent = `URL 导入失败：${error.message}`;
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    elements.importUrlsButton.disabled = false;
  }
}

async function runAction(button, url) {
  button.disabled = true;
  try {
    await request(url, { method: "POST" });
    await refreshUntilRunVisible();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function archiveInsertProduct() {
  elements.archiveInsertButton.disabled = true;
  try {
    const body = await request("/api/insert/archive", { method: "POST" });
    await refresh();
    renderArchiveNextActions(body.productId, "内胆任务已归档");
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    elements.archiveInsertButton.disabled = false;
  }
}

async function refreshUntilRunVisible() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await refresh();
    const state = latestPayload?.state || {};
    if (
      state.running ||
      state.stage === "FAILED" ||
      state.stage === "PAUSED" ||
      state.stage === "COMPLETED"
    ) {
      return;
    }
    await wait(350);
  }
  await refresh();
}

async function selectProvider(provider, button) {
  if (button.classList.contains("active")) return;
  const confirmed =
    !elements.chatStatus.textContent.includes("未连接") &&
    window.confirm(
      `切换到 ${provider === "gemini" ? "Gemini" : "ChatGPT"} 后，将新建对话并迁移当前商品图片和已完成内容。继续吗？`
    );
  if (confirmed === false) return;

  elements.providerOptions.forEach((option) => {
    option.disabled = true;
  });
  try {
    await request("/api/provider", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider })
    });
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    elements.providerOptions.forEach((option) => {
      option.disabled = false;
    });
  }
}

async function startNextProduct() {
  const confirmed = window.confirm(
    "将归档当前产品图、输出图片和运行状态，然后清空当前工作区。继续吗？"
  );
  if (!confirmed) return;

  elements.nextProductButton.disabled = true;
  try {
    const body = await request("/api/product/next", { method: "POST" });
    renderArchiveNextActions(body.productId, `上一商品已归档到：${body.archiveDirectory}`);
    await refresh();
    await loadProductLibrary();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    elements.nextProductButton.disabled = false;
  }
}

function renderArchiveNextActions(productId, message) {
  elements.archiveHint.classList.remove("hidden");
  const text = document.createElement("span");
  text.textContent = message;
  const actions = document.createElement("div");
  actions.className = "row-actions";
  if (productId) {
    [
      ["查看商品经营档案", () => void openProductHub(productId, { tab: "overview" })],
      ["去上架接入", () => jumpToProductListing(productId)],
      ["进入商品经营", () => void openProductHub(productId, { tab: "overview" })]
    ].forEach(([label, action]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button secondary compact-button";
      button.textContent = label;
      button.addEventListener("click", action);
      actions.append(button);
    });
  }
  elements.archiveHint.replaceChildren(text, actions);
}

async function abandonCurrentProduct(sourceButton = elements.dockAbandonButton) {
  const state = latestPayload?.state || {};
  const queue = latestPayload?.queue || {};
  const running = Boolean(state.running || state.autoRun || queue.status === "running" || queue.status === "preparing");
  if (running) {
    const confirmedPause = window.confirm(
      "当前任务仍在运行。遗弃前必须先安全暂停，是否现在请求暂停？\n\n暂停完成后再点一次“遗弃当前商品”。"
    );
    if (!confirmedPause) return;
    sourceButton.disabled = true;
    try {
      await request("/api/task/pause", { method: "POST" });
      await refreshTwice();
    } catch (error) {
      elements.errorBox.classList.remove("hidden");
      elements.errorBox.textContent = error.message;
    } finally {
      sourceButton.disabled = false;
    }
    return;
  }
  const isQueueProduct = Boolean(queue.currentTaskId);
  const hasNext = (queue.tasks || []).some((task) => task.status === "ready");
  const confirmed = window.confirm(
    isQueueProduct
      ? hasNext
        ? "确认遗弃当前队列商品吗？未完成结果会保存在该队列任务目录中，不进入正式完成商品库。系统将继续下一个队列商品。"
        : "确认遗弃当前队列商品吗？未完成结果会保存在该队列任务目录中，不进入正式完成商品库。"
      : "确认遗弃当前商品吗？未完成图片、文案、商品档案和运行状态会保存到“已遗弃产品”目录，但不会进入正式完成商品库。当前工作区将被清空，以便开始新商品。"
  );
  if (!confirmed) return;

  sourceButton.disabled = true;
  elements.dockAbandonButton.disabled = true;
  elements.insertAbandonTaskButton.disabled = true;
  try {
    const body = await request("/api/task/abandon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ continueQueue: true })
    });
    elements.archiveHint.textContent =
      body.abandonedDirectory
        ? `当前商品已遗弃并保存到：${body.abandonedDirectory}`
        : "当前队列商品已遗弃，队列状态已更新";
    elements.archiveHint.classList.remove("hidden");
    lastBagVariantSignature = undefined;
    lastDesignVariantSignature = undefined;
    lastLinerUploadSignature = undefined;
    await refresh();
    await loadProductLibrary();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    sourceButton.disabled = false;
    elements.dockAbandonButton.disabled = false;
    elements.insertAbandonTaskButton.disabled = false;
  }
}

async function rollbackCurrentTask() {
  const state = latestPayload?.state || {};
  const queue = latestPayload?.queue || {};
  const running = Boolean(state.running || state.autoRun || queue.status === "running" || queue.status === "preparing");
  if (running) {
    const confirmedPause = window.confirm(
      "当前任务仍在运行。回撤前必须先安全暂停，是否现在请求暂停？\n\n暂停完成后再点一次“回撤上一步”。"
    );
    if (!confirmedPause) return;
    elements.dockRollbackButton.disabled = true;
    try {
      await request("/api/task/pause", { method: "POST" });
      await refreshTwice();
    } catch (error) {
      elements.errorBox.classList.remove("hidden");
      elements.errorBox.textContent = error.message;
    } finally {
      elements.dockRollbackButton.disabled = false;
    }
    return;
  }
  const confirmed = window.confirm(
    "确认回撤当前任务到上一个安全阶段吗？已生成文件会保留，不会删除历史输出。"
  );
  if (!confirmed) return;
  elements.dockRollbackButton.disabled = true;
  try {
    await request("/api/task/rollback", { method: "POST" });
    lastBagVariantSignature = undefined;
    lastDesignVariantSignature = undefined;
    lastLinerUploadSignature = undefined;
    await refreshTwice();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    elements.dockRollbackButton.disabled = false;
  }
}

async function loadPrompt(kind, textarea) {
  try {
    const body = await request(`/api/prompts/${kind}`);
    textarea.value = body.content;
  } catch {
    textarea.value = "";
  }
}

function renderPromptLibrary(prompts = {}, busy = false, queueLocked = false) {
  if (!elements.promptLibraryList) return;
  if (!elements.promptLibraryList.dataset.initialized) {
    elements.promptLibraryList.replaceChildren(
      ...PROMPT_LIBRARY_ITEMS.map(createPromptLibraryCard)
    );
    elements.promptLibraryList.dataset.initialized = "true";
  }
  if (elements.promptLibraryCount) {
    const readyCount = PROMPT_LIBRARY_ITEMS.filter((item) => prompts[item.kind]?.ready).length;
    elements.promptLibraryCount.textContent = `${readyCount}/${PROMPT_LIBRARY_ITEMS.length} 个 Prompt 可用`;
  }
  PROMPT_LIBRARY_ITEMS.forEach((item) => {
    const status = prompts[item.kind];
    const card = elements.promptLibraryList.querySelector(`[data-prompt-library-kind="${item.kind}"]`);
    if (!card) return;
    const statusNode = card.querySelector("[data-prompt-library-status]");
    const saveButton = card.querySelector("[data-prompt-library-save]");
    if (statusNode) {
      statusNode.textContent = status?.ready ? `${status.characters} 字符` : "未配置";
    }
    if (saveButton) saveButton.disabled = busy || queueLocked;
  });
}

function createPromptLibraryCard(item) {
  const card = document.createElement("article");
  card.className = "prompt-editor prompt-library-item";
  card.dataset.promptLibraryKind = item.kind;

  const title = document.createElement("div");
  title.className = "prompt-editor-title";
  const titleText = document.createElement("div");
  titleText.innerHTML = "<strong></strong><small></small>";
  titleText.querySelector("strong").textContent = item.label;
  titleText.querySelector("small").textContent = item.group;
  const status = document.createElement("span");
  status.dataset.promptLibraryStatus = item.kind;
  status.textContent = "检查中";
  title.append(titleText, status);

  const detail = document.createElement("p");
  detail.className = "prompt-library-detail";
  detail.textContent = item.detail;

  const textarea = document.createElement("textarea");
  textarea.spellcheck = false;
  textarea.dataset.promptLibraryTextarea = item.kind;

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "button secondary";
  saveButton.dataset.promptLibrarySave = item.kind;
  saveButton.textContent = "保存 Prompt";
  saveButton.addEventListener("click", () => {
    void savePromptLibraryItem(item.kind, textarea, saveButton);
  });

  card.append(title, detail, textarea, saveButton);
  void loadPrompt(item.kind, textarea);
  return card;
}

async function savePromptLibraryItem(kind, textarea, button) {
  await savePrompt(kind, textarea, button);
}

async function savePrompt(kind, textarea, button) {
  button.disabled = true;
  try {
    await request(`/api/prompts/${kind}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: textarea.value })
    });
    await refresh();
  } catch (error) {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

elements.folderInput.addEventListener("change", (event) => {
  void importImages(event.target.files);
  event.target.value = "";
});
elements.queueWorkbookInput.addEventListener("change", (event) => {
  void importQueueWorkbook(event.target.files?.[0]);
});
elements.insertBagInput.addEventListener("change", (event) => {
  void importInsertBagImages(event.target.files).catch((error) => {
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
  });
  event.target.value = "";
});
elements.importInsertBagUrlsButton.addEventListener("click", () => {
  void importInsertBagImageUrls();
});
elements.clearImagesButton.addEventListener("click", () => {
  void clearImages();
});
elements.importUrlsButton.addEventListener("click", () => {
  void importImageUrls();
});
["dragenter", "dragover"].forEach((eventName) => {
  elements.imageDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.imageDropZone.classList.add("dragging");
  });
});
["dragleave", "drop"].forEach((eventName) => {
  elements.imageDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.imageDropZone.classList.remove("dragging");
  });
});
elements.imageDropZone.addEventListener("drop", (event) => {
  void importImages(event.dataTransfer.files);
});
elements.launchButton.addEventListener("click", () => {
  void runAction(elements.launchButton, "/api/browser/launch");
});
elements.checkButton.addEventListener("click", () => {
  void runAction(elements.checkButton, "/api/browser/check");
});
elements.runButton.addEventListener("click", () => {
  void runAction(elements.runButton, "/api/run");
});
elements.runAllButton.addEventListener("click", () => {
  void runAction(elements.runAllButton, "/api/run/all");
});
elements.planningButton.addEventListener("click", () => {
  void runAction(elements.planningButton, planningEndpointForState(latestPayload?.state));
});
elements.imagesButton.addEventListener("click", () => {
  void runAction(elements.imagesButton, "/api/run/images");
});
elements.seoListingButton.addEventListener("click", () => {
  void runAction(elements.seoListingButton, "/api/run/seo-listing");
});
elements.openOutputButton.addEventListener("click", () => {
  void runAction(elements.openOutputButton, "/api/finder/output");
});
elements.resumeButton.addEventListener("click", () => {
  void runAction(elements.resumeButton, "/api/run/resume");
});
elements.syncButton.addEventListener("click", () => {
  void runAction(elements.syncButton, "/api/run/sync");
});
elements.nextProductButton.addEventListener("click", () => {
  void startNextProduct();
});
elements.modeOptions.forEach((option) => {
  option.addEventListener("click", () => {
    void selectWorkflowMode(option.dataset.mode);
  });
});
elements.goalOptions.forEach((option) => {
  option.addEventListener("click", () => {
    void selectStandardWorkflowGoal(option.dataset.goal);
  });
});
elements.insertIdentifyButton.addEventListener("click", () => {
  void runAction(elements.insertIdentifyButton, "/api/insert/run/identify");
});
/* ── 每日市场选款雷达：统一执行入口 ──
   供「执行每日市场选款雷达」按钮与「进入并开始每日选款」入口按钮共用。
   options.enterView=true 时，先切到选款视图再执行（入口按钮场景）。

   ⚠️ 视图锁定说明：selection-radar 面板没有对应的 .nav-item 导航元素，
   所以 switchView 后无法通过「导航项 active → 面板 active」链路保持选中。
   render() 在 luxury_insert 模式下会按导航项重新同步面板，导致选款面板丢失
   active 并回落到 insert-editor。因此必须在每个 refresh/render 之后强制重设面板状态。 */
async function startDailySelectionRadarRun(options = {}) {
  const { enterView = false } = options;

  /* ── 强制锁定到选款视图 ──
     关键修复：之前只手动激活「面板」却没激活对应「导航项」。
     render() 在 insert 模式下用「当前激活的导航项 dataset.view」反推面板 active，
     下一次全局每秒 refresh 就把 selection-radar 面板 deactivate，
     于是雷达跑完后候选数据已在 state 中、但视图被踢回别的视图，看起来像"没回传"。
     改为用 switchView() 正确同时激活 导航项 + 面板 + 工作区 + 顶栏，
     使 activeViewName() 稳定返回 selection-radar，全局 refresh 会保持面板激活。 */
  const lockToSelectionRadar = () => {
    if (activeViewName() !== "selection-radar") {
      switchView("selection-radar");
    }
    elements.insertWorkspace?.classList.add("hidden");
  };

  /* 入口按钮与视图内按钮都先锁到选款视图（避免被全局 refresh 踢走） */
  lockToSelectionRadar();
  void enterView;

  const btn = elements.runInsertMarketRadarButton;
  const statusEl = document.getElementById("selectionRadarStatus");
  const showStatus = (text, color = "var(--blue, #0071e3)") => {
    if (!statusEl) return;
    statusEl.classList.remove("hidden");
    statusEl.style.color = color;
    statusEl.textContent = text;
  };

  const state = latestPayload?.state || {};
  const insert = state.luxuryInsert || {};

  /* ── 安全判断：避免打断已在进行的任务 ── */
  if (state.running) {
    showStatus("⏳ 选款雷达正在运行中，请稍候…");
    return;
  }
  /* 仅当「已选中某个候选并正导入内胆流程」时拦截，避免覆盖
     正在被引用的候选池（runMarketRadar 会重写 marketRadarCandidates）。
     已确认包型 / 已冻结设计属于内胆开发进度，雷达重写的是候选池、
     不会触碰 variants/bagFacts/designFrozen，因此不应阻断独立的
     每日选款扫描——否则做完一次内胆就永远无法再跑选款。 */
  if (insert.selectedMarketRadarCandidateId) {
    showStatus("ℹ️ 当前已有选中的候选正在导入内胆流程，如需重新选款请先「返回候选池」或「重置每日选款」。");
    return;
  }

  const origText = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "正在启动雷达…"; }
  showStatus("⏳ 正在准备选款请求…");

  try {
    /* ── 切换到奢侈包内胆模式（服务端 runMarketRadar 要求） ──
       关键：只发 API 请求更新服务端状态，然后手动更新本地 latestPayload，
       不调用 refresh() / 不触发 render()，避免渲染器按导航项同步时
       把 selection-radar 面板的 active 清掉并回落到 insert-editor。 */
    if (state.workflowMode !== "luxury_insert") {
      await request("/api/workflow-mode", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "luxury_insert" })
      });
      /* 手动更新本地状态，避免 refresh() 触发的视图漂移 */
      if (latestPayload?.state) {
        latestPayload.state.workflowMode = "luxury_insert";
      }
      document.body.classList.add("insert-mode");
      lockToSelectionRadar();
    }

    /* ── 发送雷达请求 ── */
    showStatus("🔍 雷达已启动，正在全网搜索包型机会…");
    if (btn) btn.textContent = "雷达运行中…";
    const radarRes = await request("/api/insert/run/market-radar", { method: "POST" });
    lockToSelectionRadar();

    /* ── 磁盘恢复命中：数据已在，直接刷新渲染，不轮询 ── */
    if (radarRes && radarRes.recovered) {
      showStatus("✅ 已从磁盘恢复选款候选数据");
      await refresh();
      lockToSelectionRadar();
      return;
    }

    /* ── 轮询直到候选就绪（每次 refresh 后重锁视图，确保候选渲染在选款界面） ──
       注意：不能因 running=true 就提前 return —— 雷达在后台跑数分钟，
       必须等到 marketRadarCandidates 真正回来才算完成并渲染。 */
    for (let attempt = 0; attempt < 240; attempt += 1) {
      await refresh();
      lockToSelectionRadar();
      const s = latestPayload?.state || {};
      const ins = s.luxuryInsert || {};
      if (
        (Array.isArray(ins.marketRadarCandidates) && ins.marketRadarCandidates.length > 0) ||
        s.stage === "FAILED" ||
        s.stage === "PAUSED"
      ) {
        return;
      }
      await wait(1000);
    }
    await refresh();
    lockToSelectionRadar();
  } catch (error) {
    showStatus(`❌ ${error.message}`, "var(--red, #d00)");
    elements.errorBox.classList.remove("hidden");
    elements.errorBox.textContent = error.message;
    lockToSelectionRadar();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}

/* ── 标品选品运行：与内胆包型选品互不干扰，不切换 workflowMode ── */
async function startProductSelectionRun() {
  /* 强制锁定到标品选品视图（避免被全局每秒 refresh 按导航项同步踢走） */
  const lockToProductSelection = () => {
    if (activeViewName() !== "product-selection") {
      switchView("product-selection");
    }
  };
  lockToProductSelection();

  const btn = document.getElementById("runProductSelectionButton");
  const statusEl = document.getElementById("productSelectionStatus");
  const showStatus = (text, color = "var(--blue, #0071e3)") => {
    if (!statusEl) return;
    statusEl.classList.remove("hidden");
    statusEl.style.color = color;
    statusEl.textContent = text;
  };

  const state = latestPayload?.state || {};
  const sel = state.selection || {};

  /* 安全判断：避免打断已在进行的任务或占用 AI 会话 */
  if (state.running) {
    showStatus("⏳ 当前有其它流程正在使用 AI 会话，请稍后再运行标品选品", "var(--red, #d00)");
    return;
  }
  if (sel.running) {
    showStatus("⏳ 标品选品正在运行中，请稍候…");
    return;
  }

  const taskType = (document.getElementById("productSelectionTaskType")?.value || "").trim();
  const categoryScope = (document.getElementById("productSelectionCategory")?.value || "").trim();
  const marketScope = (document.getElementById("productSelectionMarket")?.value || "").trim();
  const researchDepth = (document.getElementById("productSelectionDepth")?.value || "standard_research").trim();
  if (!taskType || !categoryScope) {
    showStatus("⚠️ 请选择任务类型并填写产品类目或方向", "var(--red, #d00)");
    return;
  }

  const origText = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "正在启动…"; }
  showStatus("⏳ 正在准备选品研究请求…");

  try {
    showStatus("🔍 Bob 选品研究已启动，正在联网搜索候选机会…");
    if (btn) btn.textContent = "研究中…";
    const res = await request("/api/selection/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskType, categoryScope, marketScope, researchDepth })
    });
    lockToProductSelection();

    /* 磁盘恢复命中：数据已在，直接刷新渲染 */
    if (res && res.recovered) {
      showStatus("✅ 已从磁盘恢复选品研究结果");
      await refresh();
      lockToProductSelection();
      return;
    }

    /* 轮询直到候选就绪（每次 refresh 后重锁视图，确保候选渲染在标品选品界面） */
    for (let attempt = 0; attempt < 360; attempt += 1) {
      await refresh();
      lockToProductSelection();
      const s = latestPayload?.state || {};
      const cur = s.selection || {};
      if ((Array.isArray(cur.candidates) && cur.candidates.length > 0) || cur.error) {
        if (cur.error) showStatus(`❌ ${cur.error}`, "var(--red, #d00)");
        else showStatus("✅ 选品研究完成，候选已呈现，可逐条采纳");
        return;
      }
      await wait(1000);
    }
    await refresh();
    lockToProductSelection();
    showStatus("⏱️ 超时未完成，可查看状态或稍后从磁盘恢复");
  } catch (error) {
    showStatus(`❌ ${error.message}`, "var(--red, #d00)");
    if (elements.errorBox) {
      elements.errorBox.classList.remove("hidden");
      elements.errorBox.textContent = error.message;
    }
    lockToProductSelection();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}

elements.runInsertMarketRadarButton.addEventListener("click", () => {
  void startDailySelectionRadarRun();
});
/* 入口按钮：点击即进入选款视图并立即开始执行今日选款任务 */
document.getElementById("enterDailySelectionButton")?.addEventListener("click", () => {
  void startDailySelectionRadarRun({ enterView: true });
});
/* ── 标品选品按钮接线（与内胆包型选品互不干扰） ── */
document.getElementById("runProductSelectionButton")?.addEventListener("click", () => {
  void startProductSelectionRun();
});
document.getElementById("resetProductSelectionButton")?.addEventListener("click", async () => {
  try {
    await request("/api/selection/reset", { method: "POST" });
    await refresh();
  } catch (error) {
    const errorBox = document.querySelector("#errorBox");
    if (errorBox) {
      errorBox.classList.remove("hidden");
      errorBox.textContent = error.message;
    }
  }
});
document.getElementById("recoverProductSelectionButton")?.addEventListener("click", async () => {
  try {
    await request("/api/selection/recover", { method: "POST" });
    await refresh();
  } catch (error) {
    const errorBox = document.querySelector("#errorBox");
    if (errorBox) {
      errorBox.classList.remove("hidden");
      errorBox.textContent = error.message;
    }
  }
});
document.getElementById("importCurrentChatButton")?.addEventListener("click", async () => {
  const statusEl = document.getElementById("productSelectionStatus");
  const showStatus = (text, color = "var(--blue, #0071e3)") => {
    if (!statusEl) return;
    statusEl.classList.remove("hidden");
    statusEl.style.color = color;
    statusEl.textContent = text;
  };
  try {
    showStatus("⏳ 正在从当前 ChatGPT 聊天页导入 Bob 结果…");
    const res = await request("/api/selection/import-current-chat", { method: "POST" });
    showStatus(`✅ 已导入 ${res.count || 0} 个候选`, "var(--green, #0a0)");
    await refresh();
  } catch (error) {
    showStatus(`❌ ${error.message}`, "var(--red, #d00)");
    const errorBox = document.querySelector("#errorBox");
    if (errorBox) {
      errorBox.classList.remove("hidden");
      errorBox.textContent = error.message;
    }
  }
});
elements.resetInsertMarketRadarButton.addEventListener("click", () => {
  void resetInsertMarketRadar();
});
/* ── 上品视图入口：进入内胆 Listing 设计 / 先去每日选款雷达 ── */
elements.enterInsertListingButton?.addEventListener("click", () => {
  void selectWorkflowMode("luxury_insert");
});
elements.gotoSelectionRadarFromEntryLink?.addEventListener("click", (event) => {
  event.preventDefault();
  /* 先切到 luxury_insert 模式再进 selection-radar（选款视图需要该模式） */
  if (window.latestPayload?.state?.workflowMode !== "luxury_insert") {
    selectWorkflowMode("luxury_insert").then(() => switchView("selection-radar"));
  } else {
    switchView("selection-radar");
  }
});
/* 从当前 ChatGPT 对话导入市场雷达结果（已生成但网页未显示时救回） */
elements.importCurrentChatMarketRadarButton?.addEventListener("click", async () => {
  const btn = elements.importCurrentChatMarketRadarButton;
  const statusEl = document.getElementById("selectionRadarStatus");
  const origText = btn.textContent;
  btn.disabled = true;
  if (statusEl) { statusEl.classList.remove("hidden"); statusEl.style.color = "var(--blue)"; statusEl.textContent = "⏳ 正在从当前 ChatGPT 对话导入…"; }
  try {
    const res = await request("/api/insert/market-radar/import-current-chat", { method: "POST" });
    const count = (res.state?.luxuryInsert?.marketRadarCandidates || []).length;
    if (statusEl) { statusEl.style.color = "var(--green, #0a0)"; statusEl.textContent = `✅ 已导入 ${count} 个候选`; }
    if (window.latestPayload?.state) {
      window.latestPayload.state = res.state;
    }
    await refresh();
    switchView("selection-radar");
  } catch (error) {
    if (statusEl) { statusEl.style.color = "var(--red, #d00)"; statusEl.textContent = `❌ ${error.message}`; }
    const errorBox = document.querySelector("#errorBox");
    if (errorBox) {
      errorBox.classList.remove("hidden");
      errorBox.textContent = error.message;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
});
elements.recoverMarketRadarButton?.addEventListener("click", async () => {
  const btn = elements.recoverMarketRadarButton;
  const statusEl = document.getElementById("selectionRadarStatus");
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "恢复中…";
  if (statusEl) { statusEl.classList.remove("hidden"); statusEl.style.color = "var(--blue)"; statusEl.textContent = "⏳ 正在从磁盘恢复选款数据…"; }
  try {
    const res = await request("/api/insert/market-radar/recover", { method: "POST" });
    if (res.recovered) {
      if (statusEl) { statusEl.style.color = "green"; statusText = `✅ 成功恢复 ${(res.state.luxuryInsert.marketRadarCandidates||[]).length} 个候选`; }
      await refresh();
      switchView("selection-radar");
    } else {
      if (statusEl) { statusEl.style.color = "var(--muted)"; statusText = "ℹ️ 无需恢复 — 数据已在内存中（或磁盘无文件可恢复）"; }
    }
  } catch (error) {
    if (statusEl) { statusEl.style.color = "var(--red, #d00)"; statusEl.textContent = `❌ ${error.message}`; }
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
});
elements.addBagVariantButton.addEventListener("click", () => {
  const count = elements.bagVariantRows.children.length + 1;
  elements.bagVariantRows.append(
    createBagVariantRow(
      {
        id: `SKU-${count}`,
        label: "",
        bagDimensions: { length: "", width: "", height: "" }
      },
      undefined
    )
  );
});
elements.confirmBagButton.addEventListener("click", () => {
  void confirmInsertBag();
});
elements.unlockBagButton.addEventListener("click", () => {
  void unlockInsertBag();
});
elements.returnMarketRadarButton.addEventListener("click", () => {
  void returnToMarketRadarPool();
});
elements.runNotebookButton.addEventListener("click", () => {
  void runAction(elements.runNotebookButton, "/api/insert/run/notebook");
});
elements.reExtractNotebookButton.addEventListener("click", async () => {
  const btn = elements.reExtractNotebookButton;
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "正在从 NotebookLM 读取…";
  try {
    const res = await fetch("/api/insert/notebook/re-extract", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || String(res.status));
    refresh();
  }
  catch (err) {
    alert("读取失败: " + (err instanceof Error ? err.message : err));
    btn.textContent = orig;
    btn.disabled = false;
  }
});
elements.importNotebookButton.addEventListener("click", async () => {
  const text = (elements.notebookImportText.value || "").trim();
  if (!text) {
    elements.notebookImportError.textContent = "请先粘贴内容";
    elements.notebookImportError.classList.remove("hidden");
    return;
  }
  elements.notebookImportError.classList.add("hidden");
  const btn = elements.importNotebookButton;
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "导入中…";
  try {
    const res = await fetch("/api/insert/notebook/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || String(res.status));
    elements.notebookImportText.value = "";
    refresh();
  }
  catch (err) {
    elements.notebookImportError.textContent = "导入失败: " + (err instanceof Error ? err.message : err);
    elements.notebookImportError.classList.remove("hidden");
    btn.textContent = orig;
    btn.disabled = false;
  }
});
elements.freezeDesignButton.addEventListener("click", () => {
  void freezeInsertDesign();
});
elements.unlockDesignButton.addEventListener("click", () => {
  void unlockInsertDesign();
});
elements.buildInsertPromptsButton.addEventListener("click", () => {
  void runAction(elements.buildInsertPromptsButton, "/api/insert/run/prompts");
});
elements.generateInsertImagesButton.addEventListener("click", () => {
  void runAction(elements.generateInsertImagesButton, "/api/insert/run/images");
});
elements.generateInsertListingButton.addEventListener("click", () => {
  void runAction(
    elements.generateInsertListingButton,
    "/api/insert/run/listing-content"
  );
});
elements.importInsertListingContentButton?.addEventListener("click", async () => {
  const btn = elements.importInsertListingContentButton;
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "导入中…";
  try {
    const res = await request("/api/insert/listing-content/import-current-chat", { method: "POST" });
    showToast("已从当前 ChatGPT 对话导入内胆 Listing 文案");
    await refresh();
  } catch (error) {
    showToast(`导入失败：${error.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
});
elements.previewInsertStockSheetButton.addEventListener("click", () => {
  void previewInsertStockSheet();
});
elements.archiveInsertButton.addEventListener("click", () => {
  void archiveInsertProduct();
});
elements.insertNextProductButton.addEventListener("click", () => {
  void startNextProduct();
});
elements.insertPauseTaskButton.addEventListener("click", () => {
  void runAction(elements.insertPauseTaskButton, "/api/task/pause");
});
elements.insertAbandonTaskButton.addEventListener("click", () => {
  void abandonCurrentProduct(elements.insertAbandonTaskButton);
});
renderAppNavigation(activeViewName() || "daily-cockpit");
document.querySelector("#refreshTodayDashboardButton")?.addEventListener("click", () => {
  void loadTodayDashboardProjection();
});
document.querySelector("#hiddenTestDataToggle")?.addEventListener("click", () => {
  hiddenDashboardIncludeTestData = !hiddenDashboardIncludeTestData;
  void loadTodayDashboardProjection();
});
document.querySelector("#secretaryToggle")?.addEventListener("click", () => {
  applySecretaryMode(secretaryMode === "collapsed" ? "docked" : "collapsed");
  updateSecretaryContext();
});
document.querySelector("#secretaryCollapse")?.addEventListener("click", () => {
  applySecretaryMode("collapsed");
});
document.querySelector("#secretaryModeToggle")?.addEventListener("click", () => {
  applySecretaryMode(secretaryMode === "floating" ? "docked" : "floating");
});
document.querySelector("#secretaryClose")?.addEventListener("click", () => {
  applySecretaryMode("collapsed");
});
document.querySelector("#secretarySend")?.addEventListener("click", () => {
  void submitSecretaryMessage("chat");
});
document.querySelector("#secretaryCodexPrompt")?.addEventListener("click", () => {
  const input = document.querySelector("#secretaryInput");
  if (input && !input.value.trim()) {
    input.value = "基于当前页面上下文生成 Codex Prompt 草稿，不执行高风险动作。";
  }
  void submitSecretaryMessage("codex_prompt");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && secretaryMode !== "collapsed") {
    applySecretaryMode("collapsed");
  }
});
document.querySelectorAll("[data-flow-step]").forEach((button) => {
  button.addEventListener("click", () => {
    goProductionFlowStep(button.dataset.flowStep);
  });
});
document.querySelector("[data-flow-action=\"qclaw-draft\"]")?.addEventListener("click", (event) => {
  void createProductionQclawDraft(event.currentTarget);
});
initializeSecretaryDrag();
applySecretaryMode(secretaryMode);
ensureProductionFlowTabs();
setProductionFlowStep(activeViewName());
elements.switchOperatorButton?.addEventListener("click", () => {
  showOperatorModal(true);
});
elements.closeOperatorModalButton?.addEventListener("click", () => {
  showOperatorModal(false);
});
document.querySelectorAll("[data-home-view]").forEach((button) => {
  button.addEventListener("click", () => {
    const targetView = button.dataset.homeView;
    if (targetView) switchView(targetView);
  });
});
document.querySelectorAll("[data-home-scroll]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.querySelector(button.dataset.homeScroll || "");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
document.querySelectorAll("[data-home-toast]").forEach((button) => {
  button.addEventListener("click", () => {
    window.alert(button.dataset.homeToast || "后续接入");
  });
});
elements.dailyStartButton?.addEventListener("click", startDailyTaskTimer);
elements.dailyPauseButton?.addEventListener("click", pauseDailyTaskTimer);
elements.dailyCompleteButton?.addEventListener("click", completeDailyTask);
elements.dailyWaitingToggleForm?.addEventListener("click", () => {
  if (dailyWaitingFormOpen) {
    setDailyWaitingFormOpen(false);
  } else {
    openDailyWaitingForm("other", "task");
  }
});
elements.dailyStepWaitingButton?.addEventListener("click", () => {
  openDailyWaitingForm("other", "step");
});
elements.dailyWaitingViewAll?.addEventListener("click", () => {
  if (elements.dailyWaitingListDetails) elements.dailyWaitingListDetails.open = true;
  elements.dailyWaitingListDetails?.scrollIntoView({ behavior: "smooth", block: "start" });
});
elements.dailyWaitingCancelForm?.addEventListener("click", () => {
  setDailyWaitingFormOpen(false);
});
elements.dailyWaitingForm?.addEventListener("submit", (event) => {
  void createDailyWaitingItem(event);
});
[
  [elements.dailyActionInput, "actionNote"],
  [elements.dailyIssueInput, "issueNote"],
  [elements.dailyNoActionInput, "noActionReason"],
  [elements.dailyFollowupInput, "followupNote"]
].forEach(([control, key]) => {
  control?.addEventListener("input", () => {
    updateSelectedDailyTask({ [key]: control.value });
  });
});
elements.saveProfileButton.addEventListener("click", () => {
  void saveCurrentProfile();
});
elements.resetProfileActionButton.addEventListener("click", () => {
  void resetCurrentProfileAction();
});
elements.refreshProfilesButton.addEventListener("click", () => {
  void loadProductLibrary();
});
elements.showAbnormalProductsButton?.addEventListener("click", () => {
  const row = elements.productLibrary.querySelector(".abnormal-archive");
  if (!row) return;
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("attention");
  setTimeout(() => row.classList.remove("attention"), 1600);
});
elements.backToCurrentProfileButton.addEventListener("click", () => {
  selectedArchivedProfile = undefined;
  renderCurrentProfile(
    latestPayload?.productProfile,
    latestPayload?.productProfileWarning
  );
});
elements.returnToInsertEditorButton.addEventListener("click", () => {
  showInsertEditor();
});
elements.queueStartButton.addEventListener("click", () => {
  void queueAction(elements.queueStartButton, "/api/queue/start");
});
elements.queuePauseButton.addEventListener("click", () => {
  void queueAction(elements.queuePauseButton, "/api/queue/pause");
});
elements.queueResumeButton.addEventListener("click", () => {
  void queueAction(elements.queueResumeButton, "/api/queue/resume");
});
elements.queueAbandonButton.addEventListener("click", () => {
  void abandonCurrentQueueTask();
});
elements.manageCommerceProductsButton?.addEventListener("click", () => {
  switchView("profiles");
});
elements.commercePrimaryAction?.addEventListener("click", () => {
  switchView(elements.commercePrimaryAction.dataset.targetView || "commerce-dashboard");
});
elements.commerceSecondaryAction?.addEventListener("click", () => {
  switchView(elements.commerceSecondaryAction.dataset.targetView || "commerce-products");
});
elements.backToOperationPoolButton?.addEventListener("click", () => {
  switchView("operation-pool");
});
elements.commerceDetailTabs?.querySelectorAll(".commerce-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    selectedCommerceDetailTab = tab.dataset.detailTab || "overview";
    renderCommerceProductDetail(latestPayload?.operations || emptyOperations());
  });
});
elements.queueClearButton.addEventListener("click", () => {
  void queueAction(elements.queueClearButton, "/api/queue/clear-completed");
});
elements.queueRefreshButton.addEventListener("click", () => {
  void refresh();
});
elements.refreshOperationsButton.addEventListener("click", () => {
  void refresh();
});
trackProfileForm([
  elements.profileDisplayName,
  elements.profileNextAction,
  elements.profileNotes
]);
trackCommerceForm("operationProfile", [
  elements.operationProductTier,
  elements.operationNextReviewAt,
  elements.operationEntryReason,
  elements.operationGoal,
  elements.operationStrategy,
  elements.operationPlanType,
  elements.operationTargetMetric,
  elements.operationPlanObjective,
  elements.operationSuccessCondition,
  elements.operationFailureCondition,
  elements.operationAgentSummary
]);
trackCommerceForm("storeProfile", [
  elements.storeAlias,
  elements.storePlatform,
  elements.storeHitoorEnvName,
  elements.storeHitoorEnvId,
  elements.storeRole,
  elements.storeStatus,
  elements.storeRemark
]);
trackCommerceForm("listingCard", [
  elements.listingProductSelect,
  elements.listingStoreSelect,
  elements.listingPlatformProductId,
  elements.listingTitle,
  elements.listingStatus,
  elements.listingInventorySku,
  elements.listingLifecycle,
  elements.listingBagModel,
  elements.listingTargetSize,
  elements.listingUrl,
  elements.listingImageVersion,
  elements.listingTitleVersion
]);
trackCommerceForm("skuMapping", [
  elements.skuMappingListingSelect,
  elements.skuPlatformSkuId,
  elements.skuSellerSkuCode,
  elements.skuPlatformBarcode,
  elements.skuVariantName,
  elements.skuColor,
  elements.skuSize,
  elements.skuInventorySku,
  elements.skuWarehouseSku,
  elements.skuMappingStatus,
  elements.skuMappingRemark
]);
trackCommerceForm("dataTask", [
  elements.taskListingSelect,
  elements.taskSkuMappingSelect,
  elements.taskPeriod,
  elements.taskReviewDueAt,
  elements.taskRelatedPlanId
]);
trackCommerceForm("snapshot", [
  elements.snapshotListingSelect,
  elements.snapshotTaskSelect,
  elements.snapshotSkuMappingSelect,
  elements.snapshotPeriodStart,
  elements.snapshotPeriodEnd,
  elements.snapshotImpressions,
  elements.snapshotVisitors,
  elements.snapshotClicks,
  elements.snapshotAddToCart,
  elements.snapshotOrders,
  elements.snapshotRevenue,
  elements.snapshotAdSpend,
  elements.snapshotRefundCount,
  elements.snapshotBadReviews,
  elements.snapshotSearchTerms,
  elements.snapshotInventoryStatus
]);
trackCommerceForm("operationAction", [
  elements.actionProductSelect,
  elements.actionListingSelect,
  elements.actionType,
  elements.actionStatus,
  elements.actionReason,
  elements.actionTargetMetric,
  elements.actionObservationPeriod,
  elements.actionOperator,
  elements.actionReviewDueAt
]);
trackCommerceForm("newProduct", [
  elements.newProductDisplayName,
  elements.newProductCategory,
  elements.newProductCreationType,
  elements.newProductInventorySku,
  elements.newProductWarehouseSku,
  elements.newProductSize,
  elements.newProductColor,
  elements.newProductInventoryRemark,
  elements.newProductNotes,
]);
trackCommerceForm("legacyOnboard", [
  elements.legacyProductDisplayName,
  elements.legacyStoreSelect,
  elements.legacyPlatformProductId,
  elements.legacyListingUrl,
  elements.legacyListingTitle,
  elements.legacyInventorySku,
  elements.legacyListingLifecycle,
  elements.legacyPlatformSkuId,
  elements.legacySellerSkuCode,
  elements.legacyPlatformBarcode,
  elements.legacyVariantName,
  elements.legacyWarehouseSku,
  elements.legacyNotes
]);
elements.createNewProductButton.addEventListener("click", () => {
  void createNewProductProfile();
});
elements.newProductCreationType?.addEventListener("change", updateNewProductCreationTypeUI);
updateNewProductCreationTypeUI();
elements.saveOperationProfileButton.addEventListener("click", () => {
  void saveOperationProfile();
});
elements.deleteOperationProfileButton.addEventListener("click", () => {
  if (!selectedOperationProductId) return;
  void deleteOperationResource(
    `/api/operations/profiles/${encodeURIComponent(selectedOperationProductId)}`,
    "确认删除当前商品的运营档案？商品主档案不会删除。"
  );
});
elements.saveStoreProfileButton.addEventListener("click", () => {
  void saveStoreProfile();
});
elements.saveListingCardButton.addEventListener("click", () => {
  void saveListingCard();
});
elements.saveSkuMappingButton.addEventListener("click", () => {
  void saveSkuMapping();
});
elements.legacyOnboardButton.addEventListener("click", () => {
  void createLegacyProductOnboarding();
});
elements.taskListingSelect.addEventListener("change", () => {
  fillSkuMappingSelects(latestPayload?.operations || emptyOperations());
});
elements.snapshotListingSelect.addEventListener("change", () => {
  fillSkuMappingSelects(latestPayload?.operations || emptyOperations());
});
elements.createDataTaskButton.addEventListener("click", () => {
  void createDataCollectionTask();
});
elements.saveSnapshotButton.addEventListener("click", () => {
  void savePerformanceSnapshot();
});
elements.createActionButton.addEventListener("click", () => {
  void createOperationAction();
});
elements.providerOptions.forEach((option) => {
  option.addEventListener("click", () => {
    void selectProvider(option.dataset.provider, option);
  });
});
elements.settingsButton.addEventListener("click", () => {
  setSettingsOpen(true);
});
elements.closeSettingsButton.addEventListener("click", () => {
  setSettingsOpen(false);
});
elements.settingsBackdrop.addEventListener("click", () => {
  setSettingsOpen(false);
});
elements.taskDockToggle.addEventListener("click", () => {
  setTaskDockExpanded(!elements.taskDock.classList.contains("expanded"));
});
elements.taskDockIndicator.addEventListener("click", () => {
  if (!elements.taskDock.classList.contains("expanded")) {
    setTaskDockExpanded(true);
  }
});
elements.dockSyncButton.addEventListener("click", () => {
  void runAction(elements.dockSyncButton, "/api/run/sync");
});
elements.dockPauseButton.addEventListener("click", () => {
  void runAction(elements.dockPauseButton, "/api/task/pause");
});
elements.dockRollbackButton.addEventListener("click", () => {
  void rollbackCurrentTask();
});
elements.dockAbandonButton.addEventListener("click", () => {
  void abandonCurrentProduct();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setSettingsOpen(false);
    setTaskDockExpanded(false);
  }
});
setTaskDockExpanded(localStorage.getItem("taskDockExpanded") === "true");
elements.saveResearchPrompt.addEventListener("click", () => {
  void savePrompt(
    "research",
    elements.researchPrompt,
    elements.saveResearchPrompt
  );
});
elements.savePlanningPrompt.addEventListener("click", () => {
  void savePrompt(
    "planning",
    elements.planningPrompt,
    elements.savePlanningPrompt
  );
});
elements.saveSeoKeywordsPrompt.addEventListener("click", () => {
  void savePrompt(
    "seoKeywords",
    elements.seoKeywordsPrompt,
    elements.saveSeoKeywordsPrompt
  );
});
elements.saveListingContentPrompt.addEventListener("click", () => {
  void savePrompt(
    "listingContent",
    elements.listingContentPrompt,
    elements.saveListingContentPrompt
  );
});
elements.saveLuxuryInsertPrompt.addEventListener("click", () => {
  void savePrompt(
    "luxuryInsert",
    elements.luxuryInsertPrompt,
    elements.saveLuxuryInsertPrompt
  );
});
elements.saveInsertMarketRadarPrompt.addEventListener("click", () => {
  void savePrompt(
    "insertMarketRadar",
    elements.insertMarketRadarPrompt,
    elements.saveInsertMarketRadarPrompt
  );
});
elements.saveInsertListingContentPrompt.addEventListener("click", () => {
  void savePrompt(
    "insertListingContent",
    elements.insertListingContentPrompt,
    elements.saveInsertListingContentPrompt
  );
});

window.addEventListener("beforeunload", saveCurrentDailyOperatorState);
bindListingVisualWorkflow();
bindObjectiveInfo();
void initializeOperators().then(() => refresh());
void loadPrompt("research", elements.researchPrompt);
void loadPrompt("planning", elements.planningPrompt);
void loadPrompt("seoKeywords", elements.seoKeywordsPrompt);
void loadPrompt("listingContent", elements.listingContentPrompt);
void loadPrompt("luxuryInsert", elements.luxuryInsertPrompt);
void loadPrompt("insertMarketRadar", elements.insertMarketRadarPrompt);
void loadPrompt("insertListingContent", elements.insertListingContentPrompt);
void loadProductLibrary();
renderDailyCockpit();
setInterval(refresh, 1_000);
setInterval(tickDailyCockpit, 1_000);
