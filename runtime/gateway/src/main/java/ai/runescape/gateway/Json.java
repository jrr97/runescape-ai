package ai.runescape.gateway;

import java.lang.reflect.Array;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class Json {
    private Json() {}

    static String encode(Object value) {
        if (value == null) return "null";
        if (value instanceof String text) return quote(text);
        if (value instanceof Number || value instanceof Boolean) return String.valueOf(value);
        if (value instanceof Map<?, ?> map) {
            StringBuilder out = new StringBuilder("{"); boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) out.append(','); first = false;
                out.append(quote(String.valueOf(entry.getKey()))).append(':').append(encode(entry.getValue()));
            }
            return out.append('}').toString();
        }
        if (value instanceof Collection<?> collection) {
            StringBuilder out = new StringBuilder("["); boolean first = true;
            for (Object item : collection) { if (!first) out.append(','); first = false; out.append(encode(item)); }
            return out.append(']').toString();
        }
        if (value.getClass().isArray()) {
            StringBuilder out = new StringBuilder("[");
            for (int index = 0; index < Array.getLength(value); index++) { if (index > 0) out.append(','); out.append(encode(Array.get(value, index))); }
            return out.append(']').toString();
        }
        return quote(String.valueOf(value));
    }

    static Map<String, Object> object(String text) {
        Object value = new Parser(text).parse();
        if (!(value instanceof Map<?, ?> map)) throw new IllegalArgumentException("JSON value must be an object");
        Map<String, Object> result = new LinkedHashMap<>();
        map.forEach((key, item) -> result.put(String.valueOf(key), item));
        return result;
    }

    private static String quote(String text) {
        StringBuilder out = new StringBuilder(text.length() + 2).append('"');
        for (int index = 0; index < text.length(); index++) {
            char character = text.charAt(index);
            switch (character) {
                case '"' -> out.append("\\\""); case '\\' -> out.append("\\\\");
                case '\b' -> out.append("\\b"); case '\f' -> out.append("\\f");
                case '\n' -> out.append("\\n"); case '\r' -> out.append("\\r"); case '\t' -> out.append("\\t");
                default -> { if (character < 0x20) out.append(String.format("\\u%04x", (int) character)); else out.append(character); }
            }
        }
        return out.append('"').toString();
    }

    private static final class Parser {
        private final String text; private int index;
        private Parser(String text) { this.text = text; }
        private Object parse() {
            Object value = value(); whitespace();
            if (index != text.length()) throw error("trailing content");
            return value;
        }
        private Object value() {
            whitespace(); if (index >= text.length()) throw error("unexpected end");
            return switch (text.charAt(index)) {
                case '{' -> object(); case '[' -> array(); case '"' -> string();
                case 't' -> literal("true", true); case 'f' -> literal("false", false); case 'n' -> literal("null", null);
                default -> number();
            };
        }
        private Map<String, Object> object() {
            expect('{'); Map<String, Object> result = new LinkedHashMap<>(); whitespace();
            if (take('}')) return result;
            do { whitespace(); String key = string(); whitespace(); expect(':'); result.put(key, value()); whitespace(); } while (take(','));
            expect('}'); return result;
        }
        private List<Object> array() {
            expect('['); List<Object> result = new ArrayList<>(); whitespace();
            if (take(']')) return result;
            do { result.add(value()); whitespace(); } while (take(','));
            expect(']'); return result;
        }
        private String string() {
            expect('"'); StringBuilder result = new StringBuilder();
            while (index < text.length()) {
                char character = text.charAt(index++); if (character == '"') return result.toString();
                if (character != '\\') { result.append(character); continue; }
                if (index >= text.length()) throw error("unterminated escape");
                char escape = text.charAt(index++);
                switch (escape) {
                    case '"', '\\', '/' -> result.append(escape); case 'b' -> result.append('\b'); case 'f' -> result.append('\f');
                    case 'n' -> result.append('\n'); case 'r' -> result.append('\r'); case 't' -> result.append('\t');
                    case 'u' -> { if (index + 4 > text.length()) throw error("bad unicode escape"); result.append((char) Integer.parseInt(text.substring(index, index + 4), 16)); index += 4; }
                    default -> throw error("bad escape");
                }
            }
            throw error("unterminated string");
        }
        private Object number() {
            int start = index;
            while (index < text.length() && "-+0123456789.eE".indexOf(text.charAt(index)) >= 0) index++;
            if (start == index) throw error("expected value");
            String raw = text.substring(start, index);
            try { return raw.contains(".") || raw.contains("e") || raw.contains("E") ? Double.parseDouble(raw) : Long.parseLong(raw); }
            catch (NumberFormatException exception) { throw error("bad number"); }
        }
        private Object literal(String literal, Object value) {
            if (!text.startsWith(literal, index)) throw error("bad literal"); index += literal.length(); return value;
        }
        private void whitespace() { while (index < text.length() && Character.isWhitespace(text.charAt(index))) index++; }
        private boolean take(char expected) { if (index < text.length() && text.charAt(index) == expected) { index++; return true; } return false; }
        private void expect(char expected) { if (!take(expected)) throw error("expected '" + expected + "'"); }
        private IllegalArgumentException error(String message) { return new IllegalArgumentException(message + " at character " + index); }
    }
}
