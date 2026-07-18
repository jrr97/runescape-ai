package ai.runescape.gateway;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

record GatewayConfig(String runtimeUrl, String token, String sessionId) {
    private static final Path FILE = Path.of(System.getProperty("user.home"), ".runescape-ai", "gateway.properties");

    static GatewayConfig load() throws IOException {
        Properties properties = new Properties();
        if (Files.exists(FILE)) {
            try (InputStream input = Files.newInputStream(FILE)) { properties.load(input); }
        }
        String url = value("RUNESCAPE_RUNTIME_URL", properties, "runtime.url", "ws://127.0.0.1:4310/v1/gateway");
        String token = value("RUNESCAPE_GATEWAY_TOKEN", properties, "gateway.token", "");
        String session = value("RUNESCAPE_SESSION", properties, "session.id", "default");
        if (token.isBlank()) throw new IOException("Configure gateway.token in " + FILE + " or RUNESCAPE_GATEWAY_TOKEN");
        if (!url.startsWith("ws://") && !url.startsWith("wss://")) throw new IOException("runtime.url must use ws:// or wss://");
        if (!session.matches("[a-zA-Z0-9_-]{1,64}")) throw new IOException("session.id is invalid");
        return new GatewayConfig(url, token, session);
    }

    private static String value(String environment, Properties properties, String key, String fallback) {
        String fromEnvironment = System.getenv(environment);
        return fromEnvironment == null || fromEnvironment.isBlank() ? properties.getProperty(key, fallback).trim() : fromEnvironment.trim();
    }
}

