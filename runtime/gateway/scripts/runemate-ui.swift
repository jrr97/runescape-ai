import AppKit
import CoreGraphics
import Foundation

struct WindowBounds: Encodable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

enum UiError: Error, CustomStringConvertible {
    case runeMateNotRunning
    case windowNotFound
    case invalidArguments

    var description: String {
        switch self {
        case .runeMateNotRunning: return "RuneMate is not running"
        case .windowNotFound: return "RuneMate has no visible main window"
        case .invalidArguments: return "Usage: runemate-ui [inspect|start-session]"
        }
    }
}

@main
struct RuneMateUi {
    static func main() throws {
        let command = CommandLine.arguments.dropFirst().first ?? "start-session"
        guard command == "inspect" || command == "start-session" else {
            throw UiError.invalidArguments
        }

        guard let app = runeMateApplication() else { throw UiError.runeMateNotRunning }
        app.activate(options: [.activateAllWindows])
        Thread.sleep(forTimeInterval: 0.5)

        guard let bounds = runeMateWindow(pid: app.processIdentifier) else {
            throw UiError.windowNotFound
        }

        if command == "start-session" {
            // Coordinates are relative to RuneMate's main window. RuneMate currently
            // exposes no supported automation API for this launcher flow.
            click(bounds, x: 610, y: 165) // RuneScape AI Gateway card
            click(bounds, x: 300, y: 67)  // Start a Bot
            click(bounds, x: 620, y: 93)  // Select the gateway bot/client row
            click(bounds, x: 612, y: 710) // Start Session
        }

        let output = try JSONEncoder().encode(bounds)
        FileHandle.standardOutput.write(output)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }

    private static func runeMateApplication() -> NSRunningApplication? {
        NSWorkspace.shared.runningApplications.first {
            $0.localizedName == "RuneMate" || $0.bundleURL?.path == "/Applications/RuneMate.app"
        }
    }

    private static func runeMateWindow(pid: pid_t) -> WindowBounds? {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let windows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }

        return windows.compactMap { window -> WindowBounds? in
            guard (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid,
                  (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                  let dictionary = window[kCGWindowBounds as String] as? NSDictionary,
                  let rectangle = CGRect(dictionaryRepresentation: dictionary),
                  rectangle.width >= 700,
                  rectangle.height >= 700 else { return nil }
            return WindowBounds(
                x: rectangle.origin.x,
                y: rectangle.origin.y,
                width: rectangle.width,
                height: rectangle.height
            )
        }.max { $0.width * $0.height < $1.width * $1.height }
    }

    private static func click(_ bounds: WindowBounds, x: Double, y: Double) {
        let point = CGPoint(x: bounds.x + x, y: bounds.y + y)
        let source = CGEventSource(stateID: .hidSystemState)
        CGEvent(mouseEventSource: source, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 0.12)
        CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        Thread.sleep(forTimeInterval: 1.0)
    }
}
