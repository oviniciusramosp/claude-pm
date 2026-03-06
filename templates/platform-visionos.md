## Platform Instructions: visionOS / Apple Vision Pro

> Injected by the Product Manager automation system when `PLATFORM_PRESET=visionos`.

### Apple Xcode MCP (Recommended)

The Xcode MCP server (`xcrun mcpbridge`) ships with Xcode 26+ and gives Claude direct access to build, test, and debug without shell commands. To add it to Claude Code:

```bash
claude mcp add --transport stdio xcode xcrun mcpbridge
```

Verify with `claude mcp list`. When the Xcode MCP is active, prefer its tools over raw `xcodebuild` calls for builds and test runs.

### Pre-Flight: Apple Vision Pro Simulator Health Check

Before running any build or test targeting the visionOS Simulator, always verify the simulator is ready:

```bash
# List booted simulators
xcrun simctl list devices booted

# Boot the Apple Vision Pro simulator if not running
xcrun simctl boot "Apple Vision Pro"

# Verify available runtimes
xcrun simctl list runtimes
```

If `xcrun simctl list devices booted` returns nothing and booting fails, the visionOS runtime may be missing. Install it via Xcode → Settings → Platforms → visionOS.

**CRITICAL**: Never assume the simulator is running. Always check before invoking `xcodebuild`.

### xcodebuild Best Practices for visionOS

#### Build Commands

```bash
# Build for visionOS Simulator
xcodebuild build \
  -scheme "YourScheme" \
  -destination "platform=visionOS Simulator,name=Apple Vision Pro" \
  -configuration Debug \
  -quiet \
  2>&1

# Build for testing
xcodebuild build-for-testing \
  -scheme "YourScheme" \
  -destination "platform=visionOS Simulator,name=Apple Vision Pro" \
  -configuration Debug \
  -quiet \
  2>&1
```

#### Test Commands

```bash
xcodebuild test \
  -scheme "YourScheme" \
  -destination "platform=visionOS Simulator,name=Apple Vision Pro" \
  -retry-tests-on-failure \
  -test-timeouts-enabled YES \
  -default-test-execution-time-allowance 120 \
  -maximum-test-execution-time-allowance 300 \
  -resultBundlePath TestResults.xcresult \
  2>&1
```

#### Destination Matching

To list available visionOS destinations:

```bash
xcodebuild -scheme "YourScheme" -showdestinations 2>&1 | grep -i "vision\|visionOS"
```

Use the generic form if the exact name is uncertain:

```bash
-destination "platform=visionOS Simulator,OS=latest,name=Apple Vision Pro"
```

### Simulator Recovery on Failure

When builds or tests fail due to simulator issues:

```bash
# Step 1: Shutdown all simulators
xcrun simctl shutdown all

# Step 2: Force-kill if hung
killall -9 Simulator 2>/dev/null || true
killall -9 com.apple.CoreSimulator.CoreSimulatorService 2>/dev/null || true

# Step 3: Erase the Apple Vision Pro simulator
xcrun simctl erase "Apple Vision Pro"

# Step 4: Re-boot
xcrun simctl boot "Apple Vision Pro"

# Step 5: Wait for stable state
sleep 5
xcrun simctl list devices booted
```

**When to apply recovery**:
- `xcodebuild` exits with code 65 AND stderr contains `SimDeviceBootError` or `CoreSimulatorService`
- `xcodebuild` hangs beyond the task timeout
- stderr contains `Unable to boot the Simulator` or `Failed to create SimDeviceSet`
- Tests fail with `testmanagerd` connection errors

After recovery, **retry the build/test once**. If it fails again, report the failure — do not loop.

### RealityKit Patterns

RealityKit is the primary rendering framework on visionOS. Key patterns:

#### Entity-Component Architecture

Every object in a visionOS scene is an `Entity` with `Component`s. Do not subclass `Entity` — compose behavior via components instead:

```swift
// Prefer: Component-based composition
struct SpinComponent: Component {
    var speed: Float = 1.0
}

class SpinSystem: System {
    required init(scene: Scene) {}
    func update(context: SceneUpdateContext) {
        for entity in context.entities(matching: .init(where: .has(SpinComponent.self)), updatingSystemWhen: .rendering) {
            let spin = entity.components[SpinComponent.self]!
            entity.transform.rotation *= simd_quatf(angle: spin.speed * Float(context.deltaTime), axis: [0, 1, 0])
        }
    }
}
```

#### Anchoring in visionOS

visionOS scenes anchor entities to the real world using `AnchorEntity`:

```swift
// Anchor to a specific position in world space
let anchor = AnchorEntity(.world(transform: .init(translation: [0, 1.5, -2])))
arView.scene.addAnchor(anchor)

// For fully immersive spaces, use absolute world anchors
// For windowed volumes, use .world or .scene anchors
```

#### Immersive Space vs. Window Volume

- **WindowGroup** — 2D/3D window floating in the user's space. Uses standard SwiftUI views.
- **ImmersiveSpace** — Full passthrough or fully immersive AR/VR experience.

```swift
@main
struct MyApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
        ImmersiveSpace(id: "ImmersiveView") { ImmersiveView() }
    }
}
```

Open an immersive space from a view:

```swift
@Environment(\.openImmersiveSpace) var openImmersiveSpace
Button("Enter") { Task { await openImmersiveSpace(id: "ImmersiveView") } }
```

#### Input on visionOS

visionOS uses **gaze + pinch** for primary interaction — there is no touch screen. Use `.hoverEffect()` and standard SwiftUI gestures:

```swift
// Gaze highlight + tap gesture
Model3D(named: "sphere")
    .hoverEffect()
    .gesture(TapGesture().onEnded { _ in
        // handle tap
    })
```

Do NOT use `UITapGestureRecognizer` or touch-based UIKit APIs directly — they are unavailable on visionOS.

### SwiftUI for visionOS

visionOS is a SwiftUI-first platform. Key differences from iOS:

- Use **ornaments** (`.ornament` modifier) for persistent controls outside the window bounds.
- Use **volumetric windows** (`WindowGroup(volumetricContentScaleFactor:)`) for 3D content in a bounded volume.
- **Glass background** is the default material for windows (`GlassBackgroundEffect`).
- System navigation uses **Tab views** or custom ornament-based nav — `NavigationStack` works inside windows.
- **Safe areas** are less relevant; content fills the window bounds.

```swift
ContentView()
    .ornament(attachmentAnchor: .scene(.bottom)) {
        HStack { Button("A") {} ; Button("B") {} }
            .glassBackgroundEffect()
    }
```

### Build/Test Workflow Pattern

For any task involving building or testing a visionOS project:

1. **Pre-flight**: `xcrun simctl list devices booted` — boot Apple Vision Pro simulator if needed.
2. **Build**: `xcodebuild build -scheme "YourScheme" -destination "platform=visionOS Simulator,name=Apple Vision Pro" -quiet 2>&1`
3. **Test** (if applicable): Use the full test command above with retry and timeout flags.
4. **On failure**: Apply simulator recovery, then retry once.
5. **Report**: Include exit code and relevant stderr.

### Common Crash Patterns

#### SwiftData / ModelContainer on visionOS

Same as iOS — erase simulator data on schema changes:

```bash
xcrun simctl erase "Apple Vision Pro"
```

#### Missing Capabilities

visionOS requires specific entitlements for spatial features:

- `com.apple.developer.arkit` — ARKit access
- `NSWorldSensingUsageDescription` — world sensing (plane detection, scene understanding)
- `NSHandsTrackingUsageDescription` — hand tracking

Add these to your `.entitlements` file and `Info.plist` before building.

### Package Resolution (Swift Package Manager)

```bash
xcodebuild -resolvePackageDependencies \
  -scheme "YourScheme" \
  -clonedSourcePackagesDirPath .spm-cache \
  2>&1

xcodebuild build \
  -scheme "YourScheme" \
  -destination "platform=visionOS Simulator,name=Apple Vision Pro" \
  -clonedSourcePackagesDirPath .spm-cache \
  -quiet \
  2>&1
```

### Timeout Guidance

visionOS builds can be slower than iOS due to heavier shader compilation:

- **Build only**: 8–15 minutes
- **Build + test suite**: 20–35 minutes
- **Large project full test**: up to 50 minutes

If the Claude timeout is insufficient, focus on building only and report that testing was skipped.
