package ai.runescape.gateway;

import com.runemate.game.api.hybrid.entities.GameObject;
import com.runemate.game.api.hybrid.entities.Npc;
import com.runemate.game.api.hybrid.entities.Player;
import com.runemate.game.api.hybrid.entities.definitions.GameObjectDefinition;
import com.runemate.game.api.hybrid.entities.definitions.NpcDefinition;
import com.runemate.game.api.hybrid.entities.details.Locatable;
import com.runemate.game.api.hybrid.location.Area;
import com.runemate.game.api.hybrid.location.Coordinate;
import com.runemate.game.api.hybrid.location.navigation.Landmark;
import com.runemate.game.api.hybrid.location.navigation.Path;
import com.runemate.game.api.hybrid.region.GameObjects;
import com.runemate.game.api.hybrid.region.Npcs;
import com.runemate.game.api.hybrid.region.Players;
import com.runemate.pathfinder.Pathfinder;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

final class NearestFinder {
    private NearestFinder() {}

    static Map<String, Object> find(String requested, Pathfinder pathfinder) {
        String query = normalize(requested);
        if (query.isBlank()) throw new IllegalArgumentException("query is required");
        Player player = Players.getLocal(); Coordinate origin = player == null ? null : player.getServerPosition();
        if (origin == null) throw new IllegalStateException("Local player is unavailable");
        Match loaded = loaded(query, origin);
        if (loaded != null) return loaded.value(requested, origin);
        Landmark landmark = landmark(query);
        if (landmark != null) {
            Path path = pathfinder.pathBuilder().destination(landmark).findPath();
            Locatable last = path == null ? null : path.getLast(); Coordinate position = last == null ? null : last.getPosition();
            if (position != null) {
                Map<String, Object> result = base(requested, landmark.name().toLowerCase(Locale.ROOT), position, origin);
                result.put("found", true); result.put("kind", "landmark"); result.put("source", "runemate_web"); return result;
            }
        }
        Map<String, Object> miss = new LinkedHashMap<>();
        miss.put("found", false); miss.put("query", requested);
        return miss;
    }

    private static Match loaded(String query, Coordinate origin) {
        Area.Circular area = new Area.Circular(origin, 32); Match best = null;
        for (GameObject object : GameObjects.getLoadedWithin(area).asList()) {
            GameObjectDefinition definition = object.getActiveDefinition();
            if (definition != null) best = better(best, match(query, definition.getName(), definition.getActions(), "object",
                "object:" + object.getId() + ":" + Values.coordinateRef(object.getPosition()), object.getId(), object.getPosition(), origin));
        }
        for (Npc npc : Npcs.getLoadedWithin(area).asList()) {
            NpcDefinition definition = npc.getActiveDefinition();
            if (definition != null) best = better(best, match(query, definition.getName(), definition.getActions(), "npc",
                "npc:" + npc.getIndex() + ":" + npc.getId(), npc.getId(), npc.getServerPosition(), origin));
        }
        return best;
    }

    private static Match match(String query, String name, List<String> actions, String kind, String ref, int id, Coordinate position, Coordinate origin) {
        if (name == null || position == null) return null;
        String normalized = normalize(name); int quality = normalized.equals(query) ? 0 : normalized.contains(query) ? 1 : Integer.MAX_VALUE;
        if (actions != null) for (String action : actions) {
            String normalizedAction = normalize(action); int candidate = normalizedAction.equals(query) ? 0 : normalizedAction.contains(query) ? 2 : Integer.MAX_VALUE;
            quality = Math.min(quality, candidate);
        }
        return quality == Integer.MAX_VALUE ? null : new Match(kind, name, ref, id, position, Values.distance(origin, position), quality);
    }

    private static Match better(Match left, Match right) {
        if (right == null) return left; if (left == null) return right;
        return right.quality < left.quality || right.quality == left.quality && right.distance < left.distance ? right : left;
    }

    private static Landmark landmark(String query) {
        if (query.contains("deposit box")) return Landmark.DEPOSIT_BOX;
        if (query.contains("grand exchange") || query.equals("ge")) return Landmark.GRAND_EXCHANGE_CLERK;
        if (query.contains("prayer altar") || query.equals("altar")) return Landmark.PRAYER_ALTAR;
        if (query.contains("bank")) return Landmark.BANK;
        return null;
    }

    private static Map<String, Object> base(String query, String matched, Coordinate position, Coordinate origin) {
        Map<String, Object> value = new LinkedHashMap<>(); value.put("query", query); value.put("matched", matched);
        value.put("position", Values.coordinate(position)); value.put("distance", Values.distance(origin, position)); return value;
    }
    private static String normalize(String value) { return value == null ? "" : value.trim().toLowerCase(Locale.ROOT); }

    private record Match(String kind, String name, String ref, int id, Coordinate position, double distance, int quality) {
        Map<String, Object> value(String query, Coordinate origin) {
            Map<String, Object> value = base(query, name, position, origin); value.put("found", true);
            value.put("kind", kind); value.put("source", "loaded_scene");
            value.put("ref", ref); value.put("id", id); return value;
        }
    }
}
