export class VideoStream extends ReadableStream<Uint8Array> {
  info!: any;
  format!: any;
  downloaded = 0;
  total = 0;
}
