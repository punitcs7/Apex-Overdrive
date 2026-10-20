import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS } from './tracks';
import {
  calculateEffectiveTopSpeed,
  computeRivalInput,
  createInitialCars,
  formatTimeMs,
  getOverdriveParams,
  MAX_OVERDRIVE_STAGE,
  resolveCarCollisions,
  stepCarPhysics,
  updateOverdriveState,
  updateRaceStandings,
} from './rules';

test('Overdrive stages strictly increase base top speed and acceleration', () => {
  for (let stage = 1; stage < MAX_OVERDRIVE_STAGE; stage++) {
    const curr = getOverdriveParams(stage);
    const next = getOverdriveParams(stage + 1);
    assert.ok(
      next.baseTopSpeed > curr.baseTopSpeed,
      `Stage ${stage + 1} top speed (${next.baseTopSpeed}) should exceed Stage ${stage} (${curr.baseTopSpeed})`
    );
    assert.ok(
      next.acceleration > curr.acceleration,
      `Stage ${stage + 1} acceleration (${next.acceleration}) should exceed Stage ${stage} (${curr.acceleration})`
    );
  }
});

test('Increasing speed mechanic: sustained throttle builds Speed Ramp Bonus and levels up Overdrive Stage', () => {
  const track = TRACKS.sunset_gp;
  const cars = createInitialCars(track);
  const player = cars[0];

  assert.equal(player.overdriveStage, 1);
  assert.equal(player.speedRampBonus, 0);
  const initialTopSpeed = calculateEffectiveTopSpeed(player);

  // Give player high on-track speed and hold W (throttle = 1)
  player.speed = 320;
  player.isOffTrack = false;

  for (let i = 0; i < 120; i++) {
    updateOverdriveState(
      player,
      { throttle: 1, brake: 0, steer: 0, boostHeld: false, boostJustPressed: false },
      0.05
    );
  }

  assert.ok(player.speedRampBonus > 25, 'Speed ramp bonus should increase while holding W on track');
  assert.ok(player.overdriveStage >= 2, 'Overdrive stage should level up after sustained high-speed driving');
  const upgradedTopSpeed = calculateEffectiveTopSpeed(player);
  assert.ok(
    upgradedTopSpeed > initialTopSpeed + 50,
    `Upgraded top speed (${upgradedTopSpeed}) should significantly exceed initial top speed (${initialTopSpeed})`
  );
});

test('WASD car physics: W accelerates forward, A/D steers heading, and Space triggers nitro boost', () => {
  const track = TRACKS.sunset_gp;
  const [player] = createInitialCars(track);
  const startX = player.x;
  const startAngle = player.angle;

  // Step forward with W held for 0.5s
  for (let i = 0; i < 10; i++) {
    stepCarPhysics(
      player,
      { throttle: 1, brake: 0, steer: 0, boostHeld: false, boostJustPressed: false },
      track,
      0.05
    );
  }

  assert.ok(player.speed > 100, 'Car should accelerate when W (throttle) is held');
  assert.ok(player.x > startX, 'Car on start straight should move in +X direction');

  // Steer right (D -> steer = +1) with boost held
  const speedBeforeBoost = player.speed;
  stepCarPhysics(
    player,
    { throttle: 1, brake: 0, steer: 1, boostHeld: true, boostJustPressed: true },
    track,
    0.05
  );

  assert.ok(player.angle > startAngle, 'Car heading should turn right when D is pressed');
  assert.equal(player.isBoosting, true, 'Car should enter boosting state when Space is held with fuel');
  assert.ok(player.speed > speedBeforeBoost, 'Nitro boost should further accelerate the car');
});

test('Rival AI policies produce distinct steering/surge behaviors and sprinter sets windup telegraph', () => {
  const track = TRACKS.sunset_gp;
  const cars = createInitialCars(track);
  const player = cars[0];
  const sprinter = cars.find((c) => c.policy === 'sprinter')!;
  assert.ok(sprinter, 'Sprinter rival must exist');

  sprinter.surgeCooldownTimer = 0;
  computeRivalInput(sprinter, player, track, 0.05);
  assert.ok(
    sprinter.surgeWindupTimer > 0,
    'Sprinter rival should enter visible windup telegraph before surging'
  );
});

test('Car collision resolver separates overlapping cars cleanly', () => {
  const track = TRACKS.sunset_gp;
  const cars = createInitialCars(track);
  cars[1].x = cars[0].x + 10;
  cars[1].y = cars[0].y;
  cars[0].vx = 150;
  cars[1].vx = -50;

  const heavy = resolveCarCollisions(cars);
  const distAfter = Math.hypot(cars[1].x - cars[0].x, cars[1].y - cars[0].y);
  assert.ok(distAfter >= 35.9, `Overlapping cars should be separated (got ${distAfter})`);
  assert.equal(heavy, true, 'High relative velocity collision with player should flag heavy bump');
});

test('Race standings sort by totalRaceProgress and formatTimeMs formats minutes:seconds.tenths', () => {
  const track = TRACKS.sunset_gp;
  const cars = createInitialCars(track);
  cars[2].totalRaceProgress = 2.4;
  cars[0].totalRaceProgress = 1.8;

  const sorted = updateRaceStandings(cars);
  assert.equal(sorted[0].id, cars[2].id);
  assert.equal(cars[2].finishPosition, 1);
  assert.equal(formatTimeMs(65430), '1:05.4');
});

import {
  buildShareInviteUrl,
  canStartRoomRace,
  createMultiplayerCars,
  createRoomState,
  extractRoomCode,
  getPublicShareOrigin,
  joinPlayerToRoom,
  MAX_ROOM_PLAYERS,
  mergeRoomStates,
  MIN_ROOM_PLAYERS,
  removePlayerFromRoom,
  setRoomBotCount,
} from './multiplayerRules';

test('Share link builder converts private ais-dev origin to public ais-pre origin and extracts room codes', () => {
  const devOrigin = 'https://ais-dev-tz5eoo3b6pulpqa7sti7fb-515288046349.us-west1.run.app';
  const expectedPreOrigin = 'https://ais-pre-tz5eoo3b6pulpqa7sti7fb-515288046349.us-west1.run.app';
  assert.equal(getPublicShareOrigin(devOrigin), expectedPreOrigin);

  const shareUrl = buildShareInviteUrl(devOrigin, '/', 'race88');
  assert.equal(shareUrl, `${expectedPreOrigin}/?room=RACE88`);
  assert.equal(extractRoomCode(shareUrl), 'RACE88');
  assert.equal(extractRoomCode('  race88 '), 'RACE88');
});

test('mergeRoomStates reconciles cross-container ais-dev Host room and ais-pre Guest room into one 2-player room', () => {
  const hostRoomOnDev = createRoomState('SYNC99', 'drv_host', 'CREATOR', 'sunset_gp', 1000);
  const provisionalGuestRoomOnPre = createRoomState(
    'SYNC99',
    'drv_friend',
    'FRIEND',
    'sunset_gp',
    5000
  );

  const merged1 = mergeRoomStates(provisionalGuestRoomOnPre, hostRoomOnDev);
  assert.equal(merged1.hostId, 'drv_host', 'Original room creator must remain hostId');
  assert.equal(merged1.players.length, 2, 'Both Host and Friend must be in the merged room');
  assert.equal(merged1.players[0].id, 'drv_host');
  assert.equal(merged1.players[0].isHost, true);
  assert.equal(merged1.players[1].id, 'drv_friend');
  assert.equal(merged1.players[1].isHost, false);
});

test('Real F1 circuits (Bahrain Sakhir & India Buddh) feature wide 22-car roads and non-overlapping 22-car starting grids', () => {
  const bahrain = TRACKS.sunset_gp;
  const india = TRACKS.harbor_sprint;

  assert.ok(bahrain.name.includes('Bahrain'), 'sunset_gp should be Bahrain F1 GP');
  assert.ok(india.name.includes('India'), 'harbor_sprint should be India F1 GP');
  assert.ok(bahrain.roadWidth >= 260, `Bahrain roadWidth (${bahrain.roadWidth}) must be wide enough for 22 cars`);
  assert.ok(india.roadWidth >= 260, `India roadWidth (${india.roadWidth}) must be wide enough for 22 cars`);

  const soloGrid = createInitialCars(bahrain);
  assert.equal(soloGrid.length, 22, 'Solo F1 GP must spawn a full 22-car starting grid');

  // Verify no two cars overlap on the 22-car starting grid
  for (let i = 0; i < soloGrid.length; i++) {
    for (let j = i + 1; j < soloGrid.length; j++) {
      const dist = Math.hypot(soloGrid[j].x - soloGrid[i].x, soloGrid[j].y - soloGrid[i].y);
      assert.ok(
        dist >= 38,
        `Grid cars ${i} and ${j} must not overlap at spawn (distance = ${dist.toFixed(1)})`
      );
    }
  }
});

test('Multiplayer room enforces minimum 2 racers and supports up to 22 cars on the F1 starting grid', () => {
  const room = createRoomState('RACE88', 'host_1', 'Alex', 'sunset_gp');
  assert.equal(room.players.length, 1);
  assert.equal(room.minPlayers, MIN_ROOM_PLAYERS);
  assert.equal(room.maxPlayers, MAX_ROOM_PLAYERS);
  assert.equal(MAX_ROOM_PLAYERS, 22);

  // Cannot start with only 1 player
  const startCheck1 = canStartRoomRace(room);
  assert.equal(startCheck1.allowed, false);

  // Join players 2 through 22
  for (let p = 2; p <= MAX_ROOM_PLAYERS; p++) {
    const res = joinPlayerToRoom(room, `player_${p}`, `Driver ${p}`);
    assert.equal(res.ok, true, `Player ${p} should be able to join`);
  }
  assert.equal(room.players.length, 22);
  assert.equal(canStartRoomRace(room).allowed, true);

  // 23rd player is rejected because maximum grid capacity is 22 cars
  const overflowRes = joinPlayerToRoom(room, 'player_23', 'Driver 23');
  assert.equal(overflowRes.ok, false);
  assert.equal(room.players.length, 22);
});

test('Multiplayer room replaces a bot when a human friend joins and spawns 22 non-overlapping F1 cars', () => {
  const room = createRoomState('LINK01', 'host_1', 'Host', 'harbor_sprint');
  setRoomBotCount(room, 21); // 1 human + 21 F1 AI bots = 22 cars
  assert.equal(room.players.length, 22);

  // Human friend joins via shared link -> replaces one bot so room stays at 22 cars
  const joinRes = joinPlayerToRoom(room, 'friend_2', 'Friend');
  assert.equal(joinRes.ok, true);
  assert.equal(room.players.length, 22);
  assert.equal(room.players.filter((p) => !p.isBot).length, 2);

  // Spawn 22 cars on India Buddh F1 starting grid and verify distinct positions
  const cars = createMultiplayerCars(TRACKS.harbor_sprint, room.players, 'friend_2');
  assert.equal(cars.length, 22);
  const localCar = cars.find((c) => c.isPlayer);
  assert.ok(localCar && localCar.id === 'friend_2');

  // Remove host -> host migrates to friend_2
  const rem = removePlayerFromRoom(room, 'host_1');
  assert.equal(rem.shouldDeleteRoom, false);
  assert.equal(room.hostId, 'friend_2');

  // Remove last human player -> shouldDeleteRoom is true even if bots were present
  const remLast = removePlayerFromRoom(room, 'friend_2');
  assert.equal(remLast.shouldDeleteRoom, true);
});

test('mergeRoomStates preserves updated callsigns without flickering or bumping version in a loop', () => {
  const v1 = createRoomState('CALL99', 'drv_1', 'RACER-42', 'sunset_gp', 1000);
  const v2 = {
    ...v1,
    players: [{ ...v1.players[0], name: 'PUNIT-F1' }],
    version: 2,
  };

  // Regardless of argument order, higher version callsign ('PUNIT-F1') must win and version must stay 2
  const mergedA = mergeRoomStates(v1, v2);
  assert.equal(mergedA.players[0].name, 'PUNIT-F1');
  assert.equal(mergedA.version, 2);

  const mergedB = mergeRoomStates(v2, v1);
  assert.equal(mergedB.players[0].name, 'PUNIT-F1');
  assert.equal(mergedB.version, 2);
});

test('mergeRoomStates keeps Host as P1 and preserves joining Friend as P2 even when Host version is higher', () => {
  // Host created room and updated callsign/track (version 5)
  const hostState = createRoomState('JOIN22', 'host_punit', 'PUNIT-HOST', 'sunset_gp', 1000);
  hostState.version = 5;

  // Friend joined against an initial snapshot of the same room (version 2)
  const friendJoinedSnapshot = createRoomState('JOIN22', 'host_punit', 'RACER-10', 'sunset_gp', 1000);
  joinPlayerToRoom(friendJoinedSnapshot, 'friend_raj', 'RAJ-F1');
  assert.equal(friendJoinedSnapshot.version, 2);

  // Merge in both directions: Host must remain hostId (P1) with updated name 'PUNIT-HOST',
  // and Friend must be preserved in P2 ('RAJ-F1')!
  const merged1 = mergeRoomStates(hostState, friendJoinedSnapshot);
  assert.equal(merged1.hostId, 'host_punit');
  assert.equal(merged1.players.length, 2);
  assert.equal(merged1.players[0].id, 'host_punit');
  assert.equal(merged1.players[0].name, 'PUNIT-HOST');
  assert.equal(merged1.players[0].isHost, true);
  assert.equal(merged1.players[1].id, 'friend_raj');
  assert.equal(merged1.players[1].name, 'RAJ-F1');
  assert.equal(merged1.players[1].isHost, false);

  const merged2 = mergeRoomStates(friendJoinedSnapshot, hostState);
  assert.equal(merged2.hostId, 'host_punit');
  assert.equal(merged2.players.length, 2);
  assert.equal(merged2.players[0].id, 'host_punit');
  assert.equal(merged2.players[0].name, 'PUNIT-HOST');
  assert.equal(merged2.players[1].id, 'friend_raj');
  assert.equal(merged2.players[1].name, 'RAJ-F1');
});

