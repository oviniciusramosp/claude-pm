## Platform Instructions: iOS / iPadOS

> Injected by the Product Manager automation system when `PLATFORM_PRESET=ios`.

### Pre-Flight: Simulator Health Check

Before running any build or test that targets the iOS Simulator, always verify the simulator is healthy:

```bash
# List booted simulators
xcrun simctl list devices booted

# If no simulator is booted, boot the default one
xcrun simctl boot "iPhone 16 Pro"

# Verify the simulator runtime is available
xcrun simctl list runtimes
```

If `xcrun simctl list devices booted` returns nothing and booting fails, the simulator runtime may be missing or corrupt. Run:
```bash
# Check available runtimes
xcrun simctl list runtimes available
# If the desired runtime is missing, it must be installed via Xcode > Settings > Platforms
```

**CRITICAL**: Never assume the simulator is running. Always check before invoking `xcodebuild test` or `xcodebuild build`.

### xcodebuild Best Practices

#### Build Commands

Always use explicit destination and scheme flags:

```bash
# Build for simulator
xcodebuild build \
  -scheme "YourScheme" \
  -destination "platform=iOS Simulator,name=iPhone 16 Pro" \
  -configuration Debug \
  -quiet \
  2>&1

# Build for testing
xcodebuild build-for-testing \
  -scheme "YourScheme" \
  -destination "platform=iOS Simulator,name=iPhone 16 Pro" \
  -configuration Debug \
  -quiet \
  2>&1
```

#### Test Commands

```bash
# Run tests with timeout and retry
xcodebuild test \
  -scheme "YourScheme" \
  -destination "platform=iOS Simulator,name=iPhone 16 Pro" \
  -retry-tests-on-failure \
  -test-timeouts-enabled YES \
  -default-test-execution-time-allowance 120 \
  -maximum-test-execution-time-allowance 300 \
  -resultBundlePath TestResults.xcresult \
  2>&1
```

**Key flags**:
- `-retry-tests-on-failure`: Automatically retries flaky tests once.
- `-test-timeouts-enabled YES`: Prevents tests from hanging indefinitely.
- `-default-test-execution-time-allowance 120`: Default per-test timeout (seconds).
- `-maximum-test-execution-time-allowance 300`: Hard per-test timeout (seconds).
- `-resultBundlePath`: Saves structured test results for debugging.
- `-quiet`: Reduces log noise during builds (omit for debugging build failures).

#### Destination Matching

If the exact simulator name is not found, xcodebuild will fail silently or pick the wrong device. To verify available destinations:
```bash
xcodebuild -scheme "YourScheme" -showdestinations 2>&1 | head -30
```

Prefer generic platform destinations when the exact device name is uncertain:
```bash
-destination "platform=iOS Simulator,OS=latest,name=iPhone 16 Pro"
```

### Simulator Recovery on Failure

When builds or tests fail due to simulator issues (crash, hang, CoreSimulator errors), apply this recovery sequence:

```bash
# Step 1: Shutdown all simulators
xcrun simctl shutdown all

# Step 2: If shutdown hangs or fails, force-kill simulator processes
killall -9 Simulator 2>/dev/null || true
killall -9 com.apple.CoreSimulator.CoreSimulatorService 2>/dev/null || true

# Step 3: Erase the problematic simulator (resets to factory state)
xcrun simctl erase "iPhone 16 Pro"

# Step 4: Re-boot the simulator
xcrun simctl boot "iPhone 16 Pro"

# Step 5: Wait for the simulator to reach a stable state
sleep 5
xcrun simctl list devices booted
```

**When to apply recovery**:
- `xcodebuild` exits with code 65 AND stderr contains `SimDeviceBootError` or `CoreSimulatorService`
- `xcodebuild` hangs beyond the task timeout
- stderr contains `Unable to boot the Simulator` or `Failed to create SimDeviceSet`
- Tests fail with `testmanagerd` connection errors

After recovery, **retry the build/test command once**. If it fails again, report the failure — do not loop.

### Common Crash Patterns

#### SwiftData ModelContainer Initialization

SwiftData `ModelContainer` can crash on simulator when the schema has changed and existing data is incompatible. Symptoms:
- `EXC_BREAKPOINT` in `SwiftData.ModelContainer.init` or `ModelContainerFactory`
- `Fatal error: Failed to find a currently active container for ...`
- Migration errors mentioning schema versions

**Fix**: Erase the simulator data before running:
```bash
xcrun simctl erase "iPhone 16 Pro"
```

Or delete only the app data:
```bash
# Find the app's data container
xcrun simctl get_app_container booted "com.your.bundleId" data
# Delete it
rm -rf "<path_from_above>"
```

#### CoreData / SwiftData Migration Failures

If you see `NSMigrationError`, `NSPersistentStoreIncompatibleVersionHashError`, or `The model used to open the store is incompatible`:
1. The data model schema changed without a proper migration.
2. Erase the simulator (`xcrun simctl erase`) to start fresh.
3. If the task requires migration support, implement a `SchemaMigrationPlan`.

#### Preview Crashes and SwiftUI Canvas

SwiftUI previews run in a separate process and often crash independently of the app. If previews fail:
- They do NOT indicate a build or runtime failure.
- Ignore preview crashes unless the task specifically involves fixing previews.
- Focus on `xcodebuild build` and `xcodebuild test` results.

#### Keychain Access Errors

Simulator keychain issues (`errSecInteractionNotAllowed`, `The user name or passphrase you entered is not correct`):
```bash
# Reset keychain on simulator
xcrun simctl keychain booted reset
```

### Build/Test Workflow Pattern

For any task that involves building or testing an iOS project, follow this sequence:

1. **Pre-flight check**: `xcrun simctl list devices booted` — boot a simulator if needed.
2. **Clean build** (only if previous build failed): `xcodebuild clean -scheme "YourScheme" -quiet`
3. **Build**: `xcodebuild build -scheme "YourScheme" -destination "platform=iOS Simulator,name=iPhone 16 Pro" -quiet 2>&1`
4. **Test** (if applicable): `xcodebuild test -scheme "YourScheme" -destination "platform=iOS Simulator,name=iPhone 16 Pro" -retry-tests-on-failure -test-timeouts-enabled YES -default-test-execution-time-allowance 120 2>&1`
5. **On failure**: Apply simulator recovery, then retry once.
6. **Report**: Include the exit code and relevant stderr in your response.

### Derived Data Cleanup

When builds fail with stale cache errors, module map issues, or `No such module` errors:

```bash
# Option 1: Clean via xcodebuild
xcodebuild clean -scheme "YourScheme" -quiet

# Option 2: Delete DerivedData entirely (nuclear option)
rm -rf ~/Library/Developer/Xcode/DerivedData

# Option 3: Delete only the project's DerivedData
# Find it first:
xcodebuild -scheme "YourScheme" -showBuildSettings 2>/dev/null | grep BUILD_DIR
# Then delete the parent DerivedData folder
```

**When to clean DerivedData**:
- `No such module 'SomeModule'` after adding a dependency
- `Module map file not found` errors
- Build succeeds in Xcode GUI but fails via `xcodebuild` CLI
- After switching branches that change the dependency graph

**Avoid cleaning DerivedData preemptively** — it significantly slows down builds. Only clean when the build actually fails.

### Package Resolution (Swift Package Manager)

If `xcodebuild` fails with package resolution errors:

```bash
# Resolve packages explicitly
xcodebuild -resolvePackageDependencies \
  -scheme "YourScheme" \
  -clonedSourcePackagesDirPath .spm-cache \
  2>&1

# Then build with the same cache path
xcodebuild build \
  -scheme "YourScheme" \
  -destination "platform=iOS Simulator,name=iPhone 16 Pro" \
  -clonedSourcePackagesDirPath .spm-cache \
  -quiet \
  2>&1
```

### Timeout Guidance

iOS builds and test suites can be slow. Recommended timeouts:
- **Build only**: 5–10 minutes
- **Build + test suite**: 15–30 minutes
- **Large project full test**: up to 45 minutes

If the task's Claude timeout is insufficient for the expected build+test time, focus on building only and skip full test runs. Report that testing was skipped due to time constraints.
