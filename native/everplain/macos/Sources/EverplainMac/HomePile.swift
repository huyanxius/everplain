#if os(macOS)
import SwiftUI
import AppKit
import EverplainCore

struct HomePileItem: Identifiable {
    let id: String
    let label: String
    let action: () -> Void
    let content: AnyView
}

/// Native counterpart of home/Pile.tsx. Every source card stays mounted while
/// its geometry, cover and contents transition, including interrupted toggles.
struct HomePile: View {
    let kind: HomePileKind
    @Binding var expanded: Bool
    var cover: AnyView?
    let items: [HomePileItem]
    @Environment(\.accessibilityReduceMotion) private var reduced
    @State private var hovered = false
    @State private var anchor: NSView?
    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment:.topLeading) {
                ForEach(Array(items.enumerated()),id:\.element.id) { index,item in
                    HomePileCard(kind:kind,index:index,hasCover:cover != nil,width:proxy.size.width,expanded:expanded,pileHovered:hovered,item:item)
                        .zIndex(Double(10 - min(index + (cover == nil ? 0 : 1),3)))
                }
                if let cover {
                    cover.padding(.vertical,T.space4).padding(.horizontal,T.space5)
                        .frame(width:max(0,proxy.size.width - (expanded ? 0 : 44)),height:expanded ? 112 : 138,alignment:.topLeading)
                        .animation(reduced ? nil : .timingCurve(0.22,1,0.36,1,duration:0.5),value:expanded)
                        .modifier(HomePileSurface(lifted:hovered && !expanded))
                        .scaleEffect(expanded ? 0.97 : 1,anchor:UnitPoint(x:0.3,y:1))
                        .offset(y:expanded ? -8 : 0)
                        .animation(reduced ? nil : .timingCurve(0.22,1.28,0.36,1,duration:0.62),value:expanded)
                        .offset(y:hovered && !expanded ? -4 : 0)
                        .animation(reduced ? nil : .timingCurve(0.22,1.28,0.36,1,duration:0.3),value:hovered)
                        .opacity(expanded ? 0 : 1).allowsHitTesting(false).accessibilityHidden(expanded)
                        .animation(reduced ? nil : .timingCurve(0.25,0.1,0.25,1,duration:0.3),value:expanded)
                        .zIndex(expanded ? 0 : 10)
                }
                if !expanded {
                    Button { expanded = true } label: { Color.clear.contentShape(RoundedRectangle(cornerRadius:T.radiusCard)) }
                        .buttonStyle(.plain).accessibilityLabel(kind == .hand ? "展开研究" : "展开资料")
                        .zIndex(20)
                }
            }.frame(width:proxy.size.width,height:proxy.size.height,alignment:.topLeading)
        }
        .frame(height:HomePileGeometry.containerHeight(kind:kind,count:items.count,expanded:expanded))
        .animation(reduced ? nil : .timingCurve(0.22,1.28,0.36,1,duration:0.6),value:expanded)
        .onHover { hovered = $0 }
        .background(NativeInteractionAnchor { anchor = $0 })
        .background { if expanded { OutsideClickObserver(anchor:anchor) { expanded = false } } }
        .onExitCommand { expanded = false }
    }
}

private struct HomePileCard: View {
    let kind: HomePileKind
    let index: Int
    let hasCover: Bool
    let width: CGFloat
    let expanded: Bool
    let pileHovered: Bool
    let item: HomePileItem
    @Environment(\.accessibilityReduceMotion) private var reduced
    @State private var hovered = false
    private var geometry: HomePileGeometry { .card(kind:kind,index:index,hasCover:hasCover,width:Double(width),expanded:expanded) }
    private var depth: Int { min(index + (hasCover ? 1 : 0),2) }
    private var hoverOffset: CGSize {
        if expanded { return CGSize(width:0,height:hovered ? -3 : 0) }
        guard pileHovered else { return .zero }
        if depth == 0 { return CGSize(width:0,height:-4) }
        return kind == .hand ? CGSize(width:Double(depth) * 8,height:depth == 1 ? -2 : 0) : .zero
    }
    var body: some View {
        let g = geometry
        Button(action:item.action) {
            item.content
                .opacity(expanded || (!hasCover && index == 0) ? 1 : 0)
                .animation(reduced ? nil : .timingCurve(0.25,0.1,0.25,1,duration:0.25).delay(expanded ? g.delay + 0.16 : 0),value:expanded)
                .padding(.vertical,kind == .deck ? T.space4 : T.space5).padding(.horizontal,T.space5)
                .frame(width:g.width,height:g.height,alignment:.topLeading)
                .modifier(HomePileSurface(lifted:expanded ? hovered : pileHovered && depth == 0))
        }.buttonStyle(.plain).disabled(!expanded).accessibilityHidden(!expanded)
            .accessibilityLabel(item.label)
            .animation(reduced ? nil : .timingCurve(0.22,1,0.36,1,duration:0.5).delay(g.delay),value:expanded)
            .rotationEffect(.degrees(g.rotation),anchor:UnitPoint(x:0.3,y:1))
            .offset(x:g.x,y:g.y)
            .animation(reduced ? nil : .timingCurve(0.22,1.28,0.36,1,duration:0.62).delay(g.delay),value:expanded)
            .offset(hoverOffset)
            .animation(reduced ? nil : .timingCurve(0.22,1.28,0.36,1,duration:0.3),value:hoverOffset)
            .opacity(g.opacity).animation(reduced ? nil : .timingCurve(0.25,0.1,0.25,1,duration:0.3),value:g.opacity)
            .onHover { hovered = $0 }
    }
}

struct HomePileSurface: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduced
    let lifted: Bool
    var shadowDuration = 0.25
    func body(content: Content) -> some View {
        let dark = scheme == .dark
        let shadow = (lifted ? T.shadowFloat(dark:dark) : T.shadowCard(dark:dark)).last!
        content.background(Palette(dark:dark).surface,in:RoundedRectangle(cornerRadius:T.radiusCard))
            .clipShape(RoundedRectangle(cornerRadius:T.radiusCard))
            .overlay(RoundedRectangle(cornerRadius:T.radiusCard).stroke(lifted ? .clear : T.shadowCard(dark:dark)[0].color.color,lineWidth:1))
            .shadow(color:shadow.color.color,radius:shadow.blur / 2,x:shadow.x,y:shadow.y)
            .animation(reduced ? nil : .timingCurve(0.25,0.1,0.25,1,duration:shadowDuration),value:lifted)
    }
}
#endif
