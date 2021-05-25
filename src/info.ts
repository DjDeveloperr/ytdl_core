import { querystring, sax } from "../deps.ts";
import { Cache } from "./cache.ts";
import * as sig from "./sig.ts";
import * as urlUtils from "./url_utils.ts";
import * as utils from "./utils.ts";
import * as formatUtils from "./format_util.ts";
import * as extras from "./info_extras.ts";
import { GetInfoOptions, VideoInfo } from "./types.ts";

const BASE_URL = "https://www.youtube.com/watch?v=";

export const cache = new Cache();
export const cookieCache = new Cache(1000 * 60 * 60 * 24);
export const watchPageCache = new Cache();

export class UnrecoverableError extends Error {
  name = "UnrecoverableError";
}

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.101 Safari/537.36";

const AGE_RESTRICTED_URLS = [
  "support.google.com/youtube/?p=age_restrictions",
  "youtube.com/t/community_guidelines",
];

export async function getBasicInfo(
  id: string,
  options: GetInfoOptions = {}
): Promise<VideoInfo> {
  id = urlUtils.getVideoID(id);
  options.headers = Object.assign(
    {},
    {
      // eslint-disable-next-line max-len
      "User-Agent": USER_AGENT,
    },
    options.headers
  );
  const validate = (info: any) => {
    let playErr = utils.playError(
      info.player_response,
      ["ERROR"],
      UnrecoverableError as any
    );
    let privateErr = privateVideoError(info.player_response);
    if (playErr || privateErr) {
      throw playErr || privateErr;
    }
    return (
      info &&
      info.player_response &&
      (info.player_response.streamingData ||
        isRental(info.player_response) ||
        isNotYetBroadcasted(info.player_response))
    );
  };
  let info = await pipeline([id, options], validate, {}, [
    getWatchHTMLPage,
    getWatchJSONPage,
    getVideoInfoPage,
  ]);

  Object.assign(info, {
    formats: parseFormats(info.player_response),
    related_videos: extras.getRelatedVideos(info),
  });

  // Add additional properties to info.
  const media = extras.getMedia(info);
  let additional = {
    author: extras.getAuthor(info),
    media,
    likes: extras.getLikes(info),
    dislikes: extras.getDislikes(info),
    age_restricted: !!(
      media &&
      media.notice_url &&
      AGE_RESTRICTED_URLS.some((url) => media.notice_url.includes(url))
    ),

    // Give the standard link to the video.
    video_url: BASE_URL + id,
    storyboards: extras.getStoryboards(info),
  };

  info.videoDetails = extras.cleanVideoDetails(
    Object.assign(
      {},
      info.player_response &&
        info.player_response.microformat &&
        info.player_response.microformat.playerMicroformatRenderer,
      info.player_response && info.player_response.videoDetails,
      additional
    ),
    info
  );

  return info;
}

const privateVideoError = (player_response: any) => {
  let playability = player_response && player_response.playabilityStatus;
  if (
    playability &&
    playability.status === "LOGIN_REQUIRED" &&
    playability.messages &&
    playability.messages.filter((m: any) => /This is a private video/.test(m))
      .length
  ) {
    return new UnrecoverableError(
      playability.reason || (playability.messages && playability.messages[0])
    );
  } else {
    return null;
  }
};

const isRental = (player_response: any) => {
  let playability = player_response.playabilityStatus;
  return (
    playability &&
    playability.status === "UNPLAYABLE" &&
    playability.errorScreen &&
    playability.errorScreen.playerLegacyDesktopYpcOfferRenderer
  );
};

const isNotYetBroadcasted = (player_response: any) => {
  let playability = player_response.playabilityStatus;
  return playability && playability.status === "LIVE_STREAM_OFFLINE";
};

const getWatchHTMLURL = (id: string, options: any) =>
  `${BASE_URL + id}&hl=${options.lang || "en"}`;
const getWatchHTMLPageBody = (id: string, options: any) => {
  const url = getWatchHTMLURL(id, options);
  return watchPageCache.getOrSet(url, () =>
    fetch(url, options)
      .then((r) => r.text())
      .then((t) => {
        return t;
      })
  );
};

const EMBED_URL = "https://www.youtube.com/embed/";
const getEmbedPageBody = (id: string, options: GetInfoOptions = {}) => {
  const embedUrl = `${EMBED_URL + id}?hl=${options.lang || "en"}`;
  return fetch(embedUrl, options).then((e) => e.text());
};

const getHTML5player = (body: string) => {
  let html5playerRes = /<script\s+src="([^"]+)"(?:\s+type="text\/javascript")?\s+name="player_ias\/base"\s*>|"jsUrl":"([^"]+)"/.exec(
    body
  );
  return html5playerRes ? html5playerRes[1] || html5playerRes[2] : null;
};

const getIdentityToken = (
  id: string,
  options: any,
  key: string,
  throwIfNotFound: boolean
) =>
  cookieCache.getOrSet(key, async () => {
    let page = await getWatchHTMLPageBody(id, options);
    let match = page.match(/(["'])ID_TOKEN\1[:,]\s?"([^"]+)"/);
    if (!match && throwIfNotFound) {
      throw new UnrecoverableError(
        "Cookie header used in request, but unable to find YouTube identity token"
      );
    }
    return match && match[2];
  });

/**
 * Goes through each endpoint in the pipeline, retrying on failure if the error is recoverable.
 * If unable to succeed with one endpoint, moves onto the next one.
 */
const pipeline = async (
  args: any[],
  validate: CallableFunction,
  retryOptions: any,
  endpoints: CallableFunction[]
) => {
  let info;
  for (let func of endpoints) {
    try {
      const newInfo = await retryFunc(func, args.concat([info]), retryOptions);
      if (newInfo.player_response) {
        newInfo.player_response.videoDetails = assign(
          info && info.player_response && info.player_response.videoDetails,
          newInfo.player_response.videoDetails
        );
        newInfo.player_response = assign(
          info && info.player_response,
          newInfo.player_response
        );
      }
      info = assign(info, newInfo);
      if (validate(info, false)) {
        break;
      }
    } catch (err) {
      if (
        err instanceof UnrecoverableError ||
        func === endpoints[endpoints.length - 1]
      ) {
        throw err;
      }
      // Unable to find video metadata... so try next endpoint.
    }
  }
  return info;
};

/**
 * Like Object.assign(), but ignores `null` and `undefined` from `source`.
 *
 * @param {Object} target
 * @param {Object} source
 * @returns {Object}
 */
const assign = (target: any, source: any) => {
  if (!target || !source) {
    return target || source;
  }
  for (let [key, value] of Object.entries(source)) {
    if (value !== null && value !== undefined) {
      target[key] = value;
    }
  }
  return target;
};

/**
 * Given a function, calls it with `args` until it's successful,
 * or until it encounters an unrecoverable error.
 * Currently, any error from miniget is considered unrecoverable. Errors such as
 * too many redirects, invalid URL, status code 404, status code 502.
 *
 * @param {Function} func
 * @param {Array.<Object>} args
 * @param {Object} options
 * @param {number} options.maxRetries
 * @param {Object} options.backoff
 * @param {number} options.backoff.inc
 */
const retryFunc = async (func: CallableFunction, args: any[], options: any) => {
  let currentTry = 0,
    result;
  while (currentTry <= (options.maxRetries ?? 1)) {
    try {
      result = await func(...args);
      break;
    } catch (err) {
      if (
        err instanceof UnrecoverableError ||
        err instanceof TypeError ||
        err.statusCode < 500 ||
        currentTry >= options.maxRetries
      ) {
        throw err;
      }
      let wait = Math.min(
        ++currentTry * (options.backoff?.inc ?? 0),
        options.backoff?.max ?? 0
      );
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  return result;
};

const jsonClosingChars = /^[)\]}'\s]+/;
const parseJSON = (source: any, varName: any, json: any) => {
  if (!json || typeof json === "object") {
    return json;
  } else {
    try {
      json = json.replace(jsonClosingChars, "");
      return JSON.parse(json);
    } catch (err) {
      throw Error(`Error parsing ${varName} in ${source}: ${err.message}`);
    }
  }
};

const findJSON = (
  source: any,
  varName: string,
  body: any,
  left: any,
  right: any,
  prependJSON: any
) => {
  let jsonStr = utils.between(body, left, right);
  if (!jsonStr) {
    throw Error(`Could not find ${varName} in ${source}`);
  }
  return parseJSON(
    source,
    varName,
    utils.cutAfterJSON(`${prependJSON}${jsonStr}`)
  );
};

const findPlayerResponse = (source: any, info: any) => {
  const player_response =
    info &&
    ((info.args && info.args.player_response) ||
      info.player_response ||
      info.playerResponse ||
      info.embedded_player_response);
  return parseJSON(source, "player_response", player_response);
};

const getWatchJSONURL = (id: string, options: GetInfoOptions) =>
  `${getWatchHTMLURL(id, options)}&pbj=1`;
const getWatchJSONPage = async (id: string, options: GetInfoOptions) => {
  const reqOptions = Object.assign({ headers: {} }, options);
  let cookie =
    (reqOptions.headers as any).Cookie || (reqOptions.headers as any).cookie;
  reqOptions.headers = Object.assign(
    {
      "x-youtube-client-name": "1",
      "x-youtube-client-version": "2.20201203.06.00",
      "x-youtube-identity-token": cookieCache.get(cookie || "browser") || "",
    },
    reqOptions.headers
  );

  const setIdentityToken = async (key: string, throwIfNotFound: boolean) => {
    if ((reqOptions.headers as any)["x-youtube-identity-token"]) {
      return;
    }
    (reqOptions.headers as any)[
      "x-youtube-identity-token"
    ] = await getIdentityToken(id, options, key, throwIfNotFound);
  };

  if (cookie) {
    await setIdentityToken(cookie, true);
  }

  const jsonUrl = getWatchJSONURL(id, options);
  let body = await fetch(jsonUrl, reqOptions).then((e) => e.text());
  let parsedBody = parseJSON("watch.json", "body", body);
  if (parsedBody.reload === "now") {
    await setIdentityToken("browser", false);
  }
  if (parsedBody.reload === "now" || !Array.isArray(parsedBody)) {
    throw Error("Unable to retrieve video metadata in watch.json");
  }
  let info = parsedBody.reduce((part, curr) => Object.assign(curr, part), {});
  info.player_response = findPlayerResponse("watch.json", info);
  info.html5player = info.player && info.player.assets && info.player.assets.js;

  return info;
};

const getWatchHTMLPage = async (id: string, options: GetInfoOptions) => {
  let body = await getWatchHTMLPageBody(id, options);
  let info: any = { page: "watch" };
  try {
    info.player_response = findJSON(
      "watch.html",
      "player_response",
      body,
      /\bytInitialPlayerResponse\s*=\s*\{/i,
      "\n",
      "{"
    );
  } catch (err) {
    let args = findJSON(
      "watch.html",
      "player_response",
      body,
      /\bytplayer\.config\s*=\s*{/,
      "</script>",
      "{"
    );
    info.player_response = findPlayerResponse("watch.html", args);
  }
  info.response = findJSON(
    "watch.html",
    "response",
    body,
    /\bytInitialData("\])?\s*=\s*\{/i,
    "\n",
    "{"
  );
  info.html5player = getHTML5player(body);
  return info;
};

const INFO_HOST = "www.youtube.com";
const INFO_PATH = "/get_video_info";
const VIDEO_EURL = "https://youtube.googleapis.com/v/";
const getVideoInfoPage = async (id: string, options: GetInfoOptions) => {
  const url = new URL(`https://${INFO_HOST}${INFO_PATH}`);
  url.searchParams.set("video_id", id);
  url.searchParams.set("eurl", VIDEO_EURL + id);
  url.searchParams.set("ps", "default");
  url.searchParams.set("gl", "US");
  url.searchParams.set("hl", options.lang || "en");
  url.searchParams.set('html5', '1');
  let body = await fetch(url.toString(), options).then((e) => e.text());
  let info = querystring.parse(body);
  info.player_response = findPlayerResponse("get_video_info", info);
  return info;
};

/**
 * @param {Object} player_response
 * @returns {Array.<Object>}
 */
const parseFormats = (player_response: any) => {
  let formats: any[] = [];
  if (player_response && player_response.streamingData) {
    formats = formats
      .concat(player_response.streamingData.formats || [])
      .concat(player_response.streamingData.adaptiveFormats || []);
  }
  return formats;
};

/**
 * Gets info from a video additional formats and deciphered URLs.
 */
export const getInfo = async (
  id: string,
  options: GetInfoOptions = {}
): Promise<VideoInfo> => {
  let info = await getBasicInfo(id, options);
  const hasManifest =
    info.player_response &&
    info.player_response.streamingData &&
    (info.player_response.streamingData.dashManifestUrl ||
      info.player_response.streamingData.hlsManifestUrl);
  let funcs = [];
  if (info.formats.length) {
    info.html5player = (info.html5player ||
      getHTML5player(await getWatchHTMLPageBody(id, options)) ||
      getHTML5player(await getEmbedPageBody(id, options)))!;
    if (!info.html5player) {
      throw Error("Unable to find html5player file");
    }
    const html5player = new URL(info.html5player, BASE_URL).toString();
    funcs.push(sig.decipherFormats(info.formats, html5player, options));
  }
  if (hasManifest && info.player_response.streamingData.dashManifestUrl) {
    let url = info.player_response.streamingData.dashManifestUrl;
    funcs.push(getDashManifest(url, options));
  }
  if (hasManifest && info.player_response.streamingData.hlsManifestUrl) {
    let url = info.player_response.streamingData.hlsManifestUrl;
    funcs.push(getM3U8(url, options));
  }

  let results = await Promise.all(funcs);
  info.formats = Object.values(Object.assign({}, ...results));
  info.formats = info.formats.map(formatUtils.addFormatMeta);
  info.formats.sort(formatUtils.sortFormats);
  info.full = true;
  return info;
};

/**
 * Gets additional DASH formats.
 *
 * @param {string} url
 * @param {Object} options
 * @returns {Promise<Array.<Object>>}
 */
const getDashManifest = (url: string, options: any) =>
  new Promise((resolve, reject) => {
    let formats: any = {};
    const parser = new sax.SAXParser(false, {});
    parser.onerror = reject;
    let adaptationSet: any;
    parser.onopentag = (node: any) => {
      if (node.name === "ADAPTATIONSET") {
        adaptationSet = node.attributes;
      } else if (node.name === "REPRESENTATION") {
        const itag = parseInt(node.attributes.ID as any);
        if (!isNaN(itag)) {
          formats[url] = Object.assign(
            {
              itag,
              url,
              bitrate: parseInt(node.attributes.BANDWIDTH as any),
              mimeType: `${adaptationSet.MIMETYPE}; codecs="${node.attributes.CODECS}"`,
            },
            node.attributes.HEIGHT
              ? {
                  width: parseInt(node.attributes.WIDTH as any),
                  height: parseInt(node.attributes.HEIGHT as any),
                  fps: parseInt(node.attributes.FRAMERATE as any),
                }
              : {
                  audioSampleRate: node.attributes.AUDIOSAMPLINGRATE,
                }
          );
        }
      }
    };
    parser.onend = () => {
      resolve(formats);
    };
    const req = fetch(new URL(url, BASE_URL).toString(), options);

    req
      .then(async (res) => {
        for await (const chunk of res.body!) {
          parser.write(new TextDecoder().decode(chunk));
        }
        parser.close.bind(parser)();
      })
      .catch(reject);
  });

/**
 * Gets additional formats.
 *
 * @param {string} url
 * @param {Object} options
 * @returns {Promise<Array.<Object>>}
 */
const getM3U8 = async (_url: string, options: any) => {
  let url = new URL(_url, BASE_URL);
  let body = await fetch(url.toString(), options.requestOptions).then((e) =>
    e.text()
  );
  let formats: any = {};
  body
    .split("\n")
    .filter((line) => /^https?:\/\//.test(line))
    .forEach((line) => {
      const itag = parseInt(line.match(/\/itag\/(\d+)\//)![1]);
      formats[line] = { itag, url: line };
    });
  return formats;
};
