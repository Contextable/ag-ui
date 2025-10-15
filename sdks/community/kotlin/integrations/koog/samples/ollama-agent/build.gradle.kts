import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile

plugins {
    kotlin("jvm")
    application
}

group = "com.agui"
version = "0.1.0"

repositories {
    google()
    mavenCentral()
}

dependencies {
    implementation(project(":kotlin-core"))
    implementation(project(":kotlin-server"))
    implementation(project(":kotlin-koog-adapter"))

    implementation("io.ktor:ktor-server-core:3.2.3")
    implementation("io.ktor:ktor-server-cio:3.2.3")
    implementation("io.ktor:ktor-server-content-negotiation:3.2.3")
    implementation("io.ktor:ktor-serialization-kotlinx-json:3.2.3")
    implementation("io.ktor:ktor-client-core:3.2.3")
    implementation("io.ktor:ktor-client-cio:3.2.3")
    implementation("io.ktor:ktor-client-content-negotiation:3.2.3")
    implementation("io.ktor:ktor-serialization-kotlinx-json:3.2.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
}

application {
    mainClass.set("com.agui.integrations.koog.sample.OllamaKoogServerKt")
}

tasks.withType<KotlinJvmCompile>().configureEach {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }
}
