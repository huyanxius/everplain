#if os(macOS)
import SwiftUI
import EverplainCore

/// Same two-step composition as Web AccountPages/useLoginFlow. Authentication
/// stays in AppStore so its session and owner generation checks remain shared.
struct LoginView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    @State private var email = ""
    @State private var password = ""
    @State private var passwordStep = false
    @State private var passwordVisible = false
    @State private var localError: String?
    @State private var registering = false
    @FocusState private var field: Field?
    enum Field { case email, password }

    var body: some View {
        let p = Palette(dark: scheme == .dark)
        Group {
        if registering { RegisterView(onLogin: { registering = false; localError = nil; store.error = nil }) }
        else { VStack(spacing: T.space6) {
            HStack(alignment: .bottom, spacing: T.space1) {
                ForEach(Array(AgentAvatar.presets.enumerated()), id: \.element.id) { index, preset in
                    AgentAvatar(id: preset.id, color: preset.color, size: index == 3 ? 72 : 48,
                                state: index == 3 ? .greet : .idle, offset: Double(index) * 0.7)
                }
            }.accessibilityHidden(true)
            Text(passwordStep ? "输入密码" : "登录 Everplain")
                .font(TypeStyle.reading(T.textDisplay)).tracking(T.textDisplay * T.textDisplayLetterSpacingEm)
            if passwordStep { Text(email).foregroundStyle(p.muted).textSelection(.enabled) }
            VStack(spacing: T.space3) {
                if passwordStep {
                    HStack(spacing: T.space2) {
                        Group {
                            if passwordVisible { TextField("密码", text: $password) }
                            else { SecureField("密码", text: $password) }
                        }.textContentType(.password).textFieldStyle(.plain).focused($field, equals: .password)
                            .onSubmit(submit).disabled(store.authenticating)
                        Button { passwordVisible.toggle(); field = .password } label: {
                            WebIcon(name: passwordVisible ? .eyeSlash : .eye, size: 18)
                        }.buttonStyle(EPIconButtonStyle()).accessibilityLabel(passwordVisible ? "隐藏密码" : "显示密码")
                    }.padding(.leading, T.space5).padding(.trailing, T.space2)
                        .frame(height: T.actionHeight).background(p.strong, in: Capsule())
                } else {
                    TextField("邮箱地址", text: $email).textContentType(.emailAddress)
                        .textFieldStyle(EPFieldStyle()).focused($field, equals: .email).onSubmit(submit)
                        .onChange(of: email) { _ in password = ""; localError = nil; store.error = nil }
                }
                if let message = localError ?? store.error { InlineMessage(text: message, isError: true) }
                Button(action: submit) {
                    Text(passwordStep ? (store.authenticating ? "正在登录…" : "登录并继续") : "继续")
                        .frame(maxWidth: .infinity).frame(height: T.actionHeight)
                }.buttonStyle(AuthenticationSubmitStyle()).disabled(store.authenticating)
            }.frame(maxWidth: 400)
            HStack(spacing: T.space6) {
                HStack(spacing: 4) {
                    Text("还没有账号？")
                    Button("创建账号") { registering = true; password = ""; store.error = nil }.buttonStyle(.plain).underline().disabled(store.authenticating)
                }
                Link("Everplain 首页", destination: productURL("/"))
                    .foregroundStyle(p.muted)
            }.font(TypeStyle.ui(T.textMeta)).padding(.top, T.space6)
        }.padding(.vertical, T.space12).padding(.horizontal, T.space4)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay(alignment: .topLeading) {
                if passwordStep {
                    Button {
                        guard !store.authenticating else { return }
                        passwordStep = false; passwordVisible = false; localError = nil; store.error = nil; field = .email
                    } label: { WebIcon(name: .arrowLeft, size: 18) }
                        .buttonStyle(EPButtonStyle()).disabled(store.authenticating)
                        .accessibilityLabel("返回").padding(T.space6)
                }
            }.onAppear { field = .email }
            .onDisappear { password = "" }
        }
        }
    }
    private func productURL(_ path: String) -> URL {
        let origin = (try? Endpoint(store.endpointText).origin) ?? URL(string: "https://e.qunxue.xyz")!
        return URL(string: path, relativeTo: origin)!.absoluteURL
    }
    private func submit() {
        guard !store.authenticating else { return }
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalized.utf16.count <= 320, normalized.range(of: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", options: .regularExpression) != nil else {
            localError = "请输入有效的邮箱地址。"; return
        }
        if !passwordStep {
            email = normalized; localError = nil; store.error = nil; passwordStep = true; field = .password; return
        }
        guard (8...128).contains(password.utf16.count) else { localError = "请检查邮箱格式，密码需要 8-128 个字符。"; return }
        localError = nil
        let entered = password
        Task { await store.login(email: normalized, password: entered) }
    }
}

struct AuthenticationSubmitStyle: ButtonStyle {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        let p = Palette(dark: scheme == .dark)
        configuration.label.font(TypeStyle.ui(T.textControl, weight: .medium))
            .foregroundStyle(p.onAccent).background(p.accent, in: Capsule())
            .opacity(enabled ? (configuration.isPressed ? 0.72 : 1) : 0.42)
    }
}

#endif
