plugins {
    kotlin("multiplatform")
    kotlin("plugin.serialization")
    id("maven-publish")
    id("signing")
}

group = "com.agui"
version = "0.2.1"

kotlin {
    targets.configureEach {
        compilations.configureEach {
            compileTaskProvider.configure {
                compilerOptions {
                    languageVersion.set(org.jetbrains.kotlin.gradle.dsl.KotlinVersion.KOTLIN_2_2)
                    apiVersion.set(org.jetbrains.kotlin.gradle.dsl.KotlinVersion.KOTLIN_2_2)
                    freeCompilerArgs.add("-opt-in=kotlinx.serialization.ExperimentalSerializationApi")
                }
            }
        }
    }

    jvm {
        compilations.all {
            compileTaskProvider.configure {
                compilerOptions {
                    jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
                }
            }
        }
        testRuns["test"].executionTask.configure {
            useJUnitPlatform()
        }
    }

    sourceSets {
        val commonMain by getting {
            dependencies {
                implementation(project(":kotlin-core"))
                implementation(project(":kotlin-tools"))
                implementation(libs.kotlinx.coroutines.core)
                implementation(libs.kotlinx.serialization.json)
                implementation(libs.kermit)
            }
        }

        val commonTest by getting {
            dependencies {
                implementation(kotlin("test"))
                implementation(libs.kotlinx.coroutines.test)
                implementation(libs.turbine)
            }
        }

        val jvmMain by getting
        val jvmTest by getting
    }
}

publishing {
    publications {
        withType<MavenPublication> {
            pom {
                name.set("kotlin-koog")
                description.set("Koog adapter utilities for AG-UI agents")
                url.set("https://github.com/ag-ui-protocol/ag-ui")

                licenses {
                    license {
                        name.set("MIT License")
                        url.set("https://opensource.org/licenses/MIT")
                    }
                }

                developers {
                    developer {
                        id.set("contextablemark")
                        name.set("Mark Fogle")
                        email.set("mark@contextable.com")
                    }
                }

                scm {
                    url.set("https://github.com/ag-ui-protocol/ag-ui")
                    connection.set("scm:git:git://github.com/ag-ui-protocol/ag-ui.git")
                    developerConnection.set("scm:git:ssh://github.com:ag-ui-protocol/ag-ui.git")
                }
            }
        }
    }
}

signing {
    val signingKey: String? by project
    val signingPassword: String? by project

    if (signingKey != null && signingPassword != null) {
        useInMemoryPgpKeys(signingKey, signingPassword)
        sign(publishing.publications)
    }
}
