import Foundation

public struct DownloadedContent: Sendable {
    public let data: Data
    public let mimeType: String
    public let suggestedFilename: String?
}

public struct MultipartBody: Sendable {
    public let data: Data
    public let contentType: String
    public enum Part: Sendable {
        case field(name: String, value: String)
        case file(name: String, filename: String, mimeType: String, bytes: Data)
    }
    public init(parts: [Part], boundary: String = "----everplain-" + UUID().uuidString) throws {
        guard (1...70).contains(boundary.utf8.count), boundary.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 45 }) else { throw ClientError.invalidResponse }
        func header(_ value: String) -> String {
            value.replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
                .replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        }
        var output = Data()
        func append(_ text: String) { output.append(Data(text.utf8)) }
        for part in parts {
            append("--\(boundary)\r\n")
            switch part {
            case .field(let name, let value): append("Content-Disposition: form-data; name=\"\(header(name))\"\r\n\r\n\(value)\r\n")
            case .file(let name, let filename, let mimeType, let bytes):
                guard mimeType.rangeOfCharacter(from: .controlCharacters) == nil else { throw ClientError.invalidResponse }
                append("Content-Disposition: form-data; name=\"\(header(name))\"; filename=\"\(header(filename))\"\r\nContent-Type: \(mimeType)\r\n\r\n")
                output.append(bytes); append("\r\n")
            }
        }
        append("--\(boundary)--\r\n")
        data = output; contentType = "multipart/form-data; boundary=\(boundary)"
    }
}
