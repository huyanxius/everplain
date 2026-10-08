#if os(macOS)
import SwiftUI

extension View {
    @ViewBuilder
    func epEmailContentType() -> some View {
        if #available(macOS 14.0, *) {
            self.textContentType(.emailAddress)
        } else {
            self.textContentType(.username)
        }
    }

    @ViewBuilder
    func epNewPasswordContentType() -> some View {
        if #available(macOS 14.0, *) {
            self.textContentType(.newPassword)
        } else {
            self
        }
    }
}
#endif
