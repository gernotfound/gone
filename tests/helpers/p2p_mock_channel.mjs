// tests/helpers/p2p_mock_channel.mjs
// Mock WebRTC DataChannel simulation for P2P Host and Client testing in G.O.N.E.

import { SessionColorRegistry } from './color_registry_model.mjs';
import { validateHitscanRay } from './hitscan_model.mjs';

export class MockDataChannel {
  constructor(label = 'gone-mesh') {
    this.label = label;
    this.peer = null;
    this.onmessage = null;
    this.onopen = null;
    this.onclose = null;
    this.isOpen = true;
    this.messageLog = [];
    this.binaryType = 'arraybuffer';
  }

  connect(peerChannel) {
    this.peer = peerChannel;
    peerChannel.peer = this;
    if (this.onopen) this.onopen();
    if (peerChannel.onopen) peerChannel.onopen();
  }

  send(data) {
    if (!this.isOpen) throw new Error('DataChannel is closed');
    this.messageLog.push({ direction: 'send', data, timestamp: Date.now() });
    if (this.peer && this.peer.isOpen) {
      queueMicrotask(() => {
        if (this.peer && this.peer.onmessage) {
          let deliveryData = data;
          if (typeof data !== 'string') {
            if (data instanceof ArrayBuffer) {
              deliveryData = data;
            } else if (ArrayBuffer.isView(data)) {
              deliveryData = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
            }
          }
          this.peer.messageLog.push({ direction: 'recv', data: deliveryData, timestamp: Date.now() });
          this.peer.onmessage({ data: deliveryData });
        }
      });
    }
  }

  close() {
    this.isOpen = false;
    if (this.onclose) this.onclose();
    if (this.peer && this.peer.isOpen) {
      this.peer.isOpen = false;
      if (this.peer.onclose) this.peer.onclose();
    }
  }
}

/**
 * Authoritative P2P Host simulation node.
 */
export class P2PHostNode {
  constructor(hostId = 'host_peer') {
    this.hostId = hostId;
    this.registry = new SessionColorRegistry();
    this.clients = new Map(); // clientId -> { channel, name, color, hp: 100, pos: [0,0,0] }
    this.events = [];
  }

  registerHostPlayer(hostName, hostColor) {
    const res = this.registry.requestColor(this.hostId, hostColor);
    if (!res.success) throw new Error(`Host color registration failed: ${res.error}`);
    this.clients.set(this.hostId, {
      channel: null,
      name: hostName,
      color: res.color,
      hp: 100.0,
      pos: [0, 0, 0],
    });
    return res;
  }

  attachClient(clientNode) {
    const hostChannel = new MockDataChannel('gone-mesh');
    const clientChannel = new MockDataChannel('gone-mesh');
    hostChannel.connect(clientChannel);
    clientNode.setChannel(clientChannel);

    hostChannel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg, hostChannel);
        } catch {}
      } else {
        this.events.push(event.data);
        if (typeof this.handleBinaryMessage === 'function') {
          this.handleBinaryMessage(event.data, hostChannel);
        }
      }
    };

    hostChannel.onclose = () => {
      this.handleClientDisconnect(clientNode.clientId);
    };
  }

  handleMessage(msg, channel) {
    this.events.push(msg);

    switch (msg.type) {
      case 'JOIN_REQUEST': {
        const { playerId, playerName, proposedColor } = msg;
        const regResult = this.registry.requestColor(playerId, proposedColor);

        if (regResult.success) {
          // Register player in active session
          this.clients.set(playerId, {
            channel,
            name: playerName,
            color: regResult.color,
            hp: 100.0,
            pos: [0, 0, 0],
          });

          // Build session players list
          const sessionPlayers = Array.from(this.clients.entries()).map(([id, p]) => ({
            id,
            name: p.name,
            color: p.color,
          }));

          // Send approval to client
          const acceptMsg = {
            type: 'JOIN_ACCEPTED',
            playerId,
            assignedColor: regResult.color,
            sessionPlayers,
          };
          channel.send(JSON.stringify(acceptMsg));

          // Broadcast to all other peers
          this.broadcast(
            {
              type: 'PLAYER_JOINED',
              player: { id: playerId, name: playerName, color: regResult.color },
            },
            playerId
          );
        } else {
          // Send rejection
          const rejectMsg = {
            type: 'COLOR_REJECTED',
            playerId,
            attemptedColor: proposedColor,
            reason: regResult.error,
            message: regResult.message,
            availableColors: this.registry.getAvailablePalette(),
          };
          channel.send(JSON.stringify(rejectMsg));
        }
        break;
      }

      case 'FIRE_HITSCAN': {
        const { shooterId, weaponType, origin, direction, targetId } = msg;
        const target = this.clients.get(targetId);
        if (target) {
          const hitResult = validateHitscanRay(weaponType, origin, direction, target.pos);
          if (hitResult.hit) {
            target.hp = Math.max(0, target.hp - hitResult.damage);
            const hitConfirmMsg = {
              type: 'HIT_CONFIRMED',
              shooterId,
              victimId: targetId,
              damage: hitResult.damage,
              newHp: target.hp,
              isHeadshot: hitResult.isHeadshot,
            };
            this.broadcast(hitConfirmMsg);
          }
        }
        break;
      }
    }
  }

  broadcast(msgObj, excludeId = null) {
    const payload = JSON.stringify(msgObj);
    for (const [id, client] of this.clients.entries()) {
      if (id !== excludeId && client.channel && client.channel.isOpen) {
        client.channel.send(payload);
      }
    }
  }

  handleClientDisconnect(clientId) {
    const freed = this.registry.releasePlayer(clientId);
    this.clients.delete(clientId);
    if (freed) {
      this.broadcast({
        type: 'PLAYER_LEFT',
        playerId: clientId,
        freedColor: freed,
      });
    }
  }
}

/**
 * P2P Client simulation node.
 */
export class P2PClientNode {
  constructor(clientId, playerName) {
    this.clientId = clientId;
    this.playerName = playerName;
    this.channel = null;
    this.state = 'DISCONNECTED'; // DISCONNECTED, PENDING_JOIN, JOINED, REJECTED
    this.assignedColor = null;
    this.sessionPlayers = [];
    this.rejectionReason = null;
    this.availableColors = [];
    this.receivedMessages = [];
  }

  setChannel(channel) {
    this.channel = channel;
    this.channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          this.receivedMessages.push(msg);
          this.handleIncoming(msg);
        } catch {}
      } else {
        this.receivedBinaryMessages = this.receivedBinaryMessages || [];
        this.receivedBinaryMessages.push(event.data);
        if (typeof this.handleIncomingBinary === 'function') {
          this.handleIncomingBinary(event.data);
        }
      }
    };
  }

  requestJoin(proposedColor) {
    this.state = 'PENDING_JOIN';
    const msg = {
      type: 'JOIN_REQUEST',
      playerId: this.clientId,
      playerName: this.playerName,
      proposedColor,
    };
    this.channel.send(JSON.stringify(msg));
  }

  handleIncoming(msg) {
    switch (msg.type) {
      case 'JOIN_ACCEPTED':
        this.state = 'JOINED';
        this.assignedColor = msg.assignedColor;
        this.sessionPlayers = msg.sessionPlayers;
        break;
      case 'COLOR_REJECTED':
        this.state = 'REJECTED';
        this.rejectionReason = msg.reason;
        this.availableColors = msg.availableColors;
        break;
      case 'PLAYER_JOINED':
        this.sessionPlayers.push(msg.player);
        break;
      case 'PLAYER_LEFT':
        this.sessionPlayers = this.sessionPlayers.filter((p) => p.id !== msg.playerId);
        break;
    }
  }

  disconnect() {
    if (this.channel) {
      this.channel.close();
      this.state = 'DISCONNECTED';
    }
  }
}
