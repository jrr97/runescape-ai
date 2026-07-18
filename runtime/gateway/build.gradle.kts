import com.runemate.game.api.bot.data.Category
import org.gradle.api.tasks.compile.JavaCompile

plugins {
    java
    id("com.runemate") version "1.6.2"
}

group = "ai.runescape.gateway"
version = "0.1.0"

java {
    toolchain { languageVersion.set(JavaLanguageVersion.of(17)) }
}

tasks.withType<JavaCompile>().configureEach {
    options.compilerArgs.addAll(listOf("-Xlint:deprecation", "-Xlint:unchecked"))
}

runemate {
    devMode = true
    autoLogin = true
    manifests {
        create("RuneScape AI Gateway") {
            mainClass = "ai.runescape.gateway.RuneScapeGatewayBot"
            tagline = "Thin routine execution gateway"
            description = "Connects RuneMate to the RuneScape AI runtime and executes authorized primitives."
            internalId = "runescape-ai-gateway"
            version = project.version.toString()
            categories(Category.OTHER)
        }
    }
}

