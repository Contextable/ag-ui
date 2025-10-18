plugins {
    kotlin("jvm")
    kotlin("plugin.serialization")
    application
}

repositories {
    mavenCentral()
}

dependencies {
    implementation(project(":kotlin-core"))
    implementation(project(":kotlin-server"))
    implementation(project(":kotlin-tools"))
    implementation(project(":kotlin-koog"))

    val koogVersion = "0.5.1"

    implementation("ai.koog:prompt-executor-openai-client:$koogVersion")
    implementation("ai.koog:prompt-model:$koogVersion")
    implementation("ai.koog:prompt-llm:$koogVersion")
    implementation("ai.koog:koog-agents:$koogVersion")
    implementation("ai.koog:prompt-executor-llms:$koogVersion")

    implementation("io.ktor:ktor-server-cio:3.2.3")
    implementation("io.ktor:ktor-server-content-negotiation:3.2.3")
    implementation("io.ktor:ktor-serialization-kotlinx-json:3.2.3")
    implementation("io.ktor:ktor-server-sse:3.2.3")

    implementation("io.ktor:ktor-client-core:3.2.3")
    implementation("io.ktor:ktor-client-cio:3.2.3")
    implementation("io.ktor:ktor-client-content-negotiation:3.2.3")
    implementation("io.ktor:ktor-serialization-kotlinx-json:3.2.3")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    implementation("co.touchlab:kermit:2.0.6")

    testImplementation(kotlin("test"))
}

application {
    mainClass.set("com.agui.samples.koog.ollama.MainKt")
}

kotlin {
    jvmToolchain(21)
}

tasks.test {
    useJUnitPlatform()
}
