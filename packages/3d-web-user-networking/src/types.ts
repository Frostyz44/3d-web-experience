export type WebsocketFactory = (url: string) => WebSocket;

export enum WebsocketStatus {
  Connecting,
  Connected,
  Reconnecting,
  Disconnected,
}

export type UserNetworkingClientUpdate = {
  position: { x: number; y: number; z: number };
  rotation: { eulerY: number };
  state: number;
  /** The sender's clock in milliseconds when the update was taken (optional, for smooth playback). */
  time?: number;
};
