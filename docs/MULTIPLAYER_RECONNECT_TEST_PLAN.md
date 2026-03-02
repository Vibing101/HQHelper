# Multiplayer Stability Test Plan (Step 3)

## Setup
- Devices: 1 GM device + 2 player devices (phones or browser profiles).
- Join all devices to the same campaign and active session.

## Test 1: Late join full sync
1. GM starts a session and performs several actions (room reveal, monster spawn, BP/MP changes, inventory updates).
2. Player B joins after these actions.
3. Verify Player B receives full campaign/party/heroes/session state immediately (without waiting for new incremental updates).

## Test 2: Reconnect recovery
1. On Player A, disable network briefly or refresh browser.
2. Re-enable network.
3. Verify socket re-joins campaign/session rooms and receives `SYNC_SNAPSHOT` automatically.
4. Verify Player A state matches GM state.

## Test 3: Snapshot reload on manual resync
1. Perform more actions from GM.
2. On one player, press `Resync` button.
3. Verify the client state is replaced by latest snapshot and matches GM.

## Test 4: Missing incremental updates defense
1. Keep Player B connected but in background.
2. Trigger multiple updates quickly from GM.
3. Force a resync (`REQUEST_SNAPSHOT`) from Player B.
4. Verify no stale data remains after snapshot hydration.

## Expected Result
- No client requires historical `state_update` sequence to recover.
- Reconnect and late join always converge to the same authoritative state.
