import { describe, expect, it } from 'vitest';
import { consumeGrpcStream } from '../src/lib/grpc-stream';

const input = (pieces: Uint8Array[]) => new ReadableStream<Uint8Array>({
  start(controller) { for (const part of pieces) controller.enqueue(part); controller.close(); },
});
describe('gRPC incremental NDJSON parser', () => {
  it('handles split frames and split UTF-8 characters', async () => {
    const payload = '{"type":"message","index":1,"data":{"text":"猫"}}\n{"type":"complete","status":0,"count":1,"duration":12}\n';
    const bytes = new TextEncoder().encode(payload);
    const events: unknown[] = [];
    await consumeGrpcStream(input([bytes.slice(0,30), bytes.slice(30,47), bytes.slice(47)]), event => events.push(event));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({type:'message',data:{text:'猫'}});
    expect(events[1]).toMatchObject({type:'complete',status:0});
  });
  it('rejects missing terminal events', async () => {
    await expect(consumeGrpcStream(input([new TextEncoder().encode('{"type":"message","index":1,"data":{}}\n')]),()=>{}))
      .rejects.toThrow('disconnected');
  });
  it('surfaces server errors as terminal events', async () => {
    const output: unknown[] = [];
    await consumeGrpcStream(input([new TextEncoder().encode('{"type":"error","error":"deadline exceeded"}\n')]),e=>output.push(e));
    expect(output[0]).toMatchObject({type:'error',error:'deadline exceeded'});
  });
});
