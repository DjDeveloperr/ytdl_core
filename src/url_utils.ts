/**
 * Returns true if given id satifies YouTube's id format.
 *
 * @param {string} id
 * @return {boolean}
 */
const idRegex = /^[a-zA-Z0-9-_]{11}$/;
export const validateID = (id: string) => idRegex.test(id);

const validQueryDomains = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "gaming.youtube.com",
]);
const validPathDomains = /^https?:\/\/(youtu\.be\/|(www\.)?youtube.com\/(embed|v|shorts)\/)/;
/**
 * Get video ID.
 *
 * There are a few type of video URL formats.
 *  - https://www.youtube.com/watch?v=VIDEO_ID
 *  - https://m.youtube.com/watch?v=VIDEO_ID
 *  - https://youtu.be/VIDEO_ID
 *  - https://www.youtube.com/v/VIDEO_ID
 *  - https://www.youtube.com/embed/VIDEO_ID
 *  - https://music.youtube.com/watch?v=VIDEO_ID
 *  - https://gaming.youtube.com/watch?v=VIDEO_ID
 */
export const getURLVideoID = (link: string) => {
  const parsed = new URL(link);
  let id = parsed.searchParams.get("v");
  if (validPathDomains.test(link) && !id) {
    const paths = parsed.pathname.split("/");
    id = paths[paths.length - 1];
  } else if (parsed.hostname && !validQueryDomains.has(parsed.hostname)) {
    throw Error("Not a YouTube domain");
  }
  if (!id) {
    throw Error(`No video id found: ${link}`);
  }
  id = id.substring(0, 11);
  if (!validateID(id)) {
    throw TypeError(
      `Video id (${id}) does not match expected ` +
        `format (${idRegex.toString()})`
    );
  }
  return id;
};

/**
 * Gets video ID either from a url or by checking if the given string
 * matches the video ID format.
 */
const urlRegex = /^https?:\/\//;
export const getVideoID = (str: string) => {
  if (validateID(str)) {
    return str;
  } else if (urlRegex.test(str)) {
    return getURLVideoID(str);
  } else {
    throw Error(`No video id found: ${str}`);
  }
};

/**
 * Checks wether the input string includes a valid id.
 */
export const validateURL = (string: string) => {
  try {
    getURLVideoID(string);
    return true;
  } catch (e) {
    return false;
  }
};
