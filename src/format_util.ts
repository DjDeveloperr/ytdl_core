import { Format, formats as FORMATS } from "./formats.ts";
import { ChooseFormatOptions, Filter, VideoFormat } from "./types.ts";
import * as utils from "./utils.ts";

const audioEncodingRanks = ["mp4a", "mp3", "vorbis", "aac", "opus", "flac"];
const videoEncodingRanks = [
  "mp4v",
  "avc1",
  "Sorenson H.283",
  "MPEG-4 Visual",
  "VP8",
  "VP9",
  "H.264",
];

const getVideoBitrate = (format: Format) => format.bitrate ?? 0;
const getVideoEncodingRank = (format: any) =>
  videoEncodingRanks.findIndex(
    (enc) => format.codecs && format.codecs.includes(enc)
  );
const getAudioBitrate = (format: Format) => format.audioBitrate || 0;
const getAudioEncodingRank = (format: any) =>
  audioEncodingRanks.findIndex(
    (enc) => format.codecs && format.codecs.includes(enc)
  );

/**
 * Sort formats by a list of functions.
 */
const sortFormatsBy = (a: any, b: any, sortBy: CallableFunction[]) => {
  let res = 0;
  for (let fn of sortBy) {
    res = fn(b) - fn(a);
    if (res !== 0) {
      break;
    }
  }
  return res;
};

const sortFormatsByVideo = (a: any, b: any) =>
  sortFormatsBy(a, b, [
    (format: any) => parseInt(format.qualityLabel),
    getVideoBitrate,
    getVideoEncodingRank,
  ]);

const sortFormatsByAudio = (a: any, b: any) =>
  sortFormatsBy(a, b, [getAudioBitrate, getAudioEncodingRank]);

export const sortFormats = (a: any, b: any) =>
  sortFormatsBy(a, b, [
    // Formats with both video and audio are ranked highest.
    (format: any) => +!!format.isHLS,
    (format: any) => +!!format.isDashMPD,
    (format: any) => +(format.contentLength > 0),
    (format: any) => +(format.hasVideo && format.hasAudio),
    (format: any) => +format.hasVideo,
    (format: any) => parseInt(format.qualityLabel) || 0,
    getVideoBitrate,
    getAudioBitrate,
    getVideoEncodingRank,
    getAudioEncodingRank,
  ]);

export function chooseFormat(
  formats: VideoFormat[],
  options: ChooseFormatOptions
) {
  if (typeof options.format === "object") {
    if (!options.format.url) {
      throw Error("Invalid format given, did you use `ytdl.getInfo()`?");
    }
    return options.format;
  }

  if (options.filter) {
    formats = filterFormats(formats, options.filter as any);
  }

  let format;
  const quality = options.quality || "highest";
  switch (quality) {
    case "highest":
      format = formats[0];
      break;

    case "lowest":
      format = formats[formats.length - 1];
      break;

    case "highestaudio":
      formats = filterFormats(formats, "audio");
      formats.sort(sortFormatsByAudio);
      format = formats[0];
      break;

    case "lowestaudio":
      formats = filterFormats(formats, "audio");
      formats.sort(sortFormatsByAudio);
      format = formats[formats.length - 1];
      break;

    case "highestvideo":
      formats = filterFormats(formats, "video");
      formats.sort(sortFormatsByVideo);
      format = formats[0];
      break;

    case "lowestvideo":
      formats = filterFormats(formats, "video");
      formats.sort(sortFormatsByVideo);
      format = formats[formats.length - 1];
      break;

    default:
      format = getFormatByQuality(
        Array.isArray(quality)
          ? quality.map((e: number | string) => e.toString())
          : quality.toString(),
        formats
      );
      break;
  }

  if (!format) {
    throw Error(`No such format found: ${quality}`);
  }
  return format;
}

/**
 * Gets a format based on quality or array of quality's
 */
const getFormatByQuality = (
  quality: string | string[],
  formats: VideoFormat[]
) => {
  let getFormat = (itag: any) =>
    formats.find((format) => `${format.itag}` === `${itag}`);
  if (Array.isArray(quality)) {
    return getFormat(quality.find((q) => getFormat(q)));
  } else {
    return getFormat(quality);
  }
};

export function filterFormats(formats: VideoFormat[], filter: Filter) {
  let fn: (format: VideoFormat) => boolean;
  switch (filter) {
    case "videoandaudio":
    case "audioandvideo":
      fn = (format) => format.hasVideo && format.hasAudio;
      break;

    case "video":
      fn = (format) => format.hasVideo;
      break;

    case "videoonly":
      fn = (format) => format.hasVideo && !format.hasAudio;
      break;

    case "audio":
      fn = (format) => format.hasAudio;
      break;

    case "audioonly":
      fn = (format) => !format.hasVideo && format.hasAudio;
      break;

    default:
      if (typeof filter === "function") {
        fn = filter;
      } else {
        throw TypeError(`Given filter (${filter}) is not supported`);
      }
  }
  return formats.filter((format) => !!format.url && fn(format));
}

export function addFormatMeta(format: VideoFormat) {
  format = Object.assign({}, FORMATS[format.itag], format);
  format.hasVideo = !!format.qualityLabel;
  format.hasAudio = !!format.audioBitrate;
  format.container = (format.mimeType
    ? format.mimeType.split(";")[0].split("/")[1]
    : null) as any;
  format.codecs = format.mimeType
    ? utils.between(format.mimeType, 'codecs="', '"')
    : null!;
  format.videoCodec =
    format.hasVideo && format.codecs ? format.codecs.split(", ")[0] : null!;
  format.audioCodec =
    format.hasAudio && format.codecs
      ? format.codecs.split(", ").slice(-1)[0]
      : null!;
  format.isLive = /\bsource[/=]yt_live_broadcast\b/.test(format.url);
  format.isHLS = /\/manifest\/hls_(variant|playlist)\//.test(format.url);
  format.isDashMPD = /\/manifest\/dash\//.test(format.url);
  return format;
}
