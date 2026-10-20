import mqtt, { MqttClient } from 'mqtt';
import { sanitizeRoomCode } from './multiplayerRules';
import { RemoteCarTelemetry, RoomStatePayload, TrackId } from './types';

const CLUSTER_PREFIX = 'apex_overdrive_d68490d9_v3';
const BROKER_URLS = ['wss://broker.emqx.io:8084/mqtt'];

export type ClusterEventPayload =
  | {
      type: 'room:state';
      room: RoomStatePayload;
      senderId: string;
    }
  | {
      type: 'room:join_request';
      roomId: string;
      playerId: string;
      playerName: string;
      trackId: TrackId;
      senderId: string;
    }
  | {
      type: 'room:configure';
      roomId: string;
      playerId: string;
      trackId?: TrackId;
      botCount?: number;
      playerName?: string;
      senderId: string;
    }
  | {
      type: 'room:update_name';
      roomId: string;
      playerId: string;
      playerName: string;
      senderId: string;
    }
  | {
      type: 'room:start';
      roomId: string;
      room: RoomStatePayload;
      senderId: string;
    }
  | {
      type: 'room:return_lobby';
      roomId: string;
      room: RoomStatePayload;
      senderId: string;
    }
  | {
      type: 'room:leave';
      roomId: string;
      playerId: string;
      senderId: string;
    }
  | {
      type: 'room:delete';
      roomId: string;
      senderId: string;
    }
  | {
      type: 'room:telemetry';
      roomId: string;
      cars: RemoteCarTelemetry[];
      senderId: string;
    };

export class RoomClusterBridge {
  private clients: MqttClient[] = [];
  private currentRoomId: string | null = null;
  private instanceId: string;
  private onEvent: (event: ClusterEventPayload) => void;

  constructor(instanceId: string, onEvent: (event: ClusterEventPayload) => void) {
    this.instanceId = instanceId;
    this.onEvent = onEvent;
    this.connectBrokers();
  }

  private connectBrokers() {
    for (const url of BROKER_URLS) {
      try {
        const client = mqtt.connect(url, {
          clientId: `apex_${this.instanceId}_${Math.random().toString(36).slice(2, 7)}`,
          clean: true,
          connectTimeout: 4000,
          reconnectPeriod: 2000,
        });

        client.on('connect', () => {
          // Subscribe globally to all room state/event topics so Title Screen Live Rooms
          // and Host state snapshots are always available in memory before clicking Join.
          client.subscribe(`${CLUSTER_PREFIX}/room/+/state`, { qos: 1 });
          client.subscribe(`${CLUSTER_PREFIX}/room/+/event`, { qos: 1 });
          if (this.currentRoomId) {
            this.subscribeRoomTopics(client, this.currentRoomId);
          }
        });

        client.on('message', (_topic, payload) => {
          try {
            const str = payload.toString().trim();
            if (!str) return;
            const parsed = JSON.parse(str) as ClusterEventPayload;
            if (!parsed || parsed.senderId === this.instanceId) return;
            this.onEvent(parsed);
          } catch {
            // Ignore malformed packets
          }
        });

        client.on('error', () => {
          // Handled automatically by reconnectPeriod
        });

        this.clients.push(client);
      } catch {
        // Ignore broker initialization failures
      }
    }
  }

  private subscribeRoomTopics(client: MqttClient, roomId: string) {
    const code = sanitizeRoomCode(roomId);
    if (!code) return;
    client.subscribe(`${CLUSTER_PREFIX}/room/${code}/state`, { qos: 1 });
    client.subscribe(`${CLUSTER_PREFIX}/room/${code}/event`, { qos: 1 });
    client.subscribe(`${CLUSTER_PREFIX}/room/${code}/telemetry`, { qos: 0 });
  }

  private unsubscribeRoomTopics(client: MqttClient, roomId: string) {
    const code = sanitizeRoomCode(roomId);
    if (!code) return;
    client.unsubscribe(`${CLUSTER_PREFIX}/room/${code}/telemetry`);
  }

  public setRoom(roomId: string | null) {
    const cleanNext = roomId ? sanitizeRoomCode(roomId) : null;
    if (this.currentRoomId === cleanNext) return;

    if (this.currentRoomId) {
      for (const c of this.clients) {
        if (c.connected) {
          this.unsubscribeRoomTopics(c, this.currentRoomId);
        }
      }
    }

    this.currentRoomId = cleanNext;

    if (cleanNext) {
      for (const c of this.clients) {
        if (c.connected) {
          this.subscribeRoomTopics(c, cleanNext);
        }
      }
    }
  }

  public publishRoomState(room: RoomStatePayload) {
    const code = sanitizeRoomCode(room.roomId);
    if (!code) return;
    const msg: ClusterEventPayload = {
      type: 'room:state',
      room,
      senderId: this.instanceId,
    };
    const raw = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.connected) {
        c.publish(`${CLUSTER_PREFIX}/room/${code}/state`, raw, {
          qos: 1,
          retain: true,
        });
      }
    }
  }

  public clearRoomState(roomId: string) {
    const code = sanitizeRoomCode(roomId);
    if (!code) return;
    const delEvent = JSON.stringify({
      type: 'room:delete',
      roomId: code,
      senderId: this.instanceId,
    });
    for (const c of this.clients) {
      if (c.connected) {
        c.publish(`${CLUSTER_PREFIX}/room/${code}/state`, '', {
          qos: 1,
          retain: true,
        });
        c.publish(`${CLUSTER_PREFIX}/room/${code}/event`, delEvent, { qos: 1 });
      }
    }
  }

  public publishEvent(roomId: string, event: ClusterEventPayload) {
    const code = sanitizeRoomCode(roomId);
    if (!code) return;
    const raw = JSON.stringify({ ...event, senderId: this.instanceId });
    for (const c of this.clients) {
      if (c.connected) {
        c.publish(`${CLUSTER_PREFIX}/room/${code}/event`, raw, { qos: 1 });
      }
    }
  }

  public publishTelemetry(roomId: string, cars: RemoteCarTelemetry[]) {
    const code = sanitizeRoomCode(roomId);
    if (!code) return;
    const msg: ClusterEventPayload = {
      type: 'room:telemetry',
      roomId: code,
      cars,
      senderId: this.instanceId,
    };
    const raw = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.connected) {
        c.publish(`${CLUSTER_PREFIX}/room/${code}/telemetry`, raw, { qos: 0 });
      }
    }
  }

  public destroy() {
    for (const c of this.clients) {
      try {
        c.end(true);
      } catch {
        // Ignore
      }
    }
    this.clients = [];
  }
}
