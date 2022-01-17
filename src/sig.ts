import { querystring } from "../deps.ts";
import { Cache } from "./cache.ts";
import { request } from "./request.ts";

export const cache = new Cache();

/**
 * Swaps the first element of an array with one of given position.
 */
const swapHeadAndPosition = (arr: any[], position: number) => {
  const first = arr[0];
  arr[0] = arr[position % arr.length];
  arr[position] = first;
  return arr;
};

export const decipher = (tokens: string[], _sig: string) => {
  let sig = _sig.split("");
  for (let i = 0, len = tokens.length; i < len; i++) {
    let token = tokens[i],
      pos;
    switch (token[0]) {
      case "r":
        sig = sig.reverse();
        break;
      case "w":
        pos = ~~token.slice(1);
        sig = swapHeadAndPosition(sig, pos);
        break;
      case "s":
        pos = ~~token.slice(1);
        sig = sig.slice(pos);
        break;
      case "p":
        pos = ~~token.slice(1);
        sig.splice(0, pos);
        break;
    }
  }
  return sig.join("");
};

export function getTokens(file: string, options: RequestInit = {}) {
  return cache.getOrSet(file, async () => {
    let body = await request(file, options).then((e) => e.text());
    const tokens = extractActions(body);
    if (!tokens || !tokens.length) {
      throw Error("Could not extract signature deciphering actions");
    }
    cache.set(file, tokens);
    return tokens;
  });
}

const jsVarStr = "[a-zA-Z_\\$][a-zA-Z_0-9]*";
const jsSingleQuoteStr = `'[^'\\\\]*(:?\\\\[\\s\\S][^'\\\\]*)*'`;
const jsDoubleQuoteStr = `"[^"\\\\]*(:?\\\\[\\s\\S][^"\\\\]*)*"`;
const jsQuoteStr = `(?:${jsSingleQuoteStr}|${jsDoubleQuoteStr})`;
const jsKeyStr = `(?:${jsVarStr}|${jsQuoteStr})`;
const jsPropStr = `(?:\\.${jsVarStr}|\\[${jsQuoteStr}\\])`;
const jsEmptyStr = `(?:''|"")`;
const reverseStr = ":function\\(a\\)\\{" + "(?:return )?a\\.reverse\\(\\)" +
  "\\}";
const sliceStr = ":function\\(a,b\\)\\{" + "return a\\.slice\\(b\\)" + "\\}";
const spliceStr = ":function\\(a,b\\)\\{" + "a\\.splice\\(0,b\\)" + "\\}";
const swapStr = ":function\\(a,b\\)\\{" +
  "var c=a\\[0\\];a\\[0\\]=a\\[b(?:%a\\.length)?\\];a\\[b(?:%a\\.length)?\\]=c(?:;return a)?" +
  "\\}";
const actionsObjRegexp = new RegExp(
  `var (${jsVarStr})=\\{((?:(?:${jsKeyStr}${reverseStr}|${jsKeyStr}${sliceStr}|${jsKeyStr}${spliceStr}|${jsKeyStr}${swapStr}),?\\r?\\n?)+)\\};`,
);
const actionsFuncRegexp = new RegExp(
  `${`function(?: ${jsVarStr})?\\(a\\)\\{` +
    `a=a\\.split\\(${jsEmptyStr}\\);\\s*` +
    `((?:(?:a=)?${jsVarStr}`}${jsPropStr}\\(a,\\d+\\);)+)` +
    `return a\\.join\\(${jsEmptyStr}\\)` +
    `\\}`,
);
const reverseRegexp = new RegExp(`(?:^|,)(${jsKeyStr})${reverseStr}`, "m");
const sliceRegexp = new RegExp(`(?:^|,)(${jsKeyStr})${sliceStr}`, "m");
const spliceRegexp = new RegExp(`(?:^|,)(${jsKeyStr})${spliceStr}`, "m");
const swapRegexp = new RegExp(`(?:^|,)(${jsKeyStr})${swapStr}`, "m");

export const extractActions = (body: string) => {
  const objResult = actionsObjRegexp.exec(body);
  const funcResult = actionsFuncRegexp.exec(body);
  if (!objResult || !funcResult) {
    return null;
  }

  const obj = objResult[1].replace(/\$/g, "\\$");
  const objBody = objResult[2].replace(/\$/g, "\\$");
  const funcBody = funcResult[1].replace(/\$/g, "\\$");

  let result = reverseRegexp.exec(objBody);
  const reverseKey = result &&
    result[1].replace(/\$/g, "\\$").replace(/\$|^'|^"|'$|"$/g, "");
  result = sliceRegexp.exec(objBody);
  const sliceKey = result &&
    result[1].replace(/\$/g, "\\$").replace(/\$|^'|^"|'$|"$/g, "");
  result = spliceRegexp.exec(objBody);
  const spliceKey = result &&
    result[1].replace(/\$/g, "\\$").replace(/\$|^'|^"|'$|"$/g, "");
  result = swapRegexp.exec(objBody);
  const swapKey = result &&
    result[1].replace(/\$/g, "\\$").replace(/\$|^'|^"|'$|"$/g, "");

  const keys = `(${[reverseKey, sliceKey, spliceKey, swapKey].join("|")})`;
  const myreg = `(?:a=)?${obj}(?:\\.${keys}|\\['${keys}'\\]|\\["${keys}"\\])` +
    `\\(a,(\\d+)\\)`;
  const tokenizeRegexp = new RegExp(myreg, "g");
  const tokens = [];
  while ((result = tokenizeRegexp.exec(funcBody)) !== null) {
    let key = result[1] || result[2] || result[3];
    switch (key) {
      case swapKey:
        tokens.push(`w${result[4]}`);
        break;
      case reverseKey:
        tokens.push("r");
        break;
      case sliceKey:
        tokens.push(`s${result[4]}`);
        break;
      case spliceKey:
        tokens.push(`p${result[4]}`);
        break;
    }
  }
  return tokens;
};

export const setDownloadURL = (format: any, sig: string) => {
  let decodedUrl;
  if (format.url) {
    decodedUrl = format.url;
  } else {
    return;
  }

  try {
    decodedUrl = decodeURIComponent(decodedUrl);
  } catch (err) {
    return;
  }

  // Make some adjustments to the final url.
  const parsedUrl = new URL(decodedUrl);

  // This is needed for a speedier download.
  // See https://github.com/fent/node-ytdl-core/issues/127
  parsedUrl.searchParams.set("ratebypass", "yes");

  if (sig) {
    // When YouTube provides a `sp` parameter the signature `sig` must go
    // into the parameter it specifies.
    // See https://github.com/fent/node-ytdl-core/issues/417
    parsedUrl.searchParams.set(format.sp || "signature", sig);
  }

  format.url = parsedUrl.toString();
};

export const decipherFormats = async (
  formats: any[],
  html5player: string,
  options: RequestInit = {},
) => {
  let decipheredFormats: any = {};
  let tokens = await getTokens(html5player, options);
  formats.forEach((format) => {
    let cipher = format.signatureCipher || format.cipher;
    if (cipher) {
      Object.assign(format, querystring.decode(cipher));
      delete format.signatureCipher;
      delete format.cipher;
    }
    const sig = tokens && format.s ? decipher(tokens, format.s) : null;
    setDownloadURL(format, sig!);
    decipheredFormats[format.url] = format;
  });
  return decipheredFormats;
};
