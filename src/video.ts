import * as utils from "./utils.ts";
import * as formatUtils from "./format_util.ts";
import { parseTimestamp, m3u8stream } from "../deps.ts";
import { getInfo } from "./info.ts";
import { VideoStream } from "./stream.ts";
import { DownloadOptions, VideoFormat } from "./types.ts";
import { request } from "./request.ts";

export interface VideoStreamSource {
  stream: VideoStream;
  push: CallableFunction;
  close: CallableFunction;
}

function createVideoStreamSource(): VideoStreamSource {
  const src: any = {
    stream: undefined,
    push: () => {},
    close: () => {},
  };

  src.stream = new VideoStream({
    start: (controller) => {
      src.controller = controller;
      src.push = (data: Uint8Array) => {
        if (src.closed) return;
        try {
          controller.enqueue(data);
        } catch(_e) {
          src.closed = true;
        }
      };
      src.close = () => {
        if (src.closed) return;
        try {
          controller.close();
        } catch (_e) {
          // ignore
        } finally {
          src.closed = true;
        }
      };
    },
  });

  return src;
}

async function downloadFromInfoInto(
  { stream, push, close }: VideoStreamSource,
  info: any,
  options: DownloadOptions = {},
) {
  let err = utils.playError(info.player_response, [
    "UNPLAYABLE",
    "LIVE_STREAM_OFFLINE",
    "LOGIN_REQUIRED",
  ]);
  if (err) {
    stream.cancel(err);
    return;
  }

  if (!info.formats.length) {
    stream.cancel(new Error("This video is unavailable"));
    return;
  }

  let format: VideoFormat;
  try {
    format = formatUtils.chooseFormat(info.formats, options);
  } catch (e) {
    stream.cancel(e);
    return;
  }

  stream.info = info;
  stream.format = format;

  if (stream.locked) return;

  let contentLength: number,
    downloaded = 0;

  const ondata = async (chunk: Uint8Array) => {
    downloaded += chunk.length;
    await push(chunk);
  };

  if (options.IPv6Block) {
    options.requestOptions = Object.assign({}, options.requestOptions, {
      family: 6,
      localAddress: utils.getRandomIPv6(options.IPv6Block),
    });
  }

  const dlChunkSize = options.dlChunkSize || 1024 * 1024 * 10;
  let req: Response;
  let shouldEnd = true;
  if (format.isHLS || format.isDashMPD) {
    const begin = options.begin || (format.isLive && Date.now());
    const req = m3u8stream(format.url, {
      chunkReadahead: +info.live_chunk_readahead,
      begin: begin.toString(),
      requestOptions: options.requestOptions,
      parser: format.isDashMPD ? "dash-mpd" : "m3u8",
      id: format.itag.toString(),
    });
    req.addListener("data", async (chunk) => {
      await push(chunk);
    });
    req.addListener("end", async () => {
      await close();
    });
  } else {
    const requestOptions = Object.assign({}, options, {
      maxReconnects: 6,
      maxRetries: 3,
      backoff: { inc: 500, max: 10000 },
    });

    let shouldBeChunked = dlChunkSize !== 0 &&
      (!format.hasAudio || !format.hasVideo);

    if (shouldBeChunked) {
      let start = (options.range && options.range.start) || 0;
      let end = start + dlChunkSize;
      const rangeEnd = options.range && options.range.end;

      contentLength = options.range
        ? (rangeEnd ? rangeEnd + 1 : parseInt(format.contentLength)) - start
        : parseInt(format.contentLength);

      stream.total = contentLength;

      const getNextChunk = async () => {
        if (!rangeEnd && end >= contentLength) end = 0;
        if (rangeEnd && end > rangeEnd) end = rangeEnd;
        shouldEnd = !end || end === rangeEnd;

        requestOptions.headers = Object.assign({}, requestOptions.headers, {
          Range: `bytes=${start}-${end || ""}`,
        });

        req = await request(format.url, requestOptions);

        for await (const chunk of req.body!) {
          stream.downloaded += chunk.length;
          await ondata(chunk);
        }

        if (end && end !== rangeEnd) {
          start = end + 1;
          end += dlChunkSize;
          await getNextChunk();
        }

        await close();
      };

      getNextChunk();
    } else {
      // Audio only and video only formats don't support begin
      if (options.begin) {
        format.url += `&begin=${
          parseTimestamp(
            typeof options.begin === "object"
              ? options.begin.getTime()
              : options.begin,
          )
        }`;
      }
      if (options.range && (options.range.start || options.range.end)) {
        requestOptions.headers = Object.assign({}, requestOptions.headers, {
          Range: `bytes=${options.range.start || "0"}-${options.range.end ||
            ""}`,
        });
      }
      req = await request(format.url, requestOptions);
      contentLength = parseInt(format.contentLength);

      stream.total = contentLength;

      (async () => {
        for await (const chunk of req.body!) {
          stream.downloaded += chunk.length;
          await ondata(chunk);
        }
        await close();
      })();
    }
  }
}

export async function downloadFromInfo(
  info: any,
  options: DownloadOptions = {},
) {
  const src = createVideoStreamSource();
  await downloadFromInfoInto(src, info, options);
  return src.stream;
}

export async function ytdl(id: string, options: DownloadOptions = {}) {
  const info = await getInfo(id, options);
  return await downloadFromInfo(info, options);
}
