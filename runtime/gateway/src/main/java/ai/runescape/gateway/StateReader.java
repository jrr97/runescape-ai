package ai.runescape.gateway;

import com.runemate.game.api.hybrid.entities.GameObject;
import com.runemate.game.api.hybrid.entities.GroundItem;
import com.runemate.game.api.hybrid.entities.Npc;
import com.runemate.game.api.hybrid.entities.Player;
import com.runemate.game.api.hybrid.entities.definitions.GameObjectDefinition;
import com.runemate.game.api.hybrid.entities.definitions.ItemDefinition;
import com.runemate.game.api.hybrid.entities.definitions.NpcDefinition;
import com.runemate.game.api.hybrid.local.Skill;
import com.runemate.game.api.hybrid.local.hud.interfaces.Bank;
import com.runemate.game.api.hybrid.local.hud.interfaces.ChatDialog;
import com.runemate.game.api.hybrid.local.hud.interfaces.Equipment;
import com.runemate.game.api.hybrid.local.hud.interfaces.Inventory;
import com.runemate.game.api.hybrid.local.hud.interfaces.InterfaceComponent;
import com.runemate.game.api.hybrid.local.hud.interfaces.Interfaces;
import com.runemate.game.api.hybrid.local.hud.interfaces.Shop;
import com.runemate.game.api.hybrid.local.hud.interfaces.SpriteItem;
import com.runemate.game.api.hybrid.location.Area;
import com.runemate.game.api.hybrid.location.Coordinate;
import com.runemate.game.api.hybrid.location.navigation.Traversal;
import com.runemate.game.api.hybrid.net.GrandExchange;
import com.runemate.game.api.hybrid.region.GameObjects;
import com.runemate.game.api.hybrid.region.GroundItems;
import com.runemate.game.api.hybrid.region.Npcs;
import com.runemate.game.api.hybrid.region.Players;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

final class StateReader {
    private static final int RADIUS = 32;
    private static final int LIMIT = 40;
    private static final Set<String> ALL = Set.of(
        "status", "movement", "player", "skills", "inventory", "equipment",
        "nearby_npcs", "nearby_objects", "nearby_ground_items", "bank", "shop", "grand_exchange", "dialogue", "interfaces"
    );

    Map<String, Object> read(Set<String> requested, long revision, String activeRequest) {
        Set<String> components = requested.isEmpty() ? ALL : requested;
        Player player = Players.getLocal();
        Coordinate position = player == null ? null : player.getServerPosition();
        Map<String, Object> state = new LinkedHashMap<>();
        state.put("revision", revision); state.put("ready", player != null);
        if (components.contains("status")) state.put("status", Map.of("connected", true, "activeRequest", activeRequest == null ? "" : activeRequest));
        if (components.contains("movement")) state.put("movement", Map.of("runEnabled", Traversal.isRunEnabled(), "runEnergy", Traversal.getRunEnergy()));
        if (components.contains("player")) state.put("player", player(player));
        if (components.contains("skills")) state.put("skills", skills());
        if (components.contains("inventory")) {
            state.put("inventory", items(Inventory.getItems().asList()));
            SpriteItem selected = Inventory.getSelectedItem();
            state.put("selectedInventoryItem", selected == null ? null : item(selected));
        }
        if (components.contains("equipment")) state.put("equipment", items(Equipment.getItems().asList()));
        if (components.contains("nearby_npcs")) state.put("nearbyNpcs", npcs(position));
        if (components.contains("nearby_objects")) state.put("nearbyObjects", objects(position));
        if (components.contains("nearby_ground_items")) state.put("nearbyGroundItems", groundItems(position));
        if (components.contains("bank")) {
            state.put("bank", Map.of("open", Bank.isOpen(), "items", Bank.isOpen() ? items(Bank.getItems().asList()) : List.of()));
        }
        if (components.contains("shop")) {
            Map<String, Object> shop = new LinkedHashMap<>();
            shop.put("open", Shop.isOpen()); shop.put("name", Shop.isOpen() ? Shop.getName() : "");
            shop.put("items", Shop.isOpen() ? items(Shop.getItems().asList()) : List.of()); state.put("shop", shop);
        }
        if (components.contains("grand_exchange")) state.put("grandExchange", grandExchange());
        if (components.contains("dialogue")) state.put("dialogue", dialogue());
        if (components.contains("interfaces")) state.put("interfaces", interfaces());
        return state;
    }

    Map<String, Object> inventoryItem(String name, int id) {
        var query = Inventory.newQuery();
        if (name != null && !name.isBlank()) query.names(name);
        if (id >= 0) query.ids(id);
        SpriteItem match = query.results().first();
        if (match == null) return Map.of("found", false);
        Map<String, Object> value = new LinkedHashMap<>(item(match)); value.put("found", true); return value;
    }

    private static Object player(Player player) {
        if (player == null) return null;
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("name", player.getName()); value.put("position", Values.coordinate(player.getServerPosition()));
        value.put("animation", player.getAnimationId()); value.put("moving", player.isMoving()); value.put("idle", player.isIdle());
        value.put("combatLevel", player.getCombatLevel()); value.put("target", player.getTarget() == null ? null : player.getTarget().getName());
        return value;
    }

    private static Map<String, Object> skills() {
        Map<String, Object> result = new LinkedHashMap<>();
        for (Skill skill : Skill.values()) {
            String name = skill.name().toLowerCase(Locale.ROOT);
            if ("constitution".equals(name)) name = "hitpoints";
            result.put(name, Map.of(
                "baseLevel", skill.getBaseLevel(), "currentLevel", skill.getCurrentLevel(), "experience", skill.getExperience()
            ));
        }
        return result;
    }

    private static List<Map<String, Object>> items(List<SpriteItem> source) {
        List<Map<String, Object>> result = new ArrayList<>();
        for (SpriteItem item : source) result.add(item(item));
        return result;
    }

    private static Map<String, Object> item(SpriteItem item) {
        ItemDefinition definition = item.getDefinition();
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("id", item.getId()); value.put("name", Values.name(item)); value.put("quantity", item.getQuantity()); value.put("index", item.getIndex());
        value.put("actions", definition == null ? List.of() : item.getOrigin() == SpriteItem.Origin.EQUIPMENT
            ? Values.actions(definition.getWornActions()) : Values.actions(definition.getInventoryActions()));
        return value;
    }

    private static List<Map<String, Object>> npcs(Coordinate origin) {
        if (origin == null) return List.of();
        List<Map<String, Object>> result = new ArrayList<>();
        for (Npc npc : Npcs.newQuery().within(new Area.Circular(origin, RADIUS)).results().asList()) {
            NpcDefinition definition = npc.getActiveDefinition(); Coordinate position = npc.getServerPosition();
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("ref", "npc:" + npc.getIndex() + ":" + npc.getId()); value.put("id", npc.getId()); value.put("index", npc.getIndex());
            value.put("name", Values.name(npc)); value.put("position", Values.coordinate(position)); value.put("distance", Values.distance(origin, position));
            value.put("level", npc.getLevel()); value.put("animation", npc.getAnimationId());
            value.put("actions", definition == null ? List.of() : Values.actions(definition.getActions())); result.add(value);
        }
        return nearest(result);
    }

    private static List<Map<String, Object>> objects(Coordinate origin) {
        if (origin == null) return List.of();
        List<Map<String, Object>> result = new ArrayList<>();
        for (GameObject object : GameObjects.getLoadedWithin(new Area.Circular(origin, RADIUS)).asList()) {
            GameObjectDefinition definition = object.getActiveDefinition(); Coordinate position = object.getPosition();
            if (definition == null) continue;
            List<String> actions = Values.actions(definition.getActions()); String name = Values.name(object);
            if ("Unknown".equals(name) && actions.isEmpty()) continue;
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("ref", "object:" + object.getId() + ":" + Values.coordinateRef(position)); value.put("id", object.getId());
            value.put("name", name); value.put("position", Values.coordinate(position)); value.put("distance", Values.distance(origin, position));
            value.put("actions", actions); result.add(value);
        }
        return nearest(result);
    }

    private static List<Map<String, Object>> groundItems(Coordinate origin) {
        if (origin == null) return List.of();
        List<Map<String, Object>> result = new ArrayList<>();
        for (GroundItem item : GroundItems.getLoadedWithin(new Area.Circular(origin, RADIUS)).asList()) {
            Coordinate position = item.getPosition(); ItemDefinition definition = item.getDefinition(); Map<String, Object> value = new LinkedHashMap<>();
            value.put("ref", "ground:" + item.getId() + ":" + Values.coordinateRef(position)); value.put("id", item.getId()); value.put("name", Values.name(item));
            value.put("quantity", item.getQuantity()); value.put("position", Values.coordinate(position)); value.put("distance", Values.distance(origin, position));
            value.put("actions", definition == null ? List.of() : Values.actions(definition.getGroundActions())); result.add(value);
        }
        return nearest(result);
    }

    private static Map<String, Object> dialogue() {
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("open", ChatDialog.isOpen()); value.put("title", ChatDialog.getTitle()); value.put("text", ChatDialog.getText());
        ChatDialog.Continue continuation = ChatDialog.getContinue(); value.put("canContinue", continuation != null && continuation.isValid());
        List<Map<String, Object>> options = new ArrayList<>();
        for (ChatDialog.Option option : ChatDialog.getOptions()) options.add(Map.of("number", option.getNumber(), "text", option.getText()));
        value.put("options", options); return value;
    }

    private static Map<String, Object> grandExchange() {
        Map<String, Object> value = new LinkedHashMap<>(); value.put("open", GrandExchange.isOpen());
        GrandExchange.Screen screen = GrandExchange.getOpenedScreen();
        value.put("screen", screen == null ? "closed" : screen.name().toLowerCase(Locale.ROOT));
        List<Map<String, Object>> slots = new ArrayList<>();
        for (GrandExchange.Slot slot : GrandExchange.getSlots()) {
            Map<String, Object> entry = new LinkedHashMap<>(); entry.put("index", slot.getIndex()); entry.put("inUse", slot.inUse());
            GrandExchange.Offer offer = slot.getOffer();
            if (offer != null) {
                ItemDefinition item = offer.getItem();
                entry.put("itemId", item == null ? -1 : item.getId()); entry.put("itemName", item == null ? "Unknown" : item.getName());
                entry.put("type", offer.getType() == null ? "unknown" : offer.getType().name().toLowerCase(Locale.ROOT));
                entry.put("state", offer.getState() == null ? "unknown" : offer.getState().name().toLowerCase(Locale.ROOT));
                entry.put("quantity", offer.getItemQuantity()); entry.put("price", offer.getItemPrice());
                entry.put("itemsTransferred", offer.getItemsTransferred()); entry.put("wealthTransferred", offer.getWealthTransferred());
                entry.put("completion", offer.getCompletion());
            }
            slots.add(entry);
        }
        value.put("slots", slots); return value;
    }

    private static List<Map<String, Object>> interfaces() {
        List<Map<String, Object>> values = new ArrayList<>();
        for (InterfaceComponent component : Interfaces.getLoaded().asList()) {
            if (!component.isVisible()) continue;
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("ref", "interface:" + component.getId() + ":" + component.getIndex());
            value.put("container", component.getId()); value.put("index", component.getIndex());
            value.put("name", component.getName()); value.put("text", component.getText());
            value.put("type", component.getType() == null ? "unknown" : component.getType().name().toLowerCase(Locale.ROOT)); value.put("actions", Values.actions(component.getActions()));
            value.put("containedItemId", component.getContainedItemId()); value.put("containedItemQuantity", component.getContainedItemQuantity());
            values.add(value); if (values.size() >= 100) break;
        }
        return values;
    }

    private static List<Map<String, Object>> nearest(List<Map<String, Object>> values) {
        values.sort(Comparator.comparingDouble(value -> ((Number) value.get("distance")).doubleValue()));
        return values.size() <= LIMIT ? values : new ArrayList<>(values.subList(0, LIMIT));
    }
}
