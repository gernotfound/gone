import type { IDataChannel } from './protocol.ts';

const RELAY_PROTOCOL_VERSION = 1;
const HEADER_BYTES = 3;

function websocketUrl(): string {
  const url = new URL('/__gone_host/ws', window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function toArrayBuffer(data: string | ArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data).buffer as ArrayBuffer;
  }
  if (data instanceof ArrayBuffer) return data;
  const copy = new Uint8Array(data.byteLength);
  copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return copy.buffer;
}

function encodeHostFrame(peerId: string, payload: string | ArrayBuffer | ArrayBufferView): ArrayBuffer {
  const id = new TextEncoder().encode(peerId);
  if (id.byteLength === 0 || id.byteLength > 0xffff) throw new Error('Relay peer id non valido.');
  const body = new Uint8Array(toArrayBuffer(payload));
  const frame = new Uint8Array(HEADER_BYTES + id.byteLength + body.byteLength);
  frame[0] = RELAY_PROTOCOL_VERSION;
  new DataView(frame.buffer).setUint16(1, id.byteLength, false);
  frame.set(id, HEADER_BYTES);
  frame.set(body, HEADER_BYTES + id.byteLength);
  return frame.buffer;
}

function decodeHostFrame(frame: ArrayBuffer): { peerId: string; payload: ArrayBuffer } | null {
  if (frame.byteLength < HEADER_BYTES) return null;
  const bytes = new Uint8Array(frame);
  if (bytes[0] !== RELAY_PROTOCOL_VERSION) return null;
  const idLength = new DataView(frame).getUint16(1, false);
  if (idLength === 0 || HEADER_BYTES + idLength > frame.byteLength) return null;
  const peerId = new TextDecoder().decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + idLength));
  const payload = bytes.slice(HEADER_BYTES + idLength).buffer;
  return { peerId, payload };
}

abstract class RelayChannelBase implements IDataChannel {
  public binaryType: 'arraybuffer' = 'arraybuffer';
  public onmessage?: ((ev: { data: any }) => void) | null;
  public onopen?: (() => void) | null;
  public onclose?: (() => void) | null;
  public onerror?: ((err: any) => void) | null;

  protected state: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting';
  private openNotified = false;
  private closeNotified = false;

  get readyState(): string {
    return this.state;
  }

  protected notifyOpen(): void {
    if (this.openNotified || this.state === 'closed') return;
    this.openNotified = true;
    this.state = 'open';
    this.onopen?.();
  }

  protected notifyMessage(data: ArrayBuffer): void {
    if (this.state !== 'open') return;
    this.onmessage?.({ data });
  }

  protected notifyError(error: unknown): void {
    this.onerror?.(error instanceof Error ? error : new Error(String(error)));
  }

  protected notifyClose(): void {
    if (this.closeNotified) return;
    this.closeNotified = true;
    this.state = 'closed';
    this.onclose?.();
  }

  abstract send(data: string | ArrayBuffer | ArrayBufferView): void;
  abstract close(): void;
}

export class RelayGuestChannel extends RelayChannelBase {
  private readonly socket: WebSocket;
  private readonly token: string;
  private readonly peerId: string;

  constructor(token: string, peerId: string) {
    super();
    this.token = token;
    this.peerId = peerId;
    this.socket = new WebSocket(websocketUrl());
    this.socket.binaryType = 'arraybuffer';

    this.socket.addEventListener('open', () => {
      this.socket.send(JSON.stringify({
        type: 'hello',
        role: 'guest',
        token: this.token,
        peerId: this.peerId,
        v: RELAY_PROTOCOL_VERSION,
      }));
    });

    this.socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        let message: any;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message?.type === 'ready') {
          this.notifyOpen();
        } else if (message?.type === 'host-close') {
          this.close();
        } else if (message?.type === 'error') {
          this.notifyError(new Error(message.message || 'Relay self-host non disponibile.'));
          this.close();
        }
        return;
      }
      if (event.data instanceof ArrayBuffer) this.notifyMessage(event.data);
    });

    this.socket.addEventListener('error', () => {
      if (this.state !== 'closed') this.notifyError(new Error('Connessione al G.O.N.E. Host fallita.'));
    });
    this.socket.addEventListener('close', () => this.notifyClose());
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.state !== 'open' || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Relay WebSocket non aperto.');
    }
    this.socket.send(toArrayBuffer(data));
  }

  close(): void {
    if (this.state === 'closed') return;
    this.state = 'closing';
    try { this.socket.close(1000, 'client-close'); } catch { /* no-op */ }
    this.notifyClose();
  }
}

class RelayHostPeerChannel extends RelayChannelBase {
  private readonly bridge: RelayHostBridge;
  public readonly peerId: string;

  constructor(bridge: RelayHostBridge, peerId: string) {
    super();
    this.bridge = bridge;
    this.peerId = peerId;
  }

  activate(): void {
    this.notifyOpen();
  }

  deliver(payload: ArrayBuffer): void {
    this.notifyMessage(payload);
  }

  remoteClosed(): void {
    this.notifyClose();
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.state !== 'open') throw new Error(`Relay peer ${this.peerId} non aperto.`);
    this.bridge.sendToPeer(this.peerId, data);
  }

  close(): void {
    if (this.state === 'closed') return;
    this.bridge.closePeer(this.peerId);
    this.notifyClose();
  }
}

export interface RelayHostBridgeOptions {
  token: string;
  onPeer: (peerId: string, channel: IDataChannel) => void;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onClosed?: () => void;
}

export class RelayHostBridge {
  private readonly socket: WebSocket;
  private readonly options: RelayHostBridgeOptions;
  private readonly peers = new Map<string, RelayHostPeerChannel>();
  private isReady = false;

  constructor(options: RelayHostBridgeOptions) {
    this.options = options;
    this.socket = new WebSocket(websocketUrl());
    this.socket.binaryType = 'arraybuffer';

    this.socket.addEventListener('open', () => {
      this.socket.send(JSON.stringify({
        type: 'hello',
        role: 'host',
        token: this.options.token,
        v: RELAY_PROTOCOL_VERSION,
      }));
    });

    this.socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        this.handleControl(event.data);
        return;
      }
      if (!(event.data instanceof ArrayBuffer)) return;
      const decoded = decodeHostFrame(event.data);
      if (!decoded) return;
      this.peers.get(decoded.peerId)?.deliver(decoded.payload);
    });

    this.socket.addEventListener('error', () => {
      this.options.onError?.(new Error('Bridge G.O.N.E. Host non raggiungibile.'));
    });
    this.socket.addEventListener('close', () => {
      for (const peer of this.peers.values()) peer.remoteClosed();
      this.peers.clear();
      this.options.onClosed?.();
    });
  }

  private sendControl(value: Record<string, unknown>): void {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Bridge host non aperto.');
    }
    this.socket.send(JSON.stringify(value));
  }

  private handleControl(raw: string): void {
    let message: any;
    try { message = JSON.parse(raw); } catch { return; }

    if (message?.type === 'ready') {
      if (!this.isReady) {
        this.isReady = true;
        this.options.onReady?.();
      }
      return;
    }

    if (message?.type === 'peer-open' && typeof message.peerId === 'string') {
      if (this.peers.has(message.peerId)) return;
      const channel = new RelayHostPeerChannel(this, message.peerId);
      this.peers.set(message.peerId, channel);

      try {
        // Ordering is deliberate: first P2PHost installs its callbacks, then
        // the pseudo-channel becomes open, then the relay releases the guest.
        // Therefore the guest's first JOIN_REQUEST cannot outrun registration.
        this.options.onPeer(message.peerId, channel);
        channel.activate();
        this.sendControl({ type: 'peer-ready', peerId: message.peerId });
      } catch (error) {
        this.peers.delete(message.peerId);
        channel.remoteClosed();
        try { this.sendControl({ type: 'peer-kick', peerId: message.peerId }); } catch { /* socket closing */ }
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
      return;
    }

    if (message?.type === 'peer-close' && typeof message.peerId === 'string') {
      const channel = this.peers.get(message.peerId);
      this.peers.delete(message.peerId);
      channel?.remoteClosed();
      return;
    }

    if (message?.type === 'error') {
      this.options.onError?.(new Error(message.message || 'Errore G.O.N.E. Host.'));
    }
  }

  sendToPeer(peerId: string, data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('Bridge host non aperto.');
    this.socket.send(encodeHostFrame(peerId, data));
  }

  closePeer(peerId: string): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'peer-kick', peerId }));
    }
    const peer = this.peers.get(peerId);
    this.peers.delete(peerId);
    peer?.remoteClosed();
  }

  close(): void {
    for (const peer of this.peers.values()) peer.remoteClosed();
    this.peers.clear();
    try { this.socket.close(1000, 'host-close'); } catch { /* no-op */ }
  }
}

export function createRelayGuestChannel(token: string, peerId: string): IDataChannel {
  return new RelayGuestChannel(token, peerId);
}

export function createRelayHostBridge(options: RelayHostBridgeOptions): RelayHostBridge {
  return new RelayHostBridge(options);
}
