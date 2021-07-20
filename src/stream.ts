import { VideoFormat, VideoInfo } from "./types.ts";

export class VideoStream extends ReadableStream<Uint8Array> {
  info!: VideoInfo;
  format!: VideoFormat;
  downloaded = 0;
  total = 0;
}
