# Community Kotlin SDK – Test Execution Notes

## Running the full test suite
```
bash build.sh check
```
- Runs from `sdks/community/kotlin/` and delegates to the Gradle wrapper under `library/`.
- Requires access to the Android SDK. Either export `ANDROID_HOME=/Users/mark/Library/Android/sdk` (or equivalent) before running, or add `sdk.dir=/Users/mark/Library/Android/sdk` to `library/local.properties`.
- Verified on 2024-11-24 after setting `sdk.dir`; build completes in ~1m17s on this machine.

## Running JVM-only tests
```
bash build.sh jvmTest
```
- Executes the JVM targets for `:kotlin-core`, `:kotlin-client`, and `:kotlin-tools` without touching Android/iOS toolchains.
- Completed successfully on 2024-11-24 (build time ~9s) on the current branch.

## Tips
- `build.sh` currently uses Windows line endings; invoking it with `bash` avoids the `/bin/bash^M` interpreter error.
- Subsequent Gradle runs are faster thanks to the daemon; use `--no-daemon` if you need isolated runs.
