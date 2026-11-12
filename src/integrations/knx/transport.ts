import type {
  InboundKNXFrame,
  KNXTelegram,
  KNXTransportMode,
  KNXTransportStatus,
} from '../../core/types/knx.ts';

/**
 * Pluggable KNX Bus Transport Abstraction.
 *
 * Allows a Hus KNX Digital Twin to operate in:
 * 1. `LoopbackSimulationTransport` (default in-browser KNX TP1 & EEPROM emulator)
 * 2. `WebSocketKNXGatewayTransport` (live bidirectional bridge to a physical KNXnet/IP
 *    interface such as knxd, Calimero, Weinzierl BAOS, or Node-RED/HomeAssistant KNX bridge).
 */

export type InboundFrameHandler = (frameOrHex: string | InboundKNXFrame) => void;
export type TransportStatusHandler = (
  status: KNXTransportStatus,
  mode: KNXTransportMode,
  endpointUrl?: string
) => void;

export interface KNXBusTransport {
  readonly mode: KNXTransportMode;
  readonly status: KNXTransportStatus;
  readonly endpointUrl?: string;
  connect(): Promise<void>;
  disconnect(): void;
  sendTelegram(telegram: KNXTelegram, payloadBytes: readonly number[]): void;
  onReceiveFrame(handler: InboundFrameHandler): () => void;
  onStatusChange(handler: TransportStatusHandler): () => void;
}

/**
 * Default local in-browser simulation transport.
 */
export class LoopbackSimulationTransport implements KNXBusTransport {
  public readonly mode: KNXTransportMode = 'simulation';
  public status: KNXTransportStatus = 'connected';
  private readonly frameHandlers = new Set<InboundFrameHandler>();
  private readonly statusHandlers = new Set<TransportStatusHandler>();

  public async connect(): Promise<void> {
    this.status = 'connected';
    for (const fn of this.statusHandlers) {
      fn(this.status, this.mode);
    }
  }

  public disconnect(): void {
    this.status = 'disconnected';
    for (const fn of this.statusHandlers) {
      fn(this.status, this.mode);
    }
  }

  public sendTelegram(_telegram: KNXTelegram, _payloadBytes: readonly number[]): void {
    // In local loopback simulation mode, state transitions are handled directly by the bus controller.
  }

  /**
   * Allows tests or external scripts (`window.__HUSJS_MOUNTED__.injectTelegram(...)`)
   * to inject raw hex or structured KNX telegrams into the simulated bus.
   */
  public injectSimulatedInboundFrame(frameOrHex: string | InboundKNXFrame): void {
    for (const fn of this.frameHandlers) {
      fn(frameOrHex);
    }
  }

  public onReceiveFrame(handler: InboundFrameHandler): () => void {
    this.frameHandlers.add(handler);
    return () => {
      this.frameHandlers.delete(handler);
    };
  }

  public onStatusChange(handler: TransportStatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }
}

/**
 * Live WebSocket KNXnet/IP Gateway Transport for connecting the 3D Digital Twin
 * directly to a live physical KNX TP1 bus.
 *
 * Wire protocol supported over WebSocket:
 * - Outbound JSON frame: `{ type: "knx_cemi_tx", src, dst, isGroup, apci, dpt, payloadBytes, hex }`
 * - Inbound message: either a raw TP1/cEMI hex string (`"BC 11 0A 0A 01 E3 00 80 FF 5E"`)
 *   or a JSON object (`{ dst: "1/2/1", src: "1.1.10", dpt: "5.001", payloadBytes: [0, 128, 255], hex: "..." }`).
 */
export class WebSocketKNXGatewayTransport implements KNXBusTransport {
  public readonly mode: KNXTransportMode = 'websocket-gateway';
  public status: KNXTransportStatus = 'disconnected';
  public readonly endpointUrl: string;

  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private intentionalClose = false;
  private readonly frameHandlers = new Set<InboundFrameHandler>();
  private readonly statusHandlers = new Set<TransportStatusHandler>();

  public constructor(endpointUrl: string) {
    this.endpointUrl = endpointUrl;
  }

  private setStatus(next: KNXTransportStatus): void {
    this.status = next;
    for (const fn of this.statusHandlers) {
      fn(this.status, this.mode, this.endpointUrl);
    }
  }

  public async connect(): Promise<void> {
    this.intentionalClose = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setStatus('connecting');

    await new Promise<void>((resolve) => {
      try {
        const socket = new WebSocket(this.endpointUrl);
        this.ws = socket;

        socket.addEventListener('open', () => {
          this.setStatus('connected');
          resolve();
        });

        socket.addEventListener('message', (event: MessageEvent) => {
          if (typeof event.data !== 'string') return;
          const raw = event.data.trim();
          if (!raw) return;

          if (raw.startsWith('{')) {
            try {
              const parsed = JSON.parse(raw) as Partial<InboundKNXFrame>;
              if (typeof parsed.dst === 'string') {
                const frame: InboundKNXFrame = {
                  dst: parsed.dst,
                  ...(typeof parsed.src === 'string' ? { src: parsed.src } : {}),
                  ...(typeof parsed.isGroup === 'boolean' ? { isGroup: parsed.isGroup } : {}),
                  ...(typeof parsed.apci === 'string' ? { apci: parsed.apci } : {}),
                  ...(typeof parsed.dpt === 'string' ? { dpt: parsed.dpt } : {}),
                  ...(Array.isArray(parsed.payloadBytes)
                    ? { payloadBytes: parsed.payloadBytes.map(Number) }
                    : {}),
                  ...(typeof parsed.hex === 'string' ? { hex: parsed.hex } : {}),
                  ...(typeof parsed.summary === 'string' ? { summary: parsed.summary } : {}),
                };
                for (const fn of this.frameHandlers) {
                  fn(frame);
                }
              } else if (typeof parsed.hex === 'string') {
                for (const fn of this.frameHandlers) {
                  fn(parsed.hex);
                }
              }
            } catch {
              // Ignore malformed JSON frames
            }
          } else {
            for (const fn of this.frameHandlers) {
              fn(raw);
            }
          }
        });

        socket.addEventListener('error', () => {
          this.setStatus('error');
          resolve();
        });

        socket.addEventListener('close', () => {
          this.ws = null;
          if (!this.intentionalClose) {
            this.setStatus('disconnected');
            this.scheduleReconnect();
          }
        });
      } catch {
        this.setStatus('error');
        resolve();
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.intentionalClose) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionalClose) {
        void this.connect();
      }
    }, 4000);
  }

  public disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  public sendTelegram(telegram: KNXTelegram, payloadBytes: readonly number[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const wireMsg = JSON.stringify({
      type: 'knx_cemi_tx',
      src: telegram.src,
      dst: telegram.dst,
      isGroup: telegram.isGroup,
      apci: telegram.apci,
      dpt: telegram.dpt,
      payloadBytes,
      hex: telegram.hex,
      summary: telegram.summary,
    });
    this.ws.send(wireMsg);
  }

  public onReceiveFrame(handler: InboundFrameHandler): () => void {
    this.frameHandlers.add(handler);
    return () => {
      this.frameHandlers.delete(handler);
    };
  }

  public onStatusChange(handler: TransportStatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }
}
