rootProject.name = "ag-ui-kotlin-sdk"

pluginManagement {
    repositories {
        google()
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

// Enable version catalog
enableFeaturePreview("TYPESAFE_PROJECT_ACCESSORS")

// Include all modules
include(":kotlin-core")
include(":kotlin-client")
include(":kotlin-tools")
include(":kotlin-server")
include(":kotlin-koog-adapter")
include(":kotlin-koog-sample-ollama")

// Map module directories to artifact names
project(":kotlin-core").projectDir = file("core")
project(":kotlin-client").projectDir = file("client")
project(":kotlin-tools").projectDir = file("tools")
project(":kotlin-server").projectDir = file("server")
project(":kotlin-koog-adapter").projectDir = file("../integrations/koog/adapter")
project(":kotlin-koog-sample-ollama").projectDir = file("../integrations/koog/samples/ollama-agent")

