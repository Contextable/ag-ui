FROM gradle:8.10.2-jdk21 AS build
WORKDIR /workspace
COPY . .
WORKDIR /workspace/sdks/community/kotlin/library
RUN ./gradlew --no-daemon :examples:koog-ollama:clean :examples:koog-ollama:installDist

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/sdks/community/kotlin/examples/koog-ollama/build/install/koog-ollama /app
EXPOSE 8080
ENV SERVER_PORT=8080
CMD ["./bin/koog-ollama"]
