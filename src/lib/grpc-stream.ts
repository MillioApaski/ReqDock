export type GrpcStreamEvent =
  | { type: 'message'; index: number; data: unknown }
  | { type: 'complete'; status: number; statusText: string; count: number; duration: number }
  | { type: 'error'; error: string; count?: number; duration?: number };

/** Read bounded newline-delimited JSON events, including fragmented UTF-8 and lines. */
export async function consumeGrpcStream(
  stream: ReadableStream<Uint8Array>, emit: (event: GrpcStreamEvent) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', receivedBytes = 0, count = 0, terminal = false;
  const handleLine = (line: string) => {
    if (!line) return;
    const event: unknown = JSON.parse(line);
    if (!event || typeof event !== 'object' || !('type' in event)) throw Error('Invalid gRPC stream frame.');
    const frame = event as GrpcStreamEvent;
    if (frame.type === 'message') {
      count++;
      if (count > 100) throw Error('Stream preview exceeds 100 messages.');
    } else if (frame.type === 'complete' || frame.type === 'error') terminal = true;
    else throw Error('Unknown gRPC stream event.');
    emit(frame);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > 3 * 1024 * 1024) throw Error('gRPC stream preview exceeds 3 MiB.');
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        handleLine(line);
        newline = buffer.indexOf('\n');
      }
      if (buffer.length > 3 * 1024 * 1024) throw Error('gRPC stream frame too large.');
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer.trim());
    if (!terminal) throw Error('gRPC stream disconnected before completion.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
