FROM gradle:8.10.2-jdk17 AS build
WORKDIR /workspace

# Copy the entire repository so the Gradle project graph is available
COPY ../../../../../.. /workspace

WORKDIR /workspace/sdks/community/kotlin/library
RUN ./gradlew :kotlin-koog-sample-ollama:installDist

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /workspace/sdks/community/kotlin/integrations/koog/samples/ollama-agent/build/install/kotlin-koog-sample-ollama/ ./app

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/app/bin/kotlin-koog-sample-ollama"]
