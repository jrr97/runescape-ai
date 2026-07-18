package ai.runescape.gateway;

import com.runemate.game.api.hybrid.entities.GameObject;
import com.runemate.game.api.hybrid.entities.Item;
import com.runemate.game.api.hybrid.entities.Npc;
import com.runemate.game.api.hybrid.entities.definitions.GameObjectDefinition;
import com.runemate.game.api.hybrid.entities.definitions.ItemDefinition;
import com.runemate.game.api.hybrid.entities.definitions.NpcDefinition;
import com.runemate.game.api.hybrid.location.Coordinate;

import java.util.List;
import java.util.Map;
import java.util.Objects;

final class Values {
    private Values() {}
    static Map<String, Object> coordinate(Coordinate value) {
        return value == null ? Map.of() : Map.of("x", value.getX(), "y", value.getY(), "plane", value.getPlane());
    }
    static String coordinateRef(Coordinate value) {
        return value == null ? "unknown" : value.getX() + ":" + value.getY() + ":" + value.getPlane();
    }
    static double distance(Coordinate from, Coordinate to) {
        if (from == null || to == null || from.getPlane() != to.getPlane()) return Double.POSITIVE_INFINITY;
        return Math.max(Math.abs(from.getX() - to.getX()), Math.abs(from.getY() - to.getY()));
    }
    static List<String> actions(List<String> values) {
        return values == null ? List.of() : values.stream().filter(Objects::nonNull).distinct().toList();
    }
    static String name(Item item) { ItemDefinition value = item.getDefinition(); return safeName(value == null ? null : value.getName()); }
    static String name(Npc npc) { NpcDefinition value = npc.getActiveDefinition(); return safeName(value == null ? null : value.getName()); }
    static String name(GameObject object) { GameObjectDefinition value = object.getActiveDefinition(); return safeName(value == null ? null : value.getName()); }
    private static String safeName(String value) { return value == null || value.isBlank() || "null".equalsIgnoreCase(value) ? "Unknown" : value; }
}
