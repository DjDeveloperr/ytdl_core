/**
 * Extract string inbetween another.
 */
export function between(
  haystack: string,
  left: string | RegExp,
  right: string
): string {
  let pos;
  if (left instanceof RegExp) {
    const match = haystack.match(left);
    if (!match) {
      return "";
    }
    pos = match.index! + match[0].length;
  } else {
    pos = haystack.indexOf(left);
    if (pos === -1) {
      return "";
    }
    pos += left.length;
  }
  haystack = haystack.slice(pos);
  pos = haystack.indexOf(right);
  if (pos === -1) {
    return "";
  }
  haystack = haystack.slice(0, pos);
  return haystack;
}

/** Get a number from an abbreviated number string. */
export function parseAbbreviatedNumber(str: string) {
  const match = str
    .replace(",", ".")
    .replace(" ", "")
    .match(/([\d,.]+)([MK]?)/);
  if (match) {
    let [, _num, multi] = match;
    let num = parseFloat(_num);
    return Math.round(
      multi === "M" ? num * 1000000 : multi === "K" ? num * 1000 : num
    );
  }
  return null;
}

/** Match begin and end braces of input JSON, return only json */
export function cutAfterJSON(mixedJson: string) {
  let open, close;
  if (mixedJson[0] === "[") {
    open = "[";
    close = "]";
  } else if (mixedJson[0] === "{") {
    open = "{";
    close = "}";
  }

  if (!open) {
    throw new Error(
      `Can't cut unsupported JSON (need to begin with [ or { ) but got: ${mixedJson[0]}`
    );
  }

  // States if the loop is currently in a string
  let isString = false;

  // States if the current character is treated as escaped or not
  let isEscaped = false;

  // Current open brackets to be closed
  let counter = 0;

  let i;
  for (i = 0; i < mixedJson.length; i++) {
    // Toggle the isString boolean when leaving/entering string
    if (mixedJson[i] === '"' && !isEscaped) {
      isString = !isString;
      continue;
    }

    // Toggle the isEscaped boolean for every backslash
    // Reset for every regular character
    isEscaped = mixedJson[i] === "\\" && !isEscaped;

    if (isString) continue;

    if (mixedJson[i] === open) {
      counter++;
    } else if (mixedJson[i] === close) {
      counter--;
    }

    // All brackets have been closed, thus end of JSON is reached
    if (counter === 0) {
      // Return the cut JSON
      return mixedJson.substr(0, i + 1);
    }
  }

  // We ran through the whole string and ended up with an unclosed bracket
  throw Error("Can't cut unsupported JSON (no matching closing bracket found)");
}

/** Checks if there is a playability error. */
export function playError(
  player_response: any,
  statuses: string[],
  ErrorType = Error
) {
  let playability = player_response && player_response.playabilityStatus;
  if (playability && statuses.includes(playability.status)) {
    return new ErrorType(
      playability.reason || (playability.messages && playability.messages[0])
    );
  }
  return null;
}

// eslint-disable-next-line max-len
const IPV6_REGEX =
  /^(([0-9a-f]{1,4}:)(:[0-9a-f]{1,4}){1,6}|([0-9a-f]{1,4}:){1,2}(:[0-9a-f]{1,4}){1,5}|([0-9a-f]{1,4}:){1,3}(:[0-9a-f]{1,4}){1,4}|([0-9a-f]{1,4}:){1,4}(:[0-9a-f]{1,4}){1,3}|([0-9a-f]{1,4}:){1,5}(:[0-9a-f]{1,4}){1,2}|([0-9a-f]{1,4}:){1,6}(:[0-9a-f]{1,4})|([0-9a-f]{1,4}:){1,7}(([0-9a-f]{1,4})|:))\/(1[0-1]\d|12[0-8]|\d{1,2})$/;

/**
 * Quick check for a valid IPv6
 * The Regex only accepts a subset of all IPv6 Addresses
 *
 * @param {string} ip the IPv6 block in CIDR-Notation to test
 * @returns {boolean} true if valid
 */
export function isIPv6(ip: string) {
  return IPV6_REGEX.test(ip);
}

/**
 * Gets random IPv6 Address from a block
 */
export function getRandomIPv6(ip: string) {
  // Start with a fast Regex-Check
  if (!isIPv6(ip)) throw Error("Invalid IPv6 format");
  // Start by splitting and normalizing addr and mask
  const [rawAddr, rawMask] = ip.split("/");
  let base10Mask = parseInt(rawMask);
  if (!base10Mask || base10Mask > 128 || base10Mask < 24)
    throw Error("Invalid IPv6 subnet");
  const base10addr = normalizeIP(rawAddr);
  // Get random addr to pad with
  // using Math.random since we're not requiring high level of randomness
  const randomAddr = new Array(8)
    .fill(1)
    .map(() => Math.floor(Math.random() * 0xffff));

  // Merge base10addr with randomAddr
  const mergedAddr = randomAddr.map((randomItem, idx) => {
    // Calculate the amount of static bits
    const staticBits = Math.min(base10Mask, 16);
    // Adjust the bitmask with the staticBits
    base10Mask -= staticBits;
    // Calculate the bitmask
    // lsb makes the calculation way more complicated
    const mask = 0xffff - (2 ** (16 - staticBits) - 1);
    // Combine base10addr and random
    return (base10addr[idx] & mask) + (randomItem & (mask ^ 0xffff));
  });
  // Return new addr
  return mergedAddr.map((x) => x.toString(16)).join(":");
}
/**
 * Normalise an IP Address
 *
 * @param {string} ip the IPv6 Addr
 * @returns {number[]} the 8 parts of the IPv6 as Integers
 */
export function normalizeIP(ip: string) {
  // Split by fill position
  const parts = ip.split("::").map((x) => x.split(":"));
  // Normalize start and end
  const partStart = parts[0] || [];
  const partEnd = parts[1] || [];
  partEnd.reverse();
  // Placeholder for full ip
  const fullIP = new Array(8).fill(0);
  // Fill in start and end parts
  for (let i = 0; i < Math.min(partStart.length, 8); i++) {
    fullIP[i] = parseInt(partStart[i], 16) || 0;
  }
  for (let i = 0; i < Math.min(partEnd.length, 8); i++) {
    fullIP[7 - i] = parseInt(partEnd[i], 16) || 0;
  }
  return fullIP;
}
