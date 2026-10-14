import Foundation
import EverplainCore
// Offline platform/child-store/transport facade. No implementation here performs I/O.

protocol ObservableObject {}
@propertyWrapper struct Published<Value> { var wrappedValue: Value; init(wrappedValue: Value) { self.wrappedValue = wrappedValue } }
enum SettingsSection { case profile, usage, agent }
enum SettingsDraftMemory { static func reset() {} }
struct UTType { init?(filenameExtension:String) {} }
final class NSOpenPanel { enum Response { case OK }; var allowsMultipleSelection=false; var canChooseDirectories=false; var allowedContentTypes:[UTType]=[]; var urls:[URL]=[]; func begin(_ body:@escaping(Response)->Void) {} }
final class APIClient: @unchecked Sendable {
 var reads: [String] = []
 var readFixture: ((String, String?) async throws -> Data)?
 var streamedRequests: [PendingTurn] = []
 let endpoint:Endpoint; init(endpoint:Endpoint){self.endpoint=endpoint}
 func get<T:Decodable>(_ path:String,key:String?=nil,query:[String:String]=[:],as:T.Type=T.self) async throws ->T {
  reads.append(path)
  guard let readFixture else { fatalError("Unexpected offline read: " + path) }
  return try JSONDecoder().decode(T.self, from: try await readFixture(path, key))
 }
 func mutate<B:Encodable,T:Decodable>(_ path:String,method:String="POST",body:B,key:String=UUID().uuidString,query:[String:String]=[:],as:T.Type=T.self) async throws ->T{fatalError()}
 func post<T:Decodable>(_ path:String,key:String=UUID().uuidString,as:T.Type=T.self)async throws->T{fatalError()}
 func delete(_ path:String,query:[String:String]=[:],key:String=UUID().uuidString)async throws{}
 func stream(_ p:PendingTurn)->AsyncThrowingStream<AgentEvent,Error>{streamedRequests.append(p); return AsyncThrowingStream { $0.finish() }}
 func saveSession()throws{};func clearSession(){};func close(){}
 func loadStopRecovery(ownerId:String)throws->[StopRecoveryRecord]{[]}
 func saveStopRecovery(_ records:[StopRecoveryRecord],ownerId:String)throws{}
}
@MainActor final class KnowledgeStore { var onAuthenticationRequired:(()->Void)?;var graphQuery="";var selectedNodeId:String?;func configure(api:APIClient?,ownerId:String?){};func load()async{};func loadGraph()async{};func showAdd(source:KnowledgeImportSource){};func openDocument(libraryId:String,documentId:String,segmentId:String?=nil)async{} }
@MainActor final class MemoryStore {var onAuthenticationRequired:(()->Void)?;func configure(api:APIClient?,ownerId:String?){} }
@MainActor final class ResearchWorkspaceStore { var onAuthenticationRequired:(()->Void)?;var onTaskEstablished:((String,String)->Void)?;var hasUnsavedChanges=false;var taskId:String?;var selectedSectionId:String?;var theoryPlan:ConfirmedTheoryPlanResponse?;func discardUnsavedChanges(){};func configure(api:APIClient?,ownerId:String?){} }
@MainActor final class ResearchStore {var onAuthenticationRequired:(()->Void)?;var onOpenWorkspace:((String?,String?)->Void)?;var materialError:String?;var selectedMaterial:ResearchMaterialResponse?;static let supportedExtensions=["txt"];func configure(api:APIClient?,ownerId:String?){};func load(includeMaterials:Bool=false)async{};func readMaterial(taskId:String,materialId:String,parseId:String?=nil)async throws->ResearchMaterialResponse{fatalError()};func uploadFile(_ url:URL,taskId:String,key:String)async throws->ResearchMaterialResponse{fatalError()};func uploadFiles(_ urls:[URL],taskId:String?)async->String?{nil};func uploadAttachmentBatch(urls:[URL],taskId:String,scope:String)async throws->[ResearchMaterialResponse]{[]} }

@MainActor final class AccountManagementStore { var onAuthenticationRequired:(()->Void)?;var onAccountClosed:(()->Void)?;var onPreferencesChanged:((AccountPreferencesResponse)->Void)?;var onCreditsChanged:((CreditSummaryResponse)->Void)?;func configure(api:APIClient?,ownerId:String?){} }
@MainActor final class WelcomeSetupStore { var onAuthenticationRequired:(()->Void)?;var onProfileChanged:((AgentProfileResponse)->Void)?;func configure(api:APIClient?,ownerId:String?){};func restart(with:AgentProfileResponse?){} }
