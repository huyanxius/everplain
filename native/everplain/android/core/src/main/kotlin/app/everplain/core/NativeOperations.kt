// Generated from shared OpenAPI SHA256 084be17bbbf75c3e8af1233ffc7fc107a65a35dc3e082e684eff451c502571ca
package app.everplain.core

import app.everplain.shared.*
import kotlinx.serialization.builtins.*
import kotlinx.serialization.json.*

/** Exact JSON operations. All writes require an explicit, caller-owned intent key. */
class NativeOperations(private val api: EverplainApi) {

    suspend fun getAccount(): AccountResponse =
        api.contractJson(AccountResponse.serializer(), "/api/account", "GET", null, null, emptyMap())

    suspend fun redeemAccountCredits(key: String, body: CreditRedemptionRequest): CreditRedemptionResponse =
        api.contractJson(CreditRedemptionResponse.serializer(), "/api/account/credit-redemptions", "POST", WireJson.encodeToString(CreditRedemptionRequest.serializer(), body), key, emptyMap())

    suspend fun getAccountCredits(cursor: Long? = null, limit: Long? = null): CreditSummaryResponse =
        api.contractJson(CreditSummaryResponse.serializer(), "/api/account/credits", "GET", null, null, mapOf("cursor" to cursor?.let { listOf(it.toString()) }, "limit" to limit?.let { listOf(it.toString()) }))

    suspend fun createAccountDataExport(key: String, body: DataExportCreateRequest): DataExportResponse =
        api.contractJson(DataExportResponse.serializer(), "/api/account/data-exports", "POST", WireJson.encodeToString(DataExportCreateRequest.serializer(), body), key, emptyMap())

    suspend fun downloadAccountDataExport(exportId: String): JsonElement =
        api.contractJson(JsonElement.serializer(), contractPath("/api/account/data-exports/{export_id}/download", mapOf("export_id" to exportId)), "GET", null, null, emptyMap())

    suspend fun deactivateAccount(key: String, body: DeactivateAccountRequest): DeactivateAccountResponse =
        api.contractJson(DeactivateAccountResponse.serializer(), "/api/account/deactivate", "POST", WireJson.encodeToString(DeactivateAccountRequest.serializer(), body), key, emptyMap())

    suspend fun deleteAccount(key: String, body: DeleteAccountRequest): DeleteAccountResponse =
        api.contractJson(DeleteAccountResponse.serializer(), "/api/account/delete", "POST", WireJson.encodeToString(DeleteAccountRequest.serializer(), body), key, emptyMap())

    suspend fun updateModelDataAuthorization(key: String, body: UpdateModelDataAuthorizationRequest): AccountPreferencesResponse =
        api.contractJson(AccountPreferencesResponse.serializer(), "/api/account/model-data-authorization", "PATCH", WireJson.encodeToString(UpdateModelDataAuthorizationRequest.serializer(), body), key, emptyMap())

    suspend fun consumeAccountPasswordReset(key: String, body: PasswordResetConsumeRequest): PasswordResetConsumeResponse =
        api.contractJson(PasswordResetConsumeResponse.serializer(), "/api/account/password-resets/consume", "POST", WireJson.encodeToString(PasswordResetConsumeRequest.serializer(), body), key, emptyMap())

    suspend fun changeAccountPassword(key: String, body: ChangePasswordRequest): ChangePasswordResponse =
        api.contractJson(ChangePasswordResponse.serializer(), "/api/account/password/change", "POST", WireJson.encodeToString(ChangePasswordRequest.serializer(), body), key, emptyMap())

    suspend fun updateAccountPreferences(key: String, body: UpdatePreferencesRequest): AccountPreferencesResponse =
        api.contractJson(AccountPreferencesResponse.serializer(), "/api/account/preferences", "PATCH", WireJson.encodeToString(UpdatePreferencesRequest.serializer(), body), key, emptyMap())

    suspend fun updateAccountProfile(key: String, body: UpdateProfileRequest): AccountResponse =
        api.contractJson(AccountResponse.serializer(), "/api/account/profile", "PATCH", WireJson.encodeToString(UpdateProfileRequest.serializer(), body), key, emptyMap())

    suspend fun listAccountSessions(): AccountSessionPageResponse =
        api.contractJson(AccountSessionPageResponse.serializer(), "/api/account/sessions", "GET", null, null, emptyMap())

    suspend fun revokeAccountSession(sessionId: String, key: String): RevokeSessionResponse =
        api.contractJson(RevokeSessionResponse.serializer(), contractPath("/api/account/sessions/{session_id}/revoke", mapOf("session_id" to sessionId)), "POST", null, key, emptyMap())

    suspend fun getAgentProfile(): AgentProfileResponse =
        api.contractJson(AgentProfileResponse.serializer(), "/api/agent-profile", "GET", null, null, emptyMap())

    suspend fun updateAgentProfile(key: String, body: AgentProfileUpdate): AgentProfileResponse =
        api.contractJson(AgentProfileResponse.serializer(), "/api/agent-profile", "PATCH", WireJson.encodeToString(AgentProfileUpdate.serializer(), body), key, emptyMap())

    suspend fun listAgentConversations(): AgentConversationListResponse =
        api.contractJson(AgentConversationListResponse.serializer(), "/api/agent/conversations", "GET", null, null, emptyMap())

    suspend fun deleteAgentConversation(conversationId: String, key: String): Unit =
        api.contractUnit(contractPath("/api/agent/conversations/{conversation_id}", mapOf("conversation_id" to conversationId)), "DELETE", null, key, emptyMap())

    suspend fun getAgentConversation(conversationId: String): AgentConversationResponse =
        api.contractJson(AgentConversationResponse.serializer(), contractPath("/api/agent/conversations/{conversation_id}", mapOf("conversation_id" to conversationId)), "GET", null, null, emptyMap())

    suspend fun updateAgentConversation(conversationId: String, key: String, body: AgentConversationUpdateRequest): AgentConversationSummaryResponse =
        api.contractJson(AgentConversationSummaryResponse.serializer(), contractPath("/api/agent/conversations/{conversation_id}", mapOf("conversation_id" to conversationId)), "PATCH", WireJson.encodeToString(AgentConversationUpdateRequest.serializer(), body), key, emptyMap())

    suspend fun getAgentResearchJourney(conversationId: String): AgentResearchJourneyResponse =
        api.contractJson(AgentResearchJourneyResponse.serializer(), contractPath("/api/agent/conversations/{conversation_id}/journey", mapOf("conversation_id" to conversationId)), "GET", null, null, emptyMap())

    suspend fun editAgentCanvasNode(conversationId: String, nodeId: String, key: String, body: AgentCanvasNodeEditRequest): AgentConversationResponse =
        api.contractJson(AgentConversationResponse.serializer(), contractPath("/api/agent/conversations/{conversation_id}/research-map/nodes/{node_id}", mapOf("conversation_id" to conversationId, "node_id" to nodeId)), "PATCH", WireJson.encodeToString(AgentCanvasNodeEditRequest.serializer(), body), key, emptyMap())

    suspend fun prepareAgentMaterialContext(key: String, body: AgentMaterialContextRequest): AgentMaterialContextResponse =
        api.contractJson(AgentMaterialContextResponse.serializer(), "/api/agent/material-context", "POST", WireJson.encodeToString(AgentMaterialContextRequest.serializer(), body), key, emptyMap())

    suspend fun listAgentMaterials(limit: Long? = null, offset: Long? = null): AgentMaterialListResponse =
        api.contractJson(AgentMaterialListResponse.serializer(), "/api/agent/materials", "GET", null, null, mapOf("limit" to limit?.let { listOf(it.toString()) }, "offset" to offset?.let { listOf(it.toString()) }))

    suspend fun listAgentModels(): AgentModelCatalogResponse =
        api.contractJson(AgentModelCatalogResponse.serializer(), "/api/agent/models", "GET", null, null, emptyMap())

    suspend fun confirmAgentResearchStart(proposalId: String, key: String, body: ConfirmResearchStartRequest): ConfirmResearchStartResponse =
        api.contractJson(ConfirmResearchStartResponse.serializer(), contractPath("/api/agent/research-start-proposals/{proposal_id}/confirm", mapOf("proposal_id" to proposalId)), "POST", WireJson.encodeToString(ConfirmResearchStartRequest.serializer(), body), key, emptyMap())

    suspend fun lookupAgentRun(key: String): AgentRunLookupResponse =
        api.contractJson(AgentRunLookupResponse.serializer(), "/api/agent/runs/by-idempotency-key", "GET", null, key, emptyMap())

    suspend fun listChannelBindings(): List<ChannelBindingResponse> =
        api.contractJson(ListSerializer(ChannelBindingResponse.serializer()), "/api/channels/bindings", "GET", null, null, emptyMap())

    suspend fun revokeChannelBinding(bindingId: String): Unit =
        api.contractUnit(contractPath("/api/channels/bindings/{binding_id}", mapOf("binding_id" to bindingId)), "DELETE", null, null, emptyMap())

    suspend fun listChannelGateways(): List<ChannelGatewayInfoResponse> =
        api.contractJson(ListSerializer(ChannelGatewayInfoResponse.serializer()), "/api/channels/gateways", "GET", null, null, emptyMap())

    suspend fun cancelChannelLinkCodes(gatewayId: String): Unit =
        api.contractUnit("/api/channels/link-codes", "DELETE", null, null, mapOf("gateway_id" to listOf(gatewayId.toString())))

    suspend fun createChannelLinkCode(body: ChannelLinkCodeRequest): ChannelLinkCodeResponse =
        api.contractJson(ChannelLinkCodeResponse.serializer(), "/api/channels/link-codes", "POST", WireJson.encodeToString(ChannelLinkCodeRequest.serializer(), body), null, emptyMap())

    suspend fun confirmTheoryPlan(decisionSetId: String, key: String, body: ConfirmTheoryPlanRequest): ConfirmedTheoryPlanResponse =
        api.contractJson(ConfirmedTheoryPlanResponse.serializer(), contractPath("/api/decision-sets/{decision_set_id}/confirm", mapOf("decision_set_id" to decisionSetId)), "POST", WireJson.encodeToString(ConfirmTheoryPlanRequest.serializer(), body), key, emptyMap())

    suspend fun getHealth(): HealthResponse =
        api.contractJson(HealthResponse.serializer(), "/api/health", "GET", null, null, emptyMap())

    suspend fun listImportBatches(): ImportBatchListResponse =
        api.contractJson(ImportBatchListResponse.serializer(), "/api/imports", "GET", null, null, emptyMap())

    suspend fun createBilibiliImport(key: String, body: BilibiliImportRequest): ImportBatchResponse =
        api.contractJson(ImportBatchResponse.serializer(), "/api/imports/bilibili", "POST", WireJson.encodeToString(BilibiliImportRequest.serializer(), body), key, emptyMap())

    suspend fun retryImportItem(batchId: String, itemId: String, key: String): ImportBatchResponse =
        api.contractJson(ImportBatchResponse.serializer(), contractPath("/api/imports/{batch_id}/items/{item_id}/retry", mapOf("batch_id" to batchId, "item_id" to itemId)), "POST", null, key, emptyMap())

    suspend fun getKnowledgeStorage(): KnowledgeStorageResponse =
        api.contractJson(KnowledgeStorageResponse.serializer(), "/api/knowledge-storage", "GET", null, null, emptyMap())

    suspend fun getMatchRun(matchRunId: String): MatchRunResponse =
        api.contractJson(MatchRunResponse.serializer(), contractPath("/api/match-runs/{match_run_id}", mapOf("match_run_id" to matchRunId)), "GET", null, null, emptyMap())

    suspend fun listMatchCandidates(matchRunId: String, cursor: String? = null, limit: Long? = null): MatchCandidatePageResponse =
        api.contractJson(MatchCandidatePageResponse.serializer(), contractPath("/api/match-runs/{match_run_id}/candidates", mapOf("match_run_id" to matchRunId)), "GET", null, null, mapOf("cursor" to cursor?.let { listOf(it.toString()) }, "limit" to limit?.let { listOf(it.toString()) }))

    suspend fun retryMatchCandidate(matchRunId: String, candidateId: String, key: String, body: RetryMatchCandidateRequest): MatchRunResponse =
        api.contractJson(MatchRunResponse.serializer(), contractPath("/api/match-runs/{match_run_id}/candidates/{candidate_id}/retry", mapOf("match_run_id" to matchRunId, "candidate_id" to candidateId)), "POST", WireJson.encodeToString(RetryMatchCandidateRequest.serializer(), body), key, emptyMap())

    suspend fun getTheoryDecisionDraft(matchRunId: String): TheoryDecisionDraftResponse =
        api.contractJson(TheoryDecisionDraftResponse.serializer(), contractPath("/api/match-runs/{match_run_id}/decision-draft", mapOf("match_run_id" to matchRunId)), "GET", null, null, emptyMap())

    suspend fun saveTheoryDecisionDraft(matchRunId: String, key: String, body: SaveTheoryDecisionDraftRequest): TheoryDecisionDraftResponse =
        api.contractJson(TheoryDecisionDraftResponse.serializer(), contractPath("/api/match-runs/{match_run_id}/decision-draft", mapOf("match_run_id" to matchRunId)), "PUT", WireJson.encodeToString(SaveTheoryDecisionDraftRequest.serializer(), body), key, emptyMap())

    suspend fun createTheoryDecisions(matchRunId: String, key: String, body: CreateTheoryDecisionsRequest): TheoryDecisionSetResponse =
        api.contractJson(TheoryDecisionSetResponse.serializer(), contractPath("/api/match-runs/{match_run_id}/decisions", mapOf("match_run_id" to matchRunId)), "POST", WireJson.encodeToString(CreateTheoryDecisionsRequest.serializer(), body), key, emptyMap())

    suspend fun listTheoryDecisions(matchRunId: String, cursor: String? = null, limit: Long? = null): TheoryDecisionPageResponse =
        api.contractJson(TheoryDecisionPageResponse.serializer(), contractPath("/api/match-runs/{match_run_id}/decisions", mapOf("match_run_id" to matchRunId)), "GET", null, null, mapOf("cursor" to cursor?.let { listOf(it.toString()) }, "limit" to limit?.let { listOf(it.toString()) }))

    suspend fun acknowledgePartialMatch(matchRunId: String, key: String, body: AcknowledgePartialMatchRequest): MatchRunResponse =
        api.contractJson(MatchRunResponse.serializer(), contractPath("/api/match-runs/{match_run_id}/partial-completion-acknowledgements", mapOf("match_run_id" to matchRunId)), "POST", WireJson.encodeToString(AcknowledgePartialMatchRequest.serializer(), body), key, emptyMap())

    suspend fun createMemory(key: String, body: MemoryCreate): MemoryResponse =
        api.contractJson(MemoryResponse.serializer(), "/api/memories", "POST", WireJson.encodeToString(MemoryCreate.serializer(), body), key, emptyMap())

    suspend fun listMemories(taskId: String? = null): MemoryCollection =
        api.contractJson(MemoryCollection.serializer(), "/api/memories", "GET", null, null, mapOf("task_id" to taskId?.let { listOf(it.toString()) }))

    suspend fun summarizeMemory(key: String, body: MemoryOverviewRequest): MemoryOverviewResponse =
        api.contractJson(MemoryOverviewResponse.serializer(), "/api/memories/overview", "POST", WireJson.encodeToString(MemoryOverviewRequest.serializer(), body), key, emptyMap())

    suspend fun getMemorySettings(taskId: String? = null): MemorySettings =
        api.contractJson(MemorySettings.serializer(), "/api/memories/settings", "GET", null, null, mapOf("task_id" to taskId?.let { listOf(it.toString()) }))

    suspend fun updateMemorySettings(taskId: String? = null, key: String, body: MemorySettingsUpdate): MemorySettings =
        api.contractJson(MemorySettings.serializer(), "/api/memories/settings", "PATCH", WireJson.encodeToString(MemorySettingsUpdate.serializer(), body), key, mapOf("task_id" to taskId?.let { listOf(it.toString()) }))

    suspend fun deleteMemory(memoryId: String, expectedVersion: Long, key: String): Unit =
        api.contractUnit(contractPath("/api/memories/{memory_id}", mapOf("memory_id" to memoryId)), "DELETE", null, key, mapOf("expected_version" to listOf(expectedVersion.toString())))

    suspend fun updateMemory(memoryId: String, key: String, body: MemoryUpdate): MemoryResponse =
        api.contractJson(MemoryResponse.serializer(), contractPath("/api/memories/{memory_id}", mapOf("memory_id" to memoryId)), "PATCH", WireJson.encodeToString(MemoryUpdate.serializer(), body), key, emptyMap())

    suspend fun listMemoryRevisions(memoryId: String): MemoryList =
        api.contractJson(MemoryList.serializer(), contractPath("/api/memories/{memory_id}/revisions", mapOf("memory_id" to memoryId)), "GET", null, null, emptyMap())

    suspend fun updateMethodPlan(planId: String, key: String, body: UpdateMethodPlanRequest): MethodPlanResponse =
        api.contractJson(MethodPlanResponse.serializer(), contractPath("/api/method-plans/{plan_id}", mapOf("plan_id" to planId)), "PATCH", WireJson.encodeToString(UpdateMethodPlanRequest.serializer(), body), key, emptyMap())

    suspend fun confirmMethodPlan(planId: String, key: String, body: ConfirmMethodPlanRequest): MethodPlanResponse =
        api.contractJson(MethodPlanResponse.serializer(), contractPath("/api/method-plans/{plan_id}/confirm", mapOf("plan_id" to planId)), "POST", WireJson.encodeToString(ConfirmMethodPlanRequest.serializer(), body), key, emptyMap())

    suspend fun restoreMethodPlan(planId: String, key: String, body: RestoreMethodPlanRequest): MethodPlanResponse =
        api.contractJson(MethodPlanResponse.serializer(), contractPath("/api/method-plans/{plan_id}/restore", mapOf("plan_id" to planId)), "POST", WireJson.encodeToString(RestoreMethodPlanRequest.serializer(), body), key, emptyMap())

    suspend fun reviewMethodPlan(planId: String, key: String, body: ReviewMethodPlanRequest): MethodPlanResponse =
        api.contractJson(MethodPlanResponse.serializer(), contractPath("/api/method-plans/{plan_id}/reviews", mapOf("plan_id" to planId)), "POST", WireJson.encodeToString(ReviewMethodPlanRequest.serializer(), body), key, emptyMap())

    suspend fun resolveMethodPlanReview(planId: String, reviewId: String, key: String, body: ResolveMethodPlanReviewRequest): MethodPlanResponse =
        api.contractJson(MethodPlanResponse.serializer(), contractPath("/api/method-plans/{plan_id}/reviews/{review_id}/resolve", mapOf("plan_id" to planId, "review_id" to reviewId)), "POST", WireJson.encodeToString(ResolveMethodPlanReviewRequest.serializer(), body), key, emptyMap())

    suspend fun listMethodPlanVersions(planId: String): MethodPlanVersionListResponse =
        api.contractJson(MethodPlanVersionListResponse.serializer(), contractPath("/api/method-plans/{plan_id}/versions", mapOf("plan_id" to planId)), "GET", null, null, emptyMap())

    suspend fun getPersonalGraph(): PersonalGraphResponse =
        api.contractJson(PersonalGraphResponse.serializer(), "/api/personal-graph", "GET", null, null, emptyMap())

    suspend fun refreshPersonalGraph(key: String): PersonalGraphResponse =
        api.contractJson(PersonalGraphResponse.serializer(), "/api/personal-graph/refresh", "POST", null, key, emptyMap())

    suspend fun acceptResearchDocumentProposal(proposalId: String, key: String, body: AcceptResearchDocumentProposalRequest): ResearchDocumentProposalAcceptanceResponse =
        api.contractJson(ResearchDocumentProposalAcceptanceResponse.serializer(), contractPath("/api/research-document-proposals/{proposal_id}/accept", mapOf("proposal_id" to proposalId)), "POST", WireJson.encodeToString(AcceptResearchDocumentProposalRequest.serializer(), body), key, emptyMap())

    suspend fun rejectResearchDocumentProposal(proposalId: String, key: String, body: RejectResearchDocumentProposalRequest): ResearchDocumentProposalResponse =
        api.contractJson(ResearchDocumentProposalResponse.serializer(), contractPath("/api/research-document-proposals/{proposal_id}/reject", mapOf("proposal_id" to proposalId)), "POST", WireJson.encodeToString(RejectResearchDocumentProposalRequest.serializer(), body), key, emptyMap())

    suspend fun updateResearchDocument(documentId: String, key: String, body: UpdateResearchDocumentRequest): ResearchDocumentResponse =
        api.contractJson(ResearchDocumentResponse.serializer(), contractPath("/api/research-documents/{document_id}", mapOf("document_id" to documentId)), "PATCH", WireJson.encodeToString(UpdateResearchDocumentRequest.serializer(), body), key, emptyMap())

    suspend fun getResearchDocumentCompletionGate(documentId: String): ResearchDocumentCompletionGateResponse =
        api.contractJson(ResearchDocumentCompletionGateResponse.serializer(), contractPath("/api/research-documents/{document_id}/completion-gate", mapOf("document_id" to documentId)), "GET", null, null, emptyMap())

    suspend fun confirmResearchDocument(documentId: String, key: String, body: ConfirmResearchDocumentRequest): ResearchDocumentResponse =
        api.contractJson(ResearchDocumentResponse.serializer(), contractPath("/api/research-documents/{document_id}/confirm", mapOf("document_id" to documentId)), "POST", WireJson.encodeToString(ConfirmResearchDocumentRequest.serializer(), body), key, emptyMap())

    suspend fun exportResearchDocument(documentId: String, version: Long? = null): ResearchDocumentExportResponse =
        api.contractJson(ResearchDocumentExportResponse.serializer(), contractPath("/api/research-documents/{document_id}/export", mapOf("document_id" to documentId)), "GET", null, null, mapOf("version" to version?.let { listOf(it.toString()) }))

    suspend fun restoreResearchDocument(documentId: String, key: String, body: RestoreResearchDocumentRequest): ResearchDocumentResponse =
        api.contractJson(ResearchDocumentResponse.serializer(), contractPath("/api/research-documents/{document_id}/restore", mapOf("document_id" to documentId)), "POST", WireJson.encodeToString(RestoreResearchDocumentRequest.serializer(), body), key, emptyMap())

    suspend fun listResearchDocumentVersions(documentId: String): ResearchDocumentVersionListResponse =
        api.contractJson(ResearchDocumentVersionListResponse.serializer(), contractPath("/api/research-documents/{document_id}/versions", mapOf("document_id" to documentId)), "GET", null, null, emptyMap())

    suspend fun createResearchTask(key: String, body: CreateResearchTaskRequest): ResearchTaskResponse =
        api.contractJson(ResearchTaskResponse.serializer(), "/api/research-tasks", "POST", WireJson.encodeToString(CreateResearchTaskRequest.serializer(), body), key, emptyMap())

    suspend fun listResearchTasks(cursor: String? = null, limit: Long? = null): ResearchTaskPageResponse =
        api.contractJson(ResearchTaskPageResponse.serializer(), "/api/research-tasks", "GET", null, null, mapOf("cursor" to cursor?.let { listOf(it.toString()) }, "limit" to limit?.let { listOf(it.toString()) }))

    suspend fun deleteResearchTask(taskId: String, key: String): DeleteResearchTaskResponse =
        api.contractJson(DeleteResearchTaskResponse.serializer(), contractPath("/api/research-tasks/{task_id}", mapOf("task_id" to taskId)), "DELETE", null, key, emptyMap())

    suspend fun getResearchTask(taskId: String): ResearchTaskResponse =
        api.contractJson(ResearchTaskResponse.serializer(), contractPath("/api/research-tasks/{task_id}", mapOf("task_id" to taskId)), "GET", null, null, emptyMap())

    suspend fun getResearchAnalysis(taskId: String): ResearchAnalysisSnapshotResponse =
        api.contractJson(ResearchAnalysisSnapshotResponse.serializer(), contractPath("/api/research-tasks/{task_id}/analysis", mapOf("task_id" to taskId)), "GET", null, null, emptyMap())

    suspend fun createResearchAnalysisAnnotation(taskId: String, key: String, body: CreateAnalysisAnnotationRequest): AnalysisAnnotationResponse =
        api.contractJson(AnalysisAnnotationResponse.serializer(), contractPath("/api/research-tasks/{task_id}/analysis/annotations", mapOf("task_id" to taskId)), "POST", WireJson.encodeToString(CreateAnalysisAnnotationRequest.serializer(), body), key, emptyMap())

    suspend fun createResearchCaseComparison(taskId: String, key: String, body: CreateCaseComparisonRequest): CaseComparisonResponse =
        api.contractJson(CaseComparisonResponse.serializer(), contractPath("/api/research-tasks/{task_id}/analysis/comparisons", mapOf("task_id" to taskId)), "POST", WireJson.encodeToString(CreateCaseComparisonRequest.serializer(), body), key, emptyMap())

    suspend fun decideResearchCaseComparison(taskId: String, comparisonId: String, key: String, body: DecideAnalysisRecordRequest): CaseComparisonResponse =
        api.contractJson(CaseComparisonResponse.serializer(), contractPath("/api/research-tasks/{task_id}/analysis/comparisons/{comparison_id}/decision", mapOf("task_id" to taskId, "comparison_id" to comparisonId)), "POST", WireJson.encodeToString(DecideAnalysisRecordRequest.serializer(), body), key, emptyMap())

    suspend fun createResearchAnalysisMemo(taskId: String, key: String, body: CreateAnalysisMemoRequest): AnalysisMemoResponse =
        api.contractJson(AnalysisMemoResponse.serializer(), contractPath("/api/research-tasks/{task_id}/analysis/memos", mapOf("task_id" to taskId)), "POST", WireJson.encodeToString(CreateAnalysisMemoRequest.serializer(), body), key, emptyMap())

    suspend fun decideResearchAnalysisMemo(taskId: String, memoId: String, key: String, body: DecideAnalysisRecordRequest): AnalysisMemoResponse =
        api.contractJson(AnalysisMemoResponse.serializer(), contractPath("/api/research-tasks/{task_id}/analysis/memos/{memo_id}/decision", mapOf("task_id" to taskId, "memo_id" to memoId)), "POST", WireJson.encodeToString(DecideAnalysisRecordRequest.serializer(), body), key, emptyMap())

    suspend fun listResearchProjectAuditEvents(taskId: String): ResearchAuditEventListResponse =
        api.contractJson(ResearchAuditEventListResponse.serializer(), contractPath("/api/research-tasks/{task_id}/exchange/audit", mapOf("task_id" to taskId)), "GET", null, null, emptyMap())

    suspend fun createMatchRun(taskId: String, key: String, body: CreateMatchRunRequest): MatchRunResponse =
        api.contractJson(MatchRunResponse.serializer(), contractPath("/api/research-tasks/{task_id}/match-runs", mapOf("task_id" to taskId)), "POST", WireJson.encodeToString(CreateMatchRunRequest.serializer(), body), key, emptyMap())

    suspend fun getProfessionalMaterialArchive(taskId: String): ProfessionalMaterialArchiveResponse =
        api.contractJson(ProfessionalMaterialArchiveResponse.serializer(), contractPath("/api/research-tasks/{task_id}/material-archive", mapOf("task_id" to taskId)), "GET", null, null, emptyMap())

    suspend fun createMaterialBatch(taskId: String, key: String, body: CreateMaterialBatchRequest): MaterialBatchResponse =
        api.contractJson(MaterialBatchResponse.serializer(), contractPath("/api/research-tasks/{task_id}/material-archive/batches", mapOf("task_id" to taskId)), "POST", WireJson.encodeToString(CreateMaterialBatchRequest.serializer(), body), key, emptyMap())

    suspend fun createResearchCase(taskId: String, key: String, body: CreateResearchCaseRequest): ResearchCaseResponse =
        api.contractJson(ResearchCaseResponse.serializer(), contractPath("/api/research-tasks/{task_id}/material-archive/cases", mapOf("task_id" to taskId)), "POST", WireJson.encodeToString(CreateResearchCaseRequest.serializer(), body), key, emptyMap())

    suspend fun createMaterialCollection(taskId: String, key: String, body: CreateMaterialCollectionRequest): MaterialCollectionResponse =
        api.contractJson(MaterialCollectionResponse.serializer(), contractPath("/api/research-tasks/{task_id}/material-archive/collections", mapOf("task_id" to taskId)), "POST", WireJson.encodeToString(CreateMaterialCollectionRequest.serializer(), body), key, emptyMap())

    suspend fun resolveDoiMetadata(taskId: String, doi: String): DoiMetadataCandidateResponse =
        api.contractJson(DoiMetadataCandidateResponse.serializer(), contractPath("/api/research-tasks/{task_id}/material-archive/doi", mapOf("task_id" to taskId)), "GET", null, null, mapOf("doi" to listOf(doi.toString())))

    suspend fun createLiteratureEntry(taskId: String, key: String, body: CreateLiteratureEntryRequest): LiteratureEntryResponse =
        api.contractJson(LiteratureEntryResponse.serializer(), contractPath("/api/research-tasks/{task_id}/material-archive/literature", mapOf("task_id" to taskId)), "POST", WireJson.encodeToString(CreateLiteratureEntryRequest.serializer(), body), key, emptyMap())

    suspend fun exportLiteratureEntries(taskId: String, exchangeFormat: LiteratureExchangeFormat): JsonElement =
        api.contractJson(JsonElement.serializer(), contractPath("/api/research-tasks/{task_id}/material-archive/literature/export", mapOf("task_id" to taskId)), "GET", null, null, mapOf("exchange_format" to listOf(exchangeFormat.toString())))

    suspend fun updateProfessionalMaterialProfile(taskId: String, materialId: String, key: String, body: UpdateMaterialArchiveProfileRequest): MaterialArchiveProfileResponse =
        api.contractJson(MaterialArchiveProfileResponse.serializer(), contractPath("/api/research-tasks/{task_id}/material-archive/materials/{material_id}", mapOf("task_id" to taskId, "material_id" to materialId)), "PATCH", WireJson.encodeToString(UpdateMaterialArchiveProfileRequest.serializer(), body), key, emptyMap())

    suspend fun createMaterialRelation(taskId: String, key: String, body: CreateMaterialRelationRequest): MaterialRelationResponse =
        api.contractJson(MaterialRelationResponse.serializer(), contractPath("/api/research-tasks/{task_id}/material-archive/relations", mapOf("task_id" to taskId)), "POST", WireJson.encodeToString(CreateMaterialRelationRequest.serializer(), body), key, emptyMap())

    suspend fun listResearchMaterials(taskId: String): ResearchMaterialListResponse =
        api.contractJson(ResearchMaterialListResponse.serializer(), contractPath("/api/research-tasks/{task_id}/materials", mapOf("task_id" to taskId)), "GET", null, null, emptyMap())

    suspend fun searchResearchMaterials(taskId: String, q: String, materialIds: List<String>? = null, materialKind: MaterialKind? = null, limit: Long? = null, offset: Long? = null): ResearchMaterialSearchResponse =
        api.contractJson(ResearchMaterialSearchResponse.serializer(), contractPath("/api/research-tasks/{task_id}/materials/search", mapOf("task_id" to taskId)), "GET", null, null, mapOf("q" to listOf(q.toString()), "material_ids" to materialIds?.map { it.toString() }, "material_kind" to materialKind?.let { listOf(it.toString()) }, "limit" to limit?.let { listOf(it.toString()) }, "offset" to offset?.let { listOf(it.toString()) }))

    suspend fun deleteResearchMaterial(taskId: String, materialId: String, key: String): Unit =
        api.contractUnit(contractPath("/api/research-tasks/{task_id}/materials/{material_id}", mapOf("task_id" to taskId, "material_id" to materialId)), "DELETE", null, key, emptyMap())

    suspend fun getResearchMaterial(taskId: String, materialId: String, parseId: String? = null): ResearchMaterialResponse =
        api.contractJson(ResearchMaterialResponse.serializer(), contractPath("/api/research-tasks/{task_id}/materials/{material_id}", mapOf("task_id" to taskId, "material_id" to materialId)), "GET", null, null, mapOf("parse_id" to parseId?.let { listOf(it.toString()) }))

    suspend fun reparseResearchMaterial(taskId: String, materialId: String, key: String): ResearchMaterialResponse =
        api.contractJson(ResearchMaterialResponse.serializer(), contractPath("/api/research-tasks/{task_id}/materials/{material_id}/reparse", mapOf("task_id" to taskId, "material_id" to materialId)), "POST", null, key, emptyMap())

    suspend fun getResearchMaterialSegment(taskId: String, materialId: String, segmentId: String, parseId: String? = null): ResearchMaterialSegmentResponse =
        api.contractJson(ResearchMaterialSegmentResponse.serializer(), contractPath("/api/research-tasks/{task_id}/materials/{material_id}/segments/{segment_id}", mapOf("task_id" to taskId, "material_id" to materialId, "segment_id" to segmentId)), "GET", null, null, mapOf("parse_id" to parseId?.let { listOf(it.toString()) }))

    suspend fun createMethodPlan(taskId: String, key: String, body: CreateMethodPlanRequest): MethodPlanResponse =
        api.contractJson(MethodPlanResponse.serializer(), contractPath("/api/research-tasks/{task_id}/method-plans", mapOf("task_id" to taskId)), "POST", WireJson.encodeToString(CreateMethodPlanRequest.serializer(), body), key, emptyMap())

    suspend fun getCurrentMethodPlan(taskId: String): MethodPlanResponse? =
        api.contractJson(MethodPlanResponse.serializer().nullable, contractPath("/api/research-tasks/{task_id}/method-plans/current", mapOf("task_id" to taskId)), "GET", null, null, emptyMap())

    suspend fun getResearchTaskNavigation(taskId: String): ResearchTaskNavigationResponse =
        api.contractJson(ResearchTaskNavigationResponse.serializer(), contractPath("/api/research-tasks/{task_id}/navigation", mapOf("task_id" to taskId)), "GET", null, null, emptyMap())

    suspend fun getResearchCycle(taskId: String): ResearchCycleResponse =
        api.contractJson(ResearchCycleResponse.serializer(), contractPath("/api/research-tasks/{task_id}/research-cycle", mapOf("task_id" to taskId)), "GET", null, null, emptyMap())

    suspend fun listResearchTaskDocumentProposals(taskId: String): ResearchTaskDocumentProposalListResponse =
        api.contractJson(ResearchTaskDocumentProposalListResponse.serializer(), contractPath("/api/research-tasks/{task_id}/research-document-proposals", mapOf("task_id" to taskId)), "GET", null, null, emptyMap())

    suspend fun createResearchDocument(taskId: String, key: String, body: CreateResearchDocumentRequest): ResearchDocumentResponse =
        api.contractJson(ResearchDocumentResponse.serializer(), contractPath("/api/research-tasks/{task_id}/research-documents", mapOf("task_id" to taskId)), "POST", WireJson.encodeToString(CreateResearchDocumentRequest.serializer(), body), key, emptyMap())

    suspend fun listResearchDocuments(taskId: String): ResearchDocumentListResponse =
        api.contractJson(ResearchDocumentListResponse.serializer(), contractPath("/api/research-tasks/{task_id}/research-documents", mapOf("task_id" to taskId)), "GET", null, null, emptyMap())

    suspend fun getCurrentSession(): SessionResponse =
        api.contractJson(SessionResponse.serializer(), "/api/session", "GET", null, null, emptyMap())

    suspend fun loginSession(key: String, body: LoginSessionRequest): SessionResponse =
        api.contractJson(SessionResponse.serializer(), "/api/session/login", "POST", WireJson.encodeToString(LoginSessionRequest.serializer(), body), key, emptyMap())

    suspend fun logoutSession(key: String): LogoutSessionResponse =
        api.contractJson(LogoutSessionResponse.serializer(), "/api/session/logout", "POST", null, key, emptyMap())

    suspend fun registerSession(key: String, body: RegisterSessionRequest): SessionResponse =
        api.contractJson(SessionResponse.serializer(), "/api/session/register", "POST", WireJson.encodeToString(RegisterSessionRequest.serializer(), body), key, emptyMap())

    suspend fun sendRegistrationCode(key: String, body: RegistrationCodeRequest): RegistrationCodeResponse =
        api.contractJson(RegistrationCodeResponse.serializer(), "/api/session/registration-code", "POST", WireJson.encodeToString(RegistrationCodeRequest.serializer(), body), key, emptyMap())

    suspend fun joinSharedKnowledgeBase(key: String, body: JoinSharedKnowledgeRequest): SharedKnowledgeJoinResponse =
        api.contractJson(SharedKnowledgeJoinResponse.serializer(), "/api/shared-knowledge-base-subscriptions", "POST", WireJson.encodeToString(JoinSharedKnowledgeRequest.serializer(), body), key, emptyMap())

    suspend fun leaveSharedKnowledgeBase(kbId: String, key: String): Unit =
        api.contractUnit(contractPath("/api/shared-knowledge-base-subscriptions/{kb_id}", mapOf("kb_id" to kbId)), "DELETE", null, key, emptyMap())

    suspend fun createSharedKnowledgeBase(key: String, body: CreateSharedKnowledgeRequest): SharedKnowledgeResponse =
        api.contractJson(SharedKnowledgeResponse.serializer(), "/api/shared-knowledge-bases", "POST", WireJson.encodeToString(CreateSharedKnowledgeRequest.serializer(), body), key, emptyMap())

    suspend fun listSharedKnowledgeBases(): SharedKnowledgeListResponse =
        api.contractJson(SharedKnowledgeListResponse.serializer(), "/api/shared-knowledge-bases", "GET", null, null, emptyMap())

    suspend fun deleteSharedKnowledgeBase(kbId: String, key: String): Unit =
        api.contractUnit(contractPath("/api/shared-knowledge-bases/{kb_id}", mapOf("kb_id" to kbId)), "DELETE", null, key, emptyMap())

    suspend fun getSharedKnowledgeBase(kbId: String): SharedKnowledgeResponse =
        api.contractJson(SharedKnowledgeResponse.serializer(), contractPath("/api/shared-knowledge-bases/{kb_id}", mapOf("kb_id" to kbId)), "GET", null, null, emptyMap())

    suspend fun updateSharedKnowledgeBase(kbId: String, key: String, body: UpdateSharedKnowledgeRequest): SharedKnowledgeResponse =
        api.contractJson(SharedKnowledgeResponse.serializer(), contractPath("/api/shared-knowledge-bases/{kb_id}", mapOf("kb_id" to kbId)), "PATCH", WireJson.encodeToString(UpdateSharedKnowledgeRequest.serializer(), body), key, emptyMap())

    suspend fun detachSharedDocument(kbId: String, documentId: String, key: String): Unit =
        api.contractUnit(contractPath("/api/shared-knowledge-bases/{kb_id}/documents/{document_id}", mapOf("kb_id" to kbId, "document_id" to documentId)), "DELETE", null, key, emptyMap())

    suspend fun updateDocumentKnowledge(kbId: String, documentId: String, key: String, body: UpdateDocumentKnowledgeRequest): SharedDocumentResponse =
        api.contractJson(SharedDocumentResponse.serializer(), contractPath("/api/shared-knowledge-bases/{kb_id}/documents/{document_id}/knowledge", mapOf("kb_id" to kbId, "document_id" to documentId)), "PUT", WireJson.encodeToString(UpdateDocumentKnowledgeRequest.serializer(), body), key, emptyMap())

    suspend fun organizeSharedDocument(kbId: String, documentId: String, key: String): SharedDocumentResponse =
        api.contractJson(SharedDocumentResponse.serializer(), contractPath("/api/shared-knowledge-bases/{kb_id}/documents/{document_id}/organize", mapOf("kb_id" to kbId, "document_id" to documentId)), "POST", null, key, emptyMap())

    suspend fun getSharedDocumentSource(kbId: String, documentId: String, segmentId: String? = null): SharedDocumentSourceResponse =
        api.contractJson(SharedDocumentSourceResponse.serializer(), contractPath("/api/shared-knowledge-bases/{kb_id}/documents/{document_id}/source", mapOf("kb_id" to kbId, "document_id" to documentId)), "GET", null, null, mapOf("segment_id" to segmentId?.let { listOf(it.toString()) }))

    suspend fun publishKnowledgeMetadata(kbId: String, key: String, body: PublishKnowledgeRequest): PublicKnowledgePublicationResponse =
        api.contractJson(PublicKnowledgePublicationResponse.serializer(), contractPath("/api/shared-knowledge-bases/{kb_id}/publication", mapOf("kb_id" to kbId)), "PUT", WireJson.encodeToString(PublishKnowledgeRequest.serializer(), body), key, emptyMap())

    suspend fun unpublishKnowledgeMetadata(kbId: String, key: String): Unit =
        api.contractUnit(contractPath("/api/shared-knowledge-bases/{kb_id}/publication", mapOf("kb_id" to kbId)), "DELETE", null, key, emptyMap())

    suspend fun getSubscription(): SubscriptionOverviewResponse =
        api.contractJson(SubscriptionOverviewResponse.serializer(), "/api/subscription", "GET", null, null, emptyMap())

    suspend fun getConfirmedTheoryPlan(theoryPlanId: String): ConfirmedTheoryPlanResponse =
        api.contractJson(ConfirmedTheoryPlanResponse.serializer(), contractPath("/api/theory-plans/{theory_plan_id}", mapOf("theory_plan_id" to theoryPlanId)), "GET", null, null, emptyMap())
}

internal fun contractPath(template: String, parameters: Map<String, String>): String {
    var path = template
    parameters.forEach { (name, value) ->
        val encoded = okhttp3.HttpUrl.Builder().scheme("https").host("path.invalid").addPathSegment(value).build().encodedPath.removePrefix("/")
        path = path.replace("{$name}", encoded)
    }
    return path
}
