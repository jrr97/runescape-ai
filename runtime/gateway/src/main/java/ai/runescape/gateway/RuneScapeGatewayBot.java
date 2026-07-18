package ai.runescape.gateway;

import com.runemate.game.api.hybrid.entities.GameObject;
import com.runemate.game.api.hybrid.entities.GroundItem;
import com.runemate.game.api.hybrid.entities.Npc;
import com.runemate.game.api.hybrid.entities.Player;
import com.runemate.game.api.hybrid.local.Quest;
import com.runemate.game.api.hybrid.local.Quests;
import com.runemate.game.api.hybrid.local.hud.interfaces.Bank;
import com.runemate.game.api.hybrid.local.hud.interfaces.ChatDialog;
import com.runemate.game.api.hybrid.local.hud.interfaces.Equipment;
import com.runemate.game.api.hybrid.local.hud.interfaces.Inventory;
import com.runemate.game.api.hybrid.local.hud.interfaces.InterfaceComponent;
import com.runemate.game.api.hybrid.local.hud.interfaces.Interfaces;
import com.runemate.game.api.hybrid.local.hud.interfaces.Shop;
import com.runemate.game.api.hybrid.local.hud.interfaces.SpriteItem;
import com.runemate.game.api.hybrid.location.Coordinate;
import com.runemate.game.api.hybrid.location.navigation.Path;
import com.runemate.game.api.hybrid.location.navigation.Traversal;
import com.runemate.game.api.hybrid.net.GrandExchange;
import com.runemate.game.api.hybrid.region.GameObjects;
import com.runemate.game.api.hybrid.region.GroundItems;
import com.runemate.game.api.hybrid.region.Npcs;
import com.runemate.game.api.hybrid.region.Players;
import com.runemate.game.api.osrs.local.hud.interfaces.ControlPanelTab;
import com.runemate.game.api.script.Execution;
import com.runemate.game.api.script.framework.LoopingBot;
import com.runemate.pathfinder.Pathfinder;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedDeque;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicLong;

public final class RuneScapeGatewayBot extends LoopingBot {
    private static final Logger log = LogManager.getLogger(RuneScapeGatewayBot.class);
    private static final Set<String> READ_OPERATIONS = Set.of(
        "observe", "get_quest_state", "get_market_item", "find_nearest", "find_inventory", "find_ground_item", "cancel"
    );
    private static final Set<String> BLOCKED_ACTIONS = Set.of("drop", "destroy", "trade", "offer", "accept", "buy", "sell");
    private static final int MAX_REVISION_LAG = 25;
    private static final int RESPONSE_CACHE_SIZE = 500;

    static final List<String> OPERATIONS = List.of(
        "observe", "get_quest_state", "get_market_item", "find_nearest", "find_inventory", "find_ground_item",
        "interact_npc", "interact_object", "interact_ground_item", "interact_inventory", "interact_equipment",
        "use_inventory_on_npc", "use_inventory_on_object", "use_inventory_on_inventory", "interact_interface",
        "walk", "set_run", "dialogue_continue", "dialogue_select", "bank_open", "bank_close",
        "bank_deposit_inventory", "bank_deposit_item", "bank_withdraw", "shop_buy", "shop_sell", "shop_close",
        "grand_exchange_open", "grand_exchange_buy", "grand_exchange_sell", "grand_exchange_collect",
        "grand_exchange_abort", "grand_exchange_close", "cancel"
    );

    private final ConcurrentLinkedQueue<Request> queue = new ConcurrentLinkedQueue<>();
    private final ConcurrentHashMap<String, Response> completed = new ConcurrentHashMap<>();
    private final ConcurrentLinkedDeque<String> completedOrder = new ConcurrentLinkedDeque<>();
    private final Set<String> inFlight = ConcurrentHashMap.newKeySet();
    private final AtomicLong revision = new AtomicLong();
    private final StateReader stateReader = new StateReader();
    private volatile Request cancelRequest;
    private volatile Request activeRequest;
    private volatile Walk activeWalk;
    private GatewaySocket connection;
    private Pathfinder pathfinder;

    @Override
    public void onStart(String... arguments) {
        setLoopDelay(100, 150);
        try {
            pathfinder = Pathfinder.create(this);
            connection = new GatewaySocket(GatewayConfig.load(), this::enqueue);
            connection.start();
        } catch (IOException exception) {
            log.error("Unable to configure RuneScape AI gateway: {}", exception.getMessage());
            stop(exception.getMessage());
        }
    }

    @Override
    public void onLoop() {
        if (cancelRequest != null) handleCancel();
        if (activeWalk != null) { continueWalk(); return; }
        Request request = queue.poll();
        if (request == null) return;
        activeRequest = request;
        try {
            if (!READ_OPERATIONS.contains(request.operation())) requireFreshRevision(request.parameters());
            switch (request.operation()) {
                case "observe" -> succeed(request, observe(request.parameters()));
                case "get_quest_state" -> succeed(request, questState(request.parameters()));
                case "get_market_item" -> succeed(request, marketItem(request.parameters()));
                case "find_nearest" -> succeed(request, NearestFinder.find(required(request.parameters(), "query"), pathfinder));
                case "find_inventory" -> succeed(request, stateReader.inventoryItem(string(request.parameters(), "name"), integer(request.parameters(), "id", -1)));
                case "find_ground_item" -> succeed(request, findGroundItem(request.parameters()));
                case "interact_npc" -> succeed(request, interactNpc(request.parameters()));
                case "interact_object" -> succeed(request, interactObject(request.parameters()));
                case "interact_ground_item" -> succeed(request, interactGroundItem(request.parameters()));
                case "interact_inventory" -> succeed(request, interactInventory(request.parameters()));
                case "interact_equipment" -> succeed(request, interactEquipment(request.parameters()));
                case "use_inventory_on_npc" -> succeed(request, useInventoryOnNpc(request.parameters()));
                case "use_inventory_on_object" -> succeed(request, useInventoryOnObject(request.parameters()));
                case "use_inventory_on_inventory" -> succeed(request, useInventoryOnInventory(request.parameters()));
                case "interact_interface" -> succeed(request, interactInterface(request.parameters()));
                case "walk" -> startWalk(request);
                case "set_run" -> succeed(request, setRun(request.parameters()));
                case "dialogue_continue" -> succeed(request, dialogueContinue());
                case "dialogue_select" -> succeed(request, dialogueSelect(request.parameters()));
                case "bank_open" -> succeed(request, bankOpen());
                case "bank_close" -> succeed(request, bankClose());
                case "bank_deposit_inventory" -> succeed(request, bankDepositInventory());
                case "bank_deposit_item" -> succeed(request, bankDepositItem(request.parameters()));
                case "bank_withdraw" -> succeed(request, bankWithdraw(request.parameters()));
                case "shop_buy" -> succeed(request, shopBuy(request.parameters()));
                case "shop_sell" -> succeed(request, shopSell(request.parameters()));
                case "shop_close" -> succeed(request, shopClose());
                case "grand_exchange_open" -> succeed(request, grandExchangeOpen());
                case "grand_exchange_buy" -> succeed(request, grandExchangeBuy(request.parameters()));
                case "grand_exchange_sell" -> succeed(request, grandExchangeSell(request.parameters()));
                case "grand_exchange_collect" -> succeed(request, grandExchangeCollect(request.parameters()));
                case "grand_exchange_abort" -> succeed(request, grandExchangeAbort(request.parameters()));
                case "grand_exchange_close" -> succeed(request, grandExchangeClose());
                default -> fail(request, "Unsupported operation: " + request.operation());
            }
        } catch (Exception exception) {
            log.warn("Gateway operation {} failed: {}", request.operation(), exception.getMessage());
            fail(request, exception.getMessage() == null ? exception.getClass().getSimpleName() : exception.getMessage());
        } finally {
            if (activeWalk == null) activeRequest = null;
        }
    }

    @Override
    public void onStop(String reason) {
        cancelAll(reason == null ? "Gateway stopped" : reason);
        if (connection != null) connection.close();
    }

    @SuppressWarnings("unchecked")
    private void enqueue(Map<String, Object> message) {
        String id = string(message, "id"); String operation = string(message, "operation");
        if (id == null || id.isBlank() || operation == null || !OPERATIONS.contains(operation)) return;
        Response cached = completed.get(id);
        if (cached != null) { send(id, cached); return; }
        if (!inFlight.add(id)) return;
        Object raw = message.get("parameters");
        Map<String, Object> parameters = raw instanceof Map<?, ?> map ? normalize(map) : Map.of();
        Request request = new Request(id, operation, parameters);
        if ("cancel".equals(operation)) cancelRequest = request; else queue.offer(request);
    }

    private Map<String, Object> observe(Map<String, Object> parameters) {
        Set<String> components = ConcurrentHashMap.newKeySet();
        Object raw = parameters.get("components");
        if (raw instanceof List<?> list) for (Object value : list) if (value instanceof String text && !text.isBlank()) components.add(text);
        return stateReader.read(components, revision.incrementAndGet(), activeRequest == null ? null : activeRequest.id());
    }

    private Map<String, Object> questState(Map<String, Object> parameters) {
        List<String> requested = new ArrayList<>();
        String name = string(parameters, "name"); if (name != null && !name.isBlank()) requested.add(name);
        Object raw = parameters.get("names");
        if (raw instanceof List<?> names) for (Object value : names) if (value instanceof String text && !text.isBlank()) requested.add(text);
        List<Quest> quests = new ArrayList<>(requested.isEmpty() ? Quests.getAll() : Quests.get(requested.toArray(String[]::new)));
        quests.sort(java.util.Comparator.comparing(Quest::getName, String.CASE_INSENSITIVE_ORDER));
        List<Map<String, Object>> values = new ArrayList<>();
        for (Quest quest : quests) {
            Map<String, Object> value = new LinkedHashMap<>();
            value.put("id", quest.getId()); value.put("name", quest.getName());
            value.put("status", quest.getStatus() == null ? "unknown" : quest.getStatus().name().toLowerCase(Locale.ROOT));
            value.put("members", quest.getDefinition() != null && quest.getDefinition().isMembers()); values.add(value);
        }
        return Map.of("questPoints", Quests.getQuestPoints(), "quests", values);
    }

    private Map<String, Object> marketItem(Map<String, Object> parameters) {
        int id = integer(parameters, "id", -1);
        if (id < 0) throw new IllegalArgumentException("id is required");
        GrandExchange.Item item = GrandExchange.lookup(id);
        if (item == null) return Map.of("found", false, "id", id);
        Map<String, Object> value = new LinkedHashMap<>();
        value.put("found", true); value.put("id", item.getId()); value.put("name", item.getName());
        value.put("price", item.getPrice()); value.put("members", item.isMembersOnly());
        value.put("description", item.getDescription());
        return value;
    }

    private Map<String, Object> findGroundItem(Map<String, Object> parameters) {
        GroundItem item = resolveGroundItem(parameters, null);
        if (item == null) return Map.of("found", false);
        Map<String, Object> value = new LinkedHashMap<>(groundItem(item)); value.put("found", true); return value;
    }

    private Map<String, Object> interactNpc(Map<String, Object> parameters) {
        String action = required(parameters, "action"); ensureAllowed(action);
        Npc npc = resolveNpc(parameters, action);
        if (npc == null) throw new IllegalStateException("No matching NPC is loaded");
        if (!performNpcAction(npc, action)) throw new IllegalStateException("RuneMate rejected the NPC interaction");
        return Map.of("targetType", "npc", "id", npc.getId(), "name", Values.name(npc));
    }

    private Map<String, Object> interactObject(Map<String, Object> parameters) {
        String action = required(parameters, "action"); ensureAllowed(action);
        GameObject object = resolveObject(parameters, action); if (object == null) throw new IllegalStateException("No matching object is loaded");
        if (!performObjectAction(object, action)) throw new IllegalStateException("RuneMate rejected the object interaction");
        return Map.of("targetType", "object", "id", object.getId(), "name", Values.name(object));
    }

    private Map<String, Object> interactGroundItem(Map<String, Object> parameters) {
        String action = required(parameters, "action"); ensureAllowed(action);
        GroundItem item = resolveGroundItem(parameters, action);
        if (item == null) throw new IllegalStateException("No matching ground item is loaded");
        boolean interacted = "take".equalsIgnoreCase(action) ? item.take() : item.interact(action);
        if (!interacted) throw new IllegalStateException("RuneMate rejected the ground-item interaction");
        return groundItem(item);
    }

    private Map<String, Object> interactInventory(Map<String, Object> parameters) {
        String action = required(parameters, "action"); ensureAllowed(action);
        SpriteItem item = resolveInventoryItem(parameters, action);
        if (item == null) throw new IllegalStateException("No matching inventory item is available");
        if (!performInventoryAction(item, action)) throw new IllegalStateException("RuneMate rejected the inventory interaction");
        return Map.of("targetType", "inventory", "id", item.getId(), "name", Values.name(item), "index", item.getIndex());
    }

    private Map<String, Object> interactEquipment(Map<String, Object> parameters) {
        String action = required(parameters, "action"); ensureAllowed(action);
        SpriteItem item = resolveEquipmentItem(parameters, action);
        if (item == null) throw new IllegalStateException("No matching equipped item is available");
        int index = item.getIndex(); int id = item.getId();
        if (!performEquipmentAction(item, action)) throw new IllegalStateException("RuneMate rejected the equipment interaction");
        if ("remove".equalsIgnoreCase(action) && !Execution.delayUntil(() -> {
            SpriteItem current = Equipment.getItemIn(index); return current == null || current.getId() != id;
        }, 1_800)) throw new IllegalStateException("The equipped item did not leave its slot");
        return Map.of("targetType", "equipment", "id", id, "name", Values.name(item), "index", index);
    }

    private Map<String, Object> useInventoryOnNpc(Map<String, Object> parameters) {
        Map<String, Object> itemSelector = requiredMap(parameters, "item");
        Map<String, Object> targetSelector = requiredMap(parameters, "target");
        SpriteItem item = selectInventoryItem(itemSelector);
        Npc target = resolveNpc(targetSelector, null);
        if (target == null) throw new IllegalStateException("No matching NPC is loaded");
        if (!target.click()) throw new IllegalStateException("RuneMate rejected the item-on-NPC interaction");
        return itemUseResult(item, "npc", target.getId(), Values.name(target));
    }

    private Map<String, Object> useInventoryOnObject(Map<String, Object> parameters) {
        Map<String, Object> itemSelector = requiredMap(parameters, "item");
        Map<String, Object> targetSelector = requiredMap(parameters, "target");
        SpriteItem item = selectInventoryItem(itemSelector);
        GameObject target = resolveObject(targetSelector, null);
        if (target == null) throw new IllegalStateException("No matching object is loaded");
        if (!target.click()) throw new IllegalStateException("RuneMate rejected the item-on-object interaction");
        return itemUseResult(item, "object", target.getId(), Values.name(target));
    }

    private Map<String, Object> useInventoryOnInventory(Map<String, Object> parameters) {
        Map<String, Object> itemSelector = requiredMap(parameters, "item");
        Map<String, Object> targetSelector = requiredMap(parameters, "target");
        SpriteItem item = selectInventoryItem(itemSelector);
        SpriteItem target = resolveInventoryItem(targetSelector, null);
        if (target == null) throw new IllegalStateException("No matching target inventory item is available");
        if (target.getIndex() == item.getIndex()) throw new IllegalArgumentException("Source and target inventory slots must differ");
        if (!target.click()) throw new IllegalStateException("RuneMate rejected the item-on-item interaction");
        return itemUseResult(item, "inventory", target.getId(), Values.name(target));
    }

    private Map<String, Object> interactInterface(Map<String, Object> parameters) {
        String ref = string(parameters, "ref"); int container = integer(parameters, "container", -1); int index = integer(parameters, "index", -1);
        if (ref != null && !ref.isBlank()) {
            String[] parts = ref.split(":", -1);
            if (parts.length != 3 || !"interface".equals(parts[0])) throw new IllegalArgumentException("Invalid interface ref");
            container = Integer.parseInt(parts[1]); index = Integer.parseInt(parts[2]);
        }
        final int expectedContainer = container; final int expectedIndex = index;
        InterfaceComponent component = Interfaces.getLoaded().asList().stream()
            .filter(value -> value.getId() == expectedContainer && value.getIndex() == expectedIndex).findFirst().orElse(null);
        if (component == null || !component.isVisible()) throw new IllegalStateException("The exact interface component is unavailable");
        String expectedText = string(parameters, "text"); String expectedName = string(parameters, "name");
        if (expectedText != null && !expectedText.equals(component.getText())) throw new IllegalStateException("Interface text changed since observation");
        if (expectedName != null && !expectedName.equals(component.getName())) throw new IllegalStateException("Interface name changed since observation");
        String action = string(parameters, "action"); if (action != null) ensureAllowed(action);
        boolean interacted = action == null || action.isBlank() ? component.click() : component.interact(action);
        if (!interacted) throw new IllegalStateException("RuneMate rejected the interface interaction");
        Map<String, Object> value = new LinkedHashMap<>(); value.put("ref", "interface:" + container + ":" + index);
        value.put("container", container); value.put("index", index); value.put("action", action == null ? "click" : action); return value;
    }

    private void startWalk(Request request) {
        Map<String, Object> parameters = request.parameters();
        List<Coordinate> destinations = walkDestinations(parameters);
        int tolerance = Math.max(0, Math.min(10, integer(parameters, "tolerance", 2)));
        int approach = Math.max(0, Math.min(10, integer(parameters, "approach", 5)));
        Coordinate first = destinations.get(0); Path path = buildPath(first);
        if (path == null) throw new IllegalStateException("RuneMate could not build a path");
        activeWalk = new Walk(request, destinations, 0, tolerance, approach, path);
    }

    private void continueWalk() {
        Walk walk = activeWalk; Player player = Players.getLocal();
        if (player == null || player.getServerPosition() == null) { if (++walk.failures >= 10) finishWalk(false, "Local player is unavailable"); return; }
        Coordinate destination = walk.destination();
        int threshold = walk.index < walk.destinations.size() - 1 ? walk.approach : walk.tolerance;
        if (player.getServerPosition().distanceTo(destination) <= threshold) {
            if (walk.index < walk.destinations.size() - 1) {
                walk.index++;
                walk.path = buildPath(walk.destination());
                walk.failures = 0;
                if (walk.path == null) { finishWalk(false, "RuneMate could not build a path"); return; }
                // Issue the next leg immediately so pathing stays continuous.
                if (walk.path.step()) walk.failures = 0;
                return;
            }
            finishWalk(true, "Destination reached");
            return;
        }
        if (player.isMoving()) { walk.failures = 0; return; }
        if (walk.path.step()) { walk.failures = 0; return; }
        if (++walk.failures == 3) walk.path = buildPath(walk.destination());
        if (walk.failures >= 8 || walk.path == null) finishWalk(false, "Path traversal failed repeatedly");
    }

    private void finishWalk(boolean successful, String message) {
        Walk walk = activeWalk; activeWalk = null; activeRequest = null;
        if (successful) {
            Player player = Players.getLocal(); succeed(walk.request, Map.of("position", Values.coordinate(player == null ? null : player.getServerPosition())));
        } else fail(walk.request, message);
    }

    private static List<Coordinate> walkDestinations(Map<String, Object> parameters) {
        Object raw = parameters.get("waypoints");
        if (raw instanceof List<?> list) {
            if (list.isEmpty()) throw new IllegalArgumentException("waypoints must not be empty");
            List<Coordinate> destinations = new ArrayList<>(list.size());
            for (Object item : list) {
                if (!(item instanceof Map<?, ?> map)) throw new IllegalArgumentException("each waypoint must be a coordinate object");
                Map<String, Object> coordinate = normalize(map);
                int x = integer(coordinate, "x", -1); int y = integer(coordinate, "y", -1);
                if (x < 0 || y < 0) throw new IllegalArgumentException("waypoint x and y are required");
                destinations.add(new Coordinate(x, y, integer(coordinate, "plane", 0)));
            }
            return destinations;
        }
        int x = integer(parameters, "x", -1); int y = integer(parameters, "y", -1);
        if (x < 0 || y < 0) throw new IllegalArgumentException("x and y are required (or provide waypoints)");
        return List.of(new Coordinate(x, y, integer(parameters, "plane", 0)));
    }

    private Path buildPath(Coordinate destination) {
        Path path = pathfinder.pathBuilder().destination(destination).findPath();
        return path != null ? path : com.runemate.game.api.hybrid.location.navigation.cognizant.ScenePath.buildTo(destination);
    }

    private Map<String, Object> setRun(Map<String, Object> parameters) {
        boolean enabled = bool(parameters, "enabled", true);
        if (Traversal.isRunEnabled() != enabled && !Traversal.toggleRun()) throw new IllegalStateException("RuneMate could not toggle run");
        return Map.of("enabled", Traversal.isRunEnabled());
    }

    private Map<String, Object> dialogueContinue() {
        ChatDialog.Continue value = ChatDialog.getContinue();
        if (value == null || !value.isValid() || !value.select()) throw new IllegalStateException("No dialogue continuation is available");
        return Map.of();
    }

    private Map<String, Object> dialogueSelect(Map<String, Object> parameters) {
        int number = integer(parameters, "number", -1); String text = required(parameters, "text"); ChatDialog.Option option = ChatDialog.getOption(number);
        if (option == null || !option.isValid() || !text.equals(option.getText()) || !option.select()) throw new IllegalStateException("The exact dialogue option is unavailable");
        return Map.of("number", number, "text", text);
    }

    private Map<String, Object> bankOpen() {
        if (!Bank.isOpen() && !Bank.open()) throw new IllegalStateException("RuneMate could not open a nearby bank");
        return Map.of("open", Bank.isOpen());
    }
    private Map<String, Object> bankClose() {
        if (Bank.isOpen() && !Bank.close()) throw new IllegalStateException("RuneMate could not close the bank");
        return Map.of("open", Bank.isOpen());
    }
    private Map<String, Object> bankDepositInventory() {
        if (!Bank.isOpen()) throw new IllegalStateException("Bank is not open");
        if (!Inventory.isEmpty() && !Bank.depositInventory()) throw new IllegalStateException("RuneMate could not deposit inventory");
        return Map.of("deposited", true);
    }
    private Map<String, Object> bankDepositItem(Map<String, Object> parameters) {
        if (!Bank.isOpen()) throw new IllegalStateException("Bank is not open");
        int index = integer(parameters, "index", -1); int id = integer(parameters, "id", -1); int quantity = integer(parameters, "quantity", -1);
        SpriteItem item = index < 0 ? null : Inventory.getItemIn(index);
        if (item == null || item.getId() != id || quantity <= 0 || Inventory.getQuantity(id) < quantity) throw new IllegalStateException("Exact inventory item or quantity is unavailable");
        if (!Bank.deposit(item, quantity)) throw new IllegalStateException("RuneMate could not deposit item");
        return Map.of("id", id, "quantity", quantity);
    }
    private Map<String, Object> bankWithdraw(Map<String, Object> parameters) {
        if (!Bank.isOpen()) throw new IllegalStateException("Bank is not open");
        int id = integer(parameters, "id", -1); String name = string(parameters, "name"); int quantity = integer(parameters, "quantity", -1);
        if (quantity <= 0 || id < 0 && (name == null || name.isBlank())) throw new IllegalArgumentException("id or name and positive quantity are required");
        int available = id >= 0 ? Bank.getQuantity(id) : Bank.getQuantity(name);
        if (available < quantity) throw new IllegalStateException("Bank has " + available + " matching items; " + quantity + " requested");
        boolean accepted = id >= 0 ? Bank.withdraw(id, quantity) : Bank.withdraw(name, quantity);
        if (!accepted) throw new IllegalStateException("RuneMate could not withdraw item");
        Map<String, Object> value = new LinkedHashMap<>(); value.put("id", id); value.put("name", name == null ? "" : name); value.put("quantity", quantity); return value;
    }

    private Map<String, Object> shopBuy(Map<String, Object> parameters) {
        if (!Shop.isOpen()) throw new IllegalStateException("Shop is not open");
        int id = integer(parameters, "id", -1); String name = string(parameters, "name"); int quantity = boundedQuantity(parameters);
        if (id < 0 && (name == null || name.isBlank())) throw new IllegalArgumentException("id or name is required");
        int available = id >= 0 ? Shop.getQuantity(id) : Shop.getQuantity(name);
        if (available < quantity) throw new IllegalStateException("Shop has " + available + " matching items; " + quantity + " requested");
        boolean accepted = id >= 0 ? Shop.buy(id, quantity) : Shop.buy(name, quantity);
        if (!accepted) throw new IllegalStateException("RuneMate could not buy item");
        return transactionResult(id, name, quantity);
    }

    private Map<String, Object> shopSell(Map<String, Object> parameters) {
        if (!Shop.isOpen()) throw new IllegalStateException("Shop is not open");
        int id = integer(parameters, "id", -1); String name = string(parameters, "name"); int quantity = boundedQuantity(parameters);
        if (id < 0 && (name == null || name.isBlank())) throw new IllegalArgumentException("id or name is required");
        int available = id >= 0 ? Inventory.getQuantity(id) : Inventory.getQuantity(name);
        if (available < quantity) throw new IllegalStateException("Inventory has " + available + " matching items; " + quantity + " requested");
        boolean accepted = id >= 0 ? Shop.sell(id, quantity) : Shop.sell(name, quantity);
        if (!accepted) throw new IllegalStateException("RuneMate could not sell item");
        return transactionResult(id, name, quantity);
    }

    private Map<String, Object> shopClose() {
        if (Shop.isOpen() && !Shop.close()) throw new IllegalStateException("RuneMate could not close the shop");
        return Map.of("open", Shop.isOpen());
    }

    private Map<String, Object> grandExchangeOpen() {
        if (!GrandExchange.isOpen() && !GrandExchange.open()) throw new IllegalStateException("RuneMate could not open the Grand Exchange");
        return Map.of("open", GrandExchange.isOpen());
    }

    private Map<String, Object> grandExchangeBuy(Map<String, Object> parameters) {
        requireGrandExchangeOpen();
        String name = required(parameters, "name"); int quantity = exchangeQuantity(parameters); int price = exchangePrice(parameters, quantity);
        if (!completeGrandExchangeOffer(() -> GrandExchange.placeBuyOffer(name, quantity, price), name, true, quantity, price)) {
            throw new IllegalStateException("RuneMate could not complete the buy offer setup");
        }
        return exchangeResult("buy", name, quantity, price);
    }

    private Map<String, Object> grandExchangeSell(Map<String, Object> parameters) {
        requireGrandExchangeOpen();
        String name = required(parameters, "name"); int quantity = exchangeQuantity(parameters); int price = exchangePrice(parameters, quantity);
        if (Inventory.getQuantity(name) < quantity) throw new IllegalStateException("Inventory does not contain the requested sell quantity");
        if (!completeGrandExchangeOffer(() -> GrandExchange.placeSellOffer(name, quantity, price), name, false, quantity, price)) {
            throw new IllegalStateException("RuneMate could not complete the sell offer setup");
        }
        return exchangeResult("sell", name, quantity, price);
    }

    private Map<String, Object> grandExchangeCollect(Map<String, Object> parameters) {
        requireGrandExchangeOpen();
        String destination = required(parameters, "destination").toLowerCase(Locale.ROOT);
        int completedBefore = completedOfferCount();
        if (completedBefore == 0) throw new IllegalStateException("There are no completed Grand Exchange offers to collect");
        boolean accepted = switch (destination) {
            case "inventory" -> GrandExchange.collectToInventory();
            case "bank" -> GrandExchange.collectToBank();
            default -> throw new IllegalArgumentException("destination must be inventory or bank");
        };
        if (!Execution.delayUntil(() -> completedOfferCount() < completedBefore, 1_200, 2_400)) {
            throw new IllegalStateException(accepted ? "Grand Exchange collection did not complete" : "RuneMate could not collect Grand Exchange items");
        }
        return Map.of("destination", destination);
    }

    private Map<String, Object> grandExchangeAbort(Map<String, Object> parameters) {
        requireGrandExchangeOpen();
        int index = integer(parameters, "slot", -1); GrandExchange.Slot slot = index < 0 ? null : GrandExchange.getSlot(index);
        if (slot == null || !slot.inUse()) throw new IllegalStateException("The exact Grand Exchange slot is not active");
        if (!GrandExchange.abortOffer(slot)) throw new IllegalStateException("RuneMate could not abort the offer");
        return Map.of("slot", index);
    }

    private Map<String, Object> grandExchangeClose() {
        if (GrandExchange.isOpen() && !GrandExchange.close()) throw new IllegalStateException("RuneMate could not close the Grand Exchange");
        return Map.of("open", GrandExchange.isOpen());
    }

    private static void requireGrandExchangeOpen() {
        if (!GrandExchange.isOpen()) throw new IllegalStateException("Grand Exchange is not open");
    }

    private static boolean completeGrandExchangeOffer(
        java.util.function.BooleanSupplier attempt, String name, boolean buy, int quantity, int price
    ) {
        int offersBefore = matchingOfferCount(name, buy, quantity, price);
        for (int step = 0; step < 3; step++) {
            if (attempt.getAsBoolean()) return true;
            if (matchingOfferCount(name, buy, quantity, price) > offersBefore) return true;
            if (!GrandExchange.isOpen()) return false;
            Execution.delay(180, 260);
        }
        return matchingOfferCount(name, buy, quantity, price) > offersBefore;
    }

    private static int matchingOfferCount(String name, boolean buy, int quantity, int price) {
        int count = 0;
        for (GrandExchange.Slot slot : GrandExchange.getSlots()) {
            GrandExchange.Offer offer = slot.getOffer();
            if (offer == null || offer.isBuyOffer() != buy || offer.getItemQuantity() != quantity || offer.getItemPrice() != price) continue;
            var item = offer.getItem(); if (item != null && name.equalsIgnoreCase(item.getName())) count++;
        }
        return count;
    }

    private static int completedOfferCount() {
        int count = 0;
        for (GrandExchange.Slot slot : GrandExchange.getSlots()) {
            GrandExchange.Offer offer = slot.getOffer();
            if (offer != null && offer.getState() == GrandExchange.Offer.State.COMPLETED) count++;
        }
        return count;
    }

    private static int exchangeQuantity(Map<String, Object> parameters) {
        int quantity = integer(parameters, "quantity", -1);
        if (quantity < 1 || quantity > 1_000) throw new IllegalArgumentException("quantity must be between 1 and 1000");
        return quantity;
    }

    private static int exchangePrice(Map<String, Object> parameters, int quantity) {
        int price = integer(parameters, "price", -1);
        if (price < 1 || price > 10_000_000 || (long) price * quantity > 50_000_000L) {
            throw new IllegalArgumentException("price must be positive and total offer value must not exceed 50,000,000");
        }
        return price;
    }

    private static Map<String, Object> exchangeResult(String type, String name, int quantity, int price) {
        Map<String, Object> value = new LinkedHashMap<>(); value.put("type", type); value.put("name", name);
        value.put("quantity", quantity); value.put("price", price); return value;
    }

    private Npc resolveNpc(Map<String, Object> selector, String action) {
        String ref = string(selector, "ref"); int id = integer(selector, "id", -1); String name = string(selector, "name"); Integer index = null;
        if (ref != null && !ref.isBlank()) {
            String[] parts = ref.split(":", -1); if (parts.length != 3 || !"npc".equals(parts[0])) throw new IllegalArgumentException("Invalid NPC ref");
            index = Integer.parseInt(parts[1]); id = Integer.parseInt(parts[2]);
        }
        if (index == null && id < 0 && (name == null || name.isBlank())) throw new IllegalArgumentException("NPC selector is required");
        var query = Npcs.newQuery(); if (id >= 0) query.ids(id); if (name != null && !name.isBlank()) query.names(name); if (action != null) query.actions(action);
        final Integer expectedIndex = index;
        return expectedIndex == null ? query.results().nearest() : query.results().asList().stream()
            .filter(value -> value.getIndex() == expectedIndex).findFirst().orElse(null);
    }

    private GameObject resolveObject(Map<String, Object> selector, String action) {
        String ref = string(selector, "ref"); int id = integer(selector, "id", -1); String name = string(selector, "name");
        var query = GameObjects.newQuery();
        if (ref != null && !ref.isBlank()) {
            String[] parts = ref.split(":", -1); if (parts.length != 5 || !"object".equals(parts[0])) throw new IllegalArgumentException("Invalid object ref");
            id = Integer.parseInt(parts[1]); query.on(new Coordinate(Integer.parseInt(parts[2]), Integer.parseInt(parts[3]), Integer.parseInt(parts[4])));
        }
        if (id < 0 && (name == null || name.isBlank())) throw new IllegalArgumentException("Object selector is required");
        if (id >= 0) query.ids(id); if (name != null && !name.isBlank()) query.names(name); if (action != null) query.actions(action);
        return query.results().nearest();
    }

    private GroundItem resolveGroundItem(Map<String, Object> selector, String action) {
        String ref = string(selector, "ref"); int id = integer(selector, "id", -1); String name = string(selector, "name");
        var query = GroundItems.newQuery();
        if (ref != null && !ref.isBlank()) {
            String[] parts = ref.split(":", -1); if (parts.length != 5 || !"ground".equals(parts[0])) throw new IllegalArgumentException("Invalid ground-item ref");
            id = Integer.parseInt(parts[1]); query.on(new Coordinate(Integer.parseInt(parts[2]), Integer.parseInt(parts[3]), Integer.parseInt(parts[4])));
        }
        if (id < 0 && (name == null || name.isBlank())) throw new IllegalArgumentException("Ground-item selector is required");
        if (id >= 0) query.ids(id); if (name != null && !name.isBlank()) query.names(name); if (action != null) query.actions(action);
        return query.results().nearest();
    }

    private SpriteItem resolveInventoryItem(Map<String, Object> selector, String action) {
        int index = integer(selector, "index", -1); int id = integer(selector, "id", -1); String name = string(selector, "name"); SpriteItem item;
        if (index >= 0) {
            item = Inventory.getItemIn(index);
            if (item != null && id >= 0 && item.getId() != id) item = null;
            if (item != null && name != null && !name.equals(Values.name(item))) item = null;
        } else {
            if (id < 0 && (name == null || name.isBlank())) throw new IllegalArgumentException("Inventory selector is required");
            var query = Inventory.newQuery(); if (id >= 0) query.ids(id); if (name != null && !name.isBlank()) query.names(name); if (action != null) query.actions(action);
            item = query.results().first();
        }
        if (item == null) return null;
        if (!item.isVisible()) {
            if (!ControlPanelTab.INVENTORY.open() || !Execution.delayUntil(ControlPanelTab.INVENTORY::isOpen, 1_200)) {
                throw new IllegalStateException("RuneMate could not open the inventory tab");
            }
            item = index >= 0 ? Inventory.getItemIn(index) : resolveInventoryItem(selector, action);
            if (item == null || !item.isVisible()) throw new IllegalStateException("Inventory item is not visible after opening the inventory tab");
        }
        return item;
    }

    private SpriteItem resolveEquipmentItem(Map<String, Object> selector, String action) {
        int index = integer(selector, "index", -1); int id = integer(selector, "id", -1); String name = string(selector, "name"); SpriteItem item;
        if (index >= 0) {
            item = Equipment.getItemIn(index);
            if (item != null && id >= 0 && item.getId() != id) item = null;
            if (item != null && name != null && !name.equals(Values.name(item))) item = null;
        } else {
            if (id < 0 && (name == null || name.isBlank())) throw new IllegalArgumentException("Equipment selector is required");
            var query = Equipment.newQuery(); if (id >= 0) query.ids(id); if (name != null && !name.isBlank()) query.names(name); if (action != null) query.actions(action);
            item = query.results().first();
        }
        if (item == null) return null;
        if (!item.isVisible()) {
            if (!ControlPanelTab.EQUIPMENT.open() || !Execution.delayUntil(ControlPanelTab.EQUIPMENT::isOpen, 1_200)) {
                throw new IllegalStateException("RuneMate could not open the equipment tab");
            }
            item = index >= 0 ? Equipment.getItemIn(index) : resolveEquipmentItem(selector, action);
            if (item == null || !item.isVisible()) throw new IllegalStateException("Equipped item is not visible after opening the equipment tab");
        }
        return item;
    }

    private boolean performInventoryAction(SpriteItem item, String action) {
        var definition = item.getDefinition();
        var actions = definition == null ? List.<String>of() : Values.actions(definition.getInventoryActions());
        return !actions.isEmpty() && action.equalsIgnoreCase(actions.get(0)) ? item.click() : item.interact(action, Values.name(item));
    }

    private boolean performNpcAction(Npc npc, String action) {
        var definition = npc.getActiveDefinition();
        var actions = definition == null ? List.<String>of() : Values.actions(definition.getActions());
        return !actions.isEmpty() && action.equalsIgnoreCase(actions.get(0)) ? npc.click() : npc.interact(action, Values.name(npc));
    }

    private boolean performObjectAction(GameObject object, String action) {
        var definition = object.getActiveDefinition();
        var actions = definition == null ? List.<String>of() : Values.actions(definition.getActions());
        return !actions.isEmpty() && action.equalsIgnoreCase(actions.get(0)) ? object.click() : object.interact(action, Values.name(object));
    }

    private boolean performEquipmentAction(SpriteItem item, String action) {
        if ("remove".equalsIgnoreCase(action)) return item.interact(action, Values.name(item));
        var definition = item.getDefinition();
        var actions = definition == null ? List.<String>of() : Values.actions(definition.getWornActions());
        return !actions.isEmpty() && action.equalsIgnoreCase(actions.get(0)) ? item.click() : item.interact(action, Values.name(item));
    }

    private SpriteItem selectInventoryItem(Map<String, Object> selector) {
        SpriteItem item = resolveInventoryItem(selector, "Use");
        if (item == null) throw new IllegalStateException("No matching source inventory item is available");
        SpriteItem selected = Inventory.getSelectedItem();
        if (selected != null && selected.getId() == item.getId() && selected.getIndex() == item.getIndex()) return item;
        if (!performInventoryAction(item, "Use")) throw new IllegalStateException("RuneMate could not select the source inventory item");
        int id = item.getId(); int index = item.getIndex();
        if (!Execution.delayUntil(() -> {
            SpriteItem value = Inventory.getSelectedItem(); return value != null && value.getId() == id && value.getIndex() == index;
        }, 1_200)) throw new IllegalStateException("Source inventory item was not selected");
        return item;
    }

    private static Map<String, Object> groundItem(GroundItem item) {
        Map<String, Object> value = new LinkedHashMap<>(); value.put("targetType", "ground_item"); value.put("id", item.getId());
        value.put("name", Values.name(item)); value.put("quantity", item.getQuantity()); value.put("position", Values.coordinate(item.getPosition()));
        value.put("ref", "ground:" + item.getId() + ":" + Values.coordinateRef(item.getPosition())); return value;
    }

    private static Map<String, Object> itemUseResult(SpriteItem item, String targetType, int targetId, String targetName) {
        Map<String, Object> value = new LinkedHashMap<>(); value.put("itemId", item.getId()); value.put("itemName", Values.name(item));
        value.put("itemIndex", item.getIndex()); value.put("targetType", targetType); value.put("targetId", targetId); value.put("targetName", targetName); return value;
    }

    private static int boundedQuantity(Map<String, Object> parameters) {
        int quantity = integer(parameters, "quantity", -1);
        if (quantity < 1 || quantity > 50) throw new IllegalArgumentException("quantity must be between 1 and 50");
        return quantity;
    }

    private static Map<String, Object> transactionResult(int id, String name, int quantity) {
        Map<String, Object> value = new LinkedHashMap<>(); value.put("id", id); value.put("name", name == null ? "" : name); value.put("quantity", quantity); return value;
    }

    private void handleCancel() {
        Request request = cancelRequest; cancelRequest = null; cancelAll("Run cancelled"); succeed(request, Map.of("cancelled", true));
    }
    private void cancelAll(String reason) {
        Request queued; while ((queued = queue.poll()) != null) fail(queued, reason);
        if (activeWalk != null) { Request request = activeWalk.request; activeWalk = null; activeRequest = null; fail(request, reason); }
    }

    private void requireFreshRevision(Map<String, Object> parameters) {
        long expected = longValue(parameters, "expectedRevision", -1); long current = revision.get();
        if (expected < 1) throw new IllegalArgumentException("expectedRevision is required for gameplay actions");
        if (expected > current || current - expected > MAX_REVISION_LAG) throw new IllegalStateException("Stale state revision " + expected + "; current revision is " + current);
    }
    private static void ensureAllowed(String action) {
        if (BLOCKED_ACTIONS.contains(action.toLowerCase(Locale.ROOT))) throw new IllegalArgumentException("Blocked interaction: " + action);
    }

    private void succeed(Request request, Map<String, Object> result) { finish(request, new Response(true, result, null)); }
    private void fail(Request request, String error) { finish(request, new Response(false, Map.of(), error)); }
    private void finish(Request request, Response response) {
        if (request == null) return;
        inFlight.remove(request.id()); completed.put(request.id(), response); completedOrder.addLast(request.id());
        while (completedOrder.size() > RESPONSE_CACHE_SIZE) { String expired = completedOrder.pollFirst(); if (expired != null) completed.remove(expired); }
        send(request.id(), response);
    }
    private void send(String id, Response response) { if (connection != null) connection.respond(id, response.ok(), response.result(), response.error()); }

    private static String required(Map<String, Object> values, String name) {
        String value = string(values, name); if (value == null || value.isBlank()) throw new IllegalArgumentException(name + " is required"); return value;
    }
    private static String string(Map<String, Object> values, String name) { Object value = values.get(name); return value instanceof String text ? text : null; }
    private static int integer(Map<String, Object> values, String name, int fallback) { Object value = values.get(name); return value instanceof Number number ? number.intValue() : fallback; }
    private static long longValue(Map<String, Object> values, String name, long fallback) { Object value = values.get(name); return value instanceof Number number ? number.longValue() : fallback; }
    private static boolean bool(Map<String, Object> values, String name, boolean fallback) { Object value = values.get(name); return value instanceof Boolean result ? result : fallback; }
    private static Map<String, Object> requiredMap(Map<String, Object> values, String name) {
        Object value = values.get(name); if (!(value instanceof Map<?, ?> map)) throw new IllegalArgumentException(name + " selector is required"); return normalize(map);
    }
    private static Map<String, Object> normalize(Map<?, ?> source) {
        Map<String, Object> result = new LinkedHashMap<>(); source.forEach((key, value) -> result.put(String.valueOf(key), value)); return result;
    }

    private record Request(String id, String operation, Map<String, Object> parameters) {}
    private record Response(boolean ok, Map<String, Object> result, String error) {}
    private static final class Walk {
        private final Request request;
        private final List<Coordinate> destinations;
        private int index;
        private final int tolerance;
        private final int approach;
        private Path path;
        private int failures;

        private Walk(Request request, List<Coordinate> destinations, int index, int tolerance, int approach, Path path) {
            this.request = request; this.destinations = destinations; this.index = index;
            this.tolerance = tolerance; this.approach = approach; this.path = path;
        }

        private Coordinate destination() { return destinations.get(index); }
    }
}
