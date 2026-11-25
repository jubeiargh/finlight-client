import { isObject } from './internal/json';

/**
 * WebSocket frame decoder (R-WS-1).
 *
 * Frames are checked for `event` first; those go to the v3 dispatcher. A frame with only
 * `action` is a control frame in v2 form: before the first v3 subscribe the server still
 * answers pings, preempts and errors that way. They map onto the same v3 types. A v2
 * article frame (`action: "sendArticle"`) is never delivered as an article.
 */
export type DecodedFrame =
  | { type: 'article'; event: string; kind: 'created' | 'updated'; data: unknown }
  | {
      type: 'admitted';
      leaseId: string | null;
      serverNow: number | null;
      clientNonce: string | null;
      legacy: boolean;
    }
  | { type: 'pong'; t: number | null; serverNow: number | null; legacy: boolean }
  | {
      type: 'preempted';
      reason: string;
      newLeaseId: string | null;
      timestamp: number | null;
      legacy: boolean;
    }
  | { type: 'error'; code: string | null; message: string | null; details: unknown; legacy: boolean }
  | { type: 'other'; event: string }
  | { type: 'ignored'; reason: string };

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function control(name: string, data: Record<string, unknown>, legacy: boolean): DecodedFrame | null {
  switch (name) {
    case 'admitted':
      return {
        type: 'admitted',
        leaseId: str(data.leaseId),
        serverNow: num(data.serverNow),
        clientNonce: str(data.clientNonce),
        legacy,
      };
    case 'pong':
      return { type: 'pong', t: num(data.t), serverNow: num(data.serverNow), legacy };
    case 'preempted':
      return {
        type: 'preempted',
        reason: str(data.reason) ?? 'unknown',
        newLeaseId: str(data.newLeaseId),
        timestamp: num(data.timestamp),
        legacy,
      };
    default:
      return null;
  }
}

export function decodeFrame(frame: unknown): DecodedFrame {
  if (!isObject(frame)) return { type: 'ignored', reason: 'frame is not a JSON object' };

  if (typeof frame.event === 'string') {
    const event = frame.event;
    const data = isObject(frame.data) ? frame.data : {};
    switch (event) {
      case 'article.created':
        return { type: 'article', event, kind: 'created', data: frame.data };
      case 'article.updated':
        return { type: 'article', event, kind: 'updated', data: frame.data };
      case 'connection.admitted':
        return control('admitted', data, false) as DecodedFrame;
      case 'connection.pong':
        return control('pong', data, false) as DecodedFrame;
      case 'connection.preempted':
        return control('preempted', data, false) as DecodedFrame;
      case 'connection.error':
        return {
          type: 'error',
          code: str(data.code),
          message: str(data.message),
          details: data.details,
          legacy: false,
        };
      default:
        return { type: 'other', event };
    }
  }

  if (typeof frame.action === 'string') {
    // v2-form control frames (sent before the first v3 subscribe).
    const action = frame.action;
    if (action === 'admit') return control('admitted', frame, true) as DecodedFrame;
    if (action === 'pong' || action === 'preempted') return control(action, frame, true) as DecodedFrame;
    if (action === 'error') {
      const payload = frame.error !== undefined ? frame.error : frame.data;
      if (isObject(payload)) {
        return {
          type: 'error',
          code: str(payload.code),
          message: str(payload.message) ?? str(payload.error),
          details: payload.details,
          legacy: true,
        };
      }
      return { type: 'error', code: null, message: str(payload), details: undefined, legacy: true };
    }
    if (action === 'sendArticle') {
      return { type: 'ignored', reason: 'v2 article frame (the stream speaks payloadVersion 3 only)' };
    }
    return { type: 'ignored', reason: `unknown v2 action "${action}"` };
  }

  return { type: 'ignored', reason: 'frame has neither "event" nor "action"' };
}
