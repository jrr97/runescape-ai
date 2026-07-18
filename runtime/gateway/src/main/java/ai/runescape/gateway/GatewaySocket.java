package ai.runescape.gateway;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

final class GatewaySocket implements AutoCloseable {
    private static final Logger log = LogManager.getLogger(GatewaySocket.class);
    private final GatewayConfig config;
    private final Consumer<Map<String, Object>> requestSink;
    private final ScheduledExecutorService scheduler;
    private final HttpClient client;
    private final AtomicBoolean connecting = new AtomicBoolean();
    private final AtomicBoolean closed = new AtomicBoolean();
    private volatile WebSocket socket;
    private volatile int reconnectAttempt;

    GatewaySocket(GatewayConfig config, Consumer<Map<String, Object>> requestSink) {
        this.config = config;
        this.requestSink = requestSink;
        this.scheduler = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "runescape-ai-connection"); thread.setDaemon(true); return thread;
        });
        this.client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).executor(scheduler).build();
    }

    void start() { scheduler.execute(this::connect); }

    boolean connected() { return socket != null; }

    void respond(String id, boolean ok, Map<String, Object> result, String error) {
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("type", "response"); message.put("id", id); message.put("ok", ok);
        if (ok) message.put("result", result == null ? Map.of() : result); else message.put("error", error == null ? "Operation failed" : error);
        send(message);
    }

    private void connect() {
        if (closed.get() || socket != null || !connecting.compareAndSet(false, true)) return;
        client.newWebSocketBuilder()
            .header("Authorization", "Bearer " + config.token())
            .connectTimeout(Duration.ofSeconds(10))
            .buildAsync(URI.create(config.runtimeUrl()), new Listener())
            .whenComplete((connected, error) -> {
                connecting.set(false);
                if (error != null) { log.warn("RuneScape runtime connection failed: {}", error.getMessage()); scheduleReconnect(); }
            });
    }

    private void scheduleReconnect() {
        if (closed.get()) return;
        long delay = Math.min(30, 1L << Math.min(reconnectAttempt++, 5));
        scheduler.schedule(this::connect, delay, TimeUnit.SECONDS);
    }

    private void send(Map<String, Object> message) {
        WebSocket current = socket;
        if (current != null) current.sendText(Json.encode(message), true);
    }

    @Override
    public void close() {
        closed.set(true);
        WebSocket current = socket; socket = null;
        if (current != null) current.sendClose(WebSocket.NORMAL_CLOSURE, "Gateway stopped");
        scheduler.shutdownNow();
    }

    private final class Listener implements WebSocket.Listener {
        private final StringBuilder fragments = new StringBuilder();

        @Override
        public void onOpen(WebSocket webSocket) {
            socket = webSocket; reconnectAttempt = 0; webSocket.request(1);
            Map<String, Object> hello = new LinkedHashMap<>();
            hello.put("type", "hello"); hello.put("sessionId", config.sessionId()); hello.put("protocolVersion", 1);
            hello.put("gatewayVersion", "0.1.0"); hello.put("ready", true); hello.put("operations", RuneScapeGatewayBot.OPERATIONS);
            send(hello);
            log.info("Connected to RuneScape runtime as session {}", config.sessionId());
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            fragments.append(data);
            if (last) {
                try {
                    Map<String, Object> message = Json.object(fragments.toString());
                    if ("request".equals(message.get("type"))) requestSink.accept(message);
                } catch (Exception exception) { log.warn("Ignoring invalid runtime message: {}", exception.getMessage()); }
                fragments.setLength(0);
            }
            webSocket.request(1); return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            if (socket == webSocket) socket = null;
            log.info("RuneScape runtime disconnected ({})", statusCode); scheduleReconnect(); return null;
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            if (socket == webSocket) socket = null;
            log.warn("RuneScape runtime connection error: {}", error.getMessage()); scheduleReconnect();
        }
    }
}
