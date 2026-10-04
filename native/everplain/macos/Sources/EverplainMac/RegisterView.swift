#if os(macOS)
import SwiftUI

struct RegisterView: View {
    @EnvironmentObject private var store: AppStore
    @Environment(\.colorScheme) private var scheme
    let onLogin: () -> Void
    @State private var step = 1
    @State private var email = ""
    @State private var code = ""
    @State private var password = ""
    @State private var confirmation = ""
    @State private var localError: String?
    @State private var resendAt: Date?
    @State private var now = Date()
    @State private var active = true
    @FocusState private var focused: Int?
    private var countdown: Int { max(0, Int(ceil((resendAt ?? .distantPast).timeIntervalSince(now)))) }
    var body: some View {
        let p = Palette(dark: scheme == .dark)
        VStack(spacing: T.space6) {
            HStack(alignment: .bottom, spacing: T.space1) { ForEach(Array(AgentAvatar.presets.enumerated()), id: \.element.id) { index, preset in AgentAvatar(id: preset.id, color: preset.color, size: index == 3 ? 72 : 48, state: index == 3 ? .greet : .idle, offset: Double(index) * 0.7) } }.accessibilityHidden(true)
            Text(step == 1 ? "注册" : step == 2 ? "查看你的邮箱" : "设置密码").font(TypeStyle.reading(T.textDisplay))
            HStack(spacing: T.space2) { ForEach(1...3, id: \.self) { value in Capsule().fill(value <= step ? p.ink : p.rule).frame(width: value == step ? 48 : 28, height: 6) } }.accessibilityLabel("第 \(step) 步，共 3 步")
            Text("第 \(step) 步，共 3 步").font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted).padding(.top, -T.space4)
            if step > 1 { VStack(spacing: T.space1) { Text(email).foregroundStyle(p.muted); Button(step == 2 ? "修改邮箱" : "返回验证码") { back() }.buttonStyle(EPGhostButtonStyle()).disabled(store.authenticating) } }
            VStack(spacing: T.space3) {
                if step == 1 { TextField("邮箱地址", text: $email).textContentType(.emailAddress).textFieldStyle(EPFieldStyle()).focused($focused, equals: 1).onSubmit(submit) }
                else if step == 2 {
                    TextField("6 位验证码", text: $code).textContentType(.oneTimeCode).textFieldStyle(EPFieldStyle()).multilineTextAlignment(.center).focused($focused, equals: 2).onSubmit(submit)
                        .onChange(of: code) { value in code = String(value.filter { $0 >= "0" && $0 <= "9" }.prefix(6)) }
                } else {
                    SecureField("密码", text: $password).textContentType(.newPassword).textFieldStyle(EPFieldStyle()).focused($focused, equals: 3)
                    SecureField("再输入一次密码", text: $confirmation).textContentType(.newPassword).textFieldStyle(EPFieldStyle()).focused($focused, equals: 4).onSubmit(submit)
                    Text("8-128 个字符。").font(TypeStyle.ui(T.textMeta)).foregroundStyle(p.muted)
                }
                if let message = localError ?? store.error { InlineMessage(text: message, isError: true) }
                Button(action: submit) {
                    Text(step == 1 ? (store.authenticating ? "正在发送…" : "发送验证码") : step == 2 ? "继续设置密码" : store.authenticating ? "正在创建…" : "创建账号")
                        .frame(maxWidth: .infinity).frame(height: T.actionHeight)
                }.buttonStyle(AuthenticationSubmitStyle()).disabled(store.authenticating)
                if step == 2 { Button(countdown > 0 ? "\(countdown) 秒后可重新发送" : "重新发送验证码") { sendCode() }.buttonStyle(EPGhostButtonStyle()).disabled(store.authenticating || countdown > 0) }
            }.frame(maxWidth: 400).disabled(store.authenticating)
            HStack(spacing: T.space6) {
                HStack(spacing: 4) { Text("已有账号？"); Button("返回登录", action: onLogin).buttonStyle(.plain).underline().disabled(store.authenticating) }
                if let url = URL(string: store.endpointText) { Link("Everplain 首页", destination: url).foregroundStyle(p.muted) }
            }.font(TypeStyle.ui(T.textMeta)).padding(.top, T.space6)
        }.padding(.vertical, T.space12).padding(.horizontal, T.space4).frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay(alignment: .topLeading) { if step > 1 { Button(action: back) { WebIcon(name: .arrowLeft, size: 18) }.buttonStyle(EPButtonStyle()).disabled(store.authenticating).accessibilityLabel("返回").padding(T.space6) } }
            .onAppear { active = true; focused = 1 }.onDisappear { active = false; password = ""; confirmation = ""; code = "" }
            .task(id: resendAt) { guard let end = resendAt else { return }; while !Task.isCancelled, Date() < end { now = Date(); do { try await Task.sleep(nanoseconds: 1_000_000_000) } catch { return } }; now = Date() }
    }
    private func back() { guard !store.authenticating else { return }; step = max(1, step - 1); password = ""; confirmation = ""; if step == 1 { code = "" }; localError = nil; store.error = nil; focused = step }
    private func submit() {
        guard !store.authenticating else { return }
        if step == 1 { sendCode(); return }
        if step == 2 { guard code.range(of: "^[0-9]{6}$", options: .regularExpression) != nil else { localError = "请输入邮件中的 6 位验证码。"; return }; localError = nil; step = 3; focused = 3; return }
        guard (8...128).contains(password.utf16.count) else { localError = "密码需要 8-128 个字符。"; return }
        guard password == confirmation else { localError = "两次输入的密码不一致。"; return }
        localError = nil
        let enteredPassword = password; let enteredCode = code
        Task { guard active else { return }; await store.register(email: email, password: enteredPassword, code: enteredCode) }
    }
    private func sendCode() {
        guard !store.authenticating, step != 2 || countdown == 0 else { return }
        let value = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.utf16.count <= 320, value.range(of: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", options: .regularExpression) != nil else { localError = "请输入有效的邮箱地址。"; return }
        localError = nil; store.error = nil
        Task {
            guard active else { return }
            do { let result = try await store.requestRegistrationCode(email: value); guard active else { return }; email = value; resendAt = Date().addingTimeInterval(TimeInterval(max(0, result.resendAfterSeconds ?? 0))); now = Date(); step = 2; focused = 2 }
            catch { if active { localError = error.localizedDescription } }
        }
    }
}
#endif
