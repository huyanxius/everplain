# Build and native visual acceptance

The user already built and used the earlier Library v1 on their Mac. Its historical logs remain under `verification/` and `macos-build.log`. The expanded revision was developed on Linux x86_64: it has no Apple SDK or native macOS runtime result yet.

Run `./scripts/build-app.sh release` on macOS with Xcode, or `debug` for an explicitly configured loopback service. The script checks bundled sources, runs portable tests, builds the actual SwiftUI/AppKit branch and copies `Everplain_EverplainMac.bundle` into `Everplain.app/Contents/Resources`. Save the new log separately as `revision-build.log`.

Follow `MAC-验收步骤.md` and `VALIDATION.md`. The user has explicitly authorized actual native-app screenshots; capture only the running Mac application at matched Web viewport dimensions. Check login/setup, Home/conversation, account/Soul/Memory, library/reader/graph and the research workspace. The former four-page scope is superseded by the expanded core migration.

No user-Mac operation, paid Mac service, VM setup, signing credential, remote CI run or production mutation was performed during this cloud revision. The supplied CI file is a template only. A portable test or Linux syntax parse cannot substitute for an Apple SDK build, accessible native interaction or screenshot comparison.
