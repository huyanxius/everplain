import Foundation

public struct ComposerBox: Equatable, Sendable {
    public let x: Double, y: Double, width: Double, height: Double
}

/// Source CSS grid: the two-row chat rule uses viewport <=480, while multiline
/// shape uses the form's width and text content. These are distinct conditions.
public struct ComposerGeometry: Equatable, Sendable {
    public let height: Double
    public let tools: ComposerBox, input: ComposerBox, model: ComposerBox, send: ComposerBox
    public static func rowHeight(editorHeight: Double, viewportWidth: Double, research: Bool) -> Double {
        if research { return editorHeight + 12 + 36 }
        return viewportWidth <= 480 ? editorHeight + 8 + 36 : max(36, editorHeight)
    }
    public static func make(width: Double, originX: Double = 0, originY: Double = 0, editorHeight: Double, idealModelWidth: Double, viewportWidth: Double, research: Bool, multiline: Bool) -> ComposerGeometry {
        let narrow = viewportWidth <= 480 && !research
        let height = rowHeight(editorHeight:editorHeight,viewportWidth:viewportWidth,research:research)
        let modelWidth = min(260,idealModelWidth,max(0,width - (narrow || research ? 88 : 128)))
        let inputWidth = max(0,research ? width - 16 : narrow ? width - 44 : width - modelWidth - 96)
        let controlsY = originY + (research || narrow || multiline ? height - 36 : (height - 36) / 2)
        let toolsY = narrow ? originY + (multiline ? editorHeight - 36 : (editorHeight - 36) / 2) : controlsY
        return ComposerGeometry(height:height,
            tools:ComposerBox(x:originX,y:toolsY,width:36,height:36),
            input:ComposerBox(x:originX + (research ? 8 : 44),y:originY,width:inputWidth,height:editorHeight),
            model:ComposerBox(x:originX + width - 44 - modelWidth,y:controlsY,width:modelWidth,height:36),
            send:ComposerBox(x:originX + width - 36,y:controlsY,width:36,height:36))
    }
}
