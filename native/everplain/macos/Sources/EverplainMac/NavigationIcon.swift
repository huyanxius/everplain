#if os(macOS)
import SwiftUI
/// Exact retained outlines from Web app/ui/NavIcon.tsx, 24×24, stroke 1.75.
struct NavigationIcon: View {
    enum Kind { case home, compose, user, chevron, library, graph, file, card, settings, bell, sidebar, close }
    let kind:Kind
    var body:some View { NavigationIconPath(kind:kind).stroke(style:StrokeStyle(lineWidth:1.75*18/24,lineCap:.round,lineJoin:.round)).frame(width:18,height:18).accessibilityHidden(true) }
}
private struct NavigationIconPath: Shape {
    let kind:NavigationIcon.Kind
    func path(in rect:CGRect)->Path {
        var p=Path()
        switch kind {
        case .home:
            p.move(to:CGPoint(x:3,y:10));p.addLine(to:CGPoint(x:12,y:3));p.addLine(to:CGPoint(x:21,y:10));p.addLine(to:CGPoint(x:21,y:20))
            p.addArc(center:CGPoint(x:20,y:20),radius:1,startAngle:.degrees(0),endAngle:.degrees(90),clockwise:false)
            p.addLine(to:CGPoint(x:15,y:21));p.addLine(to:CGPoint(x:15,y:14));p.addLine(to:CGPoint(x:9,y:14));p.addLine(to:CGPoint(x:9,y:21));p.addLine(to:CGPoint(x:4,y:21))
            p.addArc(center:CGPoint(x:4,y:20),radius:1,startAngle:.degrees(90),endAngle:.degrees(180),clockwise:false);p.closeSubpath()
        case .compose:
            p.move(to:CGPoint(x:12,y:4));p.addLine(to:CGPoint(x:5,y:4))
            p.addArc(center:CGPoint(x:5,y:6),radius:2,startAngle:.degrees(-90),endAngle:.degrees(-180),clockwise:true)
            p.addLine(to:CGPoint(x:3,y:19));p.addArc(center:CGPoint(x:5,y:19),radius:2,startAngle:.degrees(180),endAngle:.degrees(90),clockwise:true)
            p.addLine(to:CGPoint(x:18,y:21));p.addArc(center:CGPoint(x:18,y:19),radius:2,startAngle:.degrees(90),endAngle:.degrees(0),clockwise:true)
            p.addLine(to:CGPoint(x:20,y:12));p.move(to:CGPoint(x:10,y:14));p.addLine(to:CGPoint(x:11,y:10));p.addLine(to:CGPoint(x:19,y:2));p.addLine(to:CGPoint(x:22,y:5));p.addLine(to:CGPoint(x:14,y:13));p.closeSubpath();p.move(to:CGPoint(x:17,y:4));p.addLine(to:CGPoint(x:20,y:7))
        case .user:
            p.addEllipse(in:CGRect(x:8,y:4,width:8,height:8));p.move(to:CGPoint(x:4,y:21));p.addLine(to:CGPoint(x:4,y:19))
            p.addArc(center:CGPoint(x:12,y:19),radius:8,startAngle:.degrees(180),endAngle:.degrees(360),clockwise:false);p.addLine(to:CGPoint(x:20,y:21))
        case .library:
            p.addRoundedRect(in:CGRect(x:3,y:4,width:5,height:16),cornerSize:CGSize(width:1,height:1))
            p.move(to:CGPoint(x:11,y:4));p.addLine(to:CGPoint(x:11,y:20));p.move(to:CGPoint(x:15,y:5));p.addLine(to:CGPoint(x:19,y:4));p.addLine(to:CGPoint(x:22,y:19));p.addLine(to:CGPoint(x:18,y:20));p.closeSubpath()
        case .graph:
            for point in [CGPoint(x:12,y:5),CGPoint(x:5,y:18),CGPoint(x:19,y:18)] { p.addEllipse(in:CGRect(x:point.x-2.5,y:point.y-2.5,width:5,height:5)) }
            p.move(to:CGPoint(x:10.8,y:7.3));p.addLine(to:CGPoint(x:6.2,y:15.7));p.move(to:CGPoint(x:13.2,y:7.3));p.addLine(to:CGPoint(x:17.8,y:15.7));p.move(to:CGPoint(x:7.5,y:18));p.addLine(to:CGPoint(x:16.5,y:18))
        case .file:
            p.move(to:CGPoint(x:14,y:3));p.addLine(to:CGPoint(x:5,y:3));p.addLine(to:CGPoint(x:5,y:21));p.addLine(to:CGPoint(x:19,y:21));p.addLine(to:CGPoint(x:19,y:8));p.closeSubpath();p.move(to:CGPoint(x:14,y:3));p.addLine(to:CGPoint(x:14,y:8));p.addLine(to:CGPoint(x:19,y:8));p.move(to:CGPoint(x:8,y:12));p.addLine(to:CGPoint(x:16,y:12));p.move(to:CGPoint(x:8,y:16));p.addLine(to:CGPoint(x:14,y:16))
        case .card:
            p.addRoundedRect(in:CGRect(x:2,y:5,width:20,height:14),cornerSize:CGSize(width:3,height:3));p.move(to:CGPoint(x:2,y:10));p.addLine(to:CGPoint(x:22,y:10));p.move(to:CGPoint(x:6,y:15));p.addLine(to:CGPoint(x:10,y:15))
        case .settings:
            for (y,x) in [(6.0,9.0),(12.0,15.0),(18.0,9.0)] { p.move(to:CGPoint(x:3,y:y));p.addLine(to:CGPoint(x:x-2,y:y));p.move(to:CGPoint(x:x+2,y:y));p.addLine(to:CGPoint(x:21,y:y));p.addEllipse(in:CGRect(x:x-2,y:y-2,width:4,height:4)) }
        case .bell:
            p.move(to:CGPoint(x:18,y:8));p.addArc(center:CGPoint(x:12,y:8),radius:6,startAngle:.degrees(0),endAngle:.degrees(-180),clockwise:true);p.addCurve(to:CGPoint(x:3,y:17),control1:CGPoint(x:6,y:15),control2:CGPoint(x:3,y:16));p.addLine(to:CGPoint(x:21,y:17));p.addCurve(to:CGPoint(x:18,y:8),control1:CGPoint(x:21,y:16),control2:CGPoint(x:18,y:15));p.move(to:CGPoint(x:10,y:21));p.addLine(to:CGPoint(x:14,y:21))
        case .sidebar:
            p.addRoundedRect(in:CGRect(x:3,y:4,width:18,height:16),cornerSize:CGSize(width:2,height:2));p.move(to:CGPoint(x:9,y:4));p.addLine(to:CGPoint(x:9,y:20))
        case .close:
            p.move(to:CGPoint(x:6,y:6));p.addLine(to:CGPoint(x:18,y:18));p.move(to:CGPoint(x:6,y:18));p.addLine(to:CGPoint(x:18,y:6))
        case .chevron:p.move(to:CGPoint(x:9,y:5));p.addLine(to:CGPoint(x:16,y:12));p.addLine(to:CGPoint(x:9,y:19))
        }
        return p.applying(CGAffineTransform(scaleX:rect.width/24,y:rect.height/24))
    }
}
#endif
