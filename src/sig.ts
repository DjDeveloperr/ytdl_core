import { querystring } from "../deps.ts";
import { Cache } from "./cache.ts";
import { between, cutAfterJSON } from "./utils.ts";
import { request } from "./request.ts";

// A shared cache to keep track of html5player js functions.
export const cache = new Cache();

/**
 * Extract signature deciphering and n parameter transform functions from html5player file.
 *
 * @param {string} html5playerfile
 * @param {Object} options
 * @returns {Promise<Array.<string>>}
 */
export function getFunctions(
  html5playerfile: string,
  options: RequestInit
): string[] {
  return cache.getOrSet(html5playerfile, async () => {
    const res = await request(html5playerfile, options);
    const body = await res.text();
    const functions = extractFunctions(body);
    if (!functions || !functions.length) {
      throw Error("Could not extract functions");
    }
    cache.set(html5playerfile, functions);
    return functions;
  });
}

/**
 * Extracts the actions that should be taken to decipher a signature
 * and tranform the n parameter
 *
 * @param {string} body
 * @returns {Array.<string>}
 */
export function extractFunctions(body: string) {
  const functions: string[] = [];
  const extractManipulations = (caller: string) => {
    const functionName = between(caller, `a=a.split("");`, `.`);
    if (!functionName) return "";
    const functionStart = `var ${functionName}={`;
    const ndx = body.indexOf(functionStart);
    if (ndx < 0) return "";
    const subBody = body.slice(ndx + functionStart.length - 1);
    return `var ${functionName}=${cutAfterJSON(subBody)}`;
  };
  const extractDecipher = () => {
    const functionName = between(
      body,
      `a.set("alr","yes");c&&(c=`,
      `(decodeURIC`
    );
    if (functionName && functionName.length) {
      const functionStart = `${functionName}=function(a)`;
      const ndx = body.indexOf(functionStart);
      if (ndx >= 0) {
        const subBody = body.slice(ndx + functionStart.length);
        let functionBody = `var ${functionStart}${cutAfterJSON(subBody)}`;
        functionBody = `${extractManipulations(
          functionBody
        )};${functionBody};${functionName}(sig);`;
        functions.push(functionBody);
      }
    }
  };
  const extractNCode = () => {
    let functionName = between(body, `&&(b=a.get("n"))&&(b=`, `(b)`);
    if (functionName.includes("["))
      functionName = between(body, `${functionName.split("[")[0]}=[`, `]`);
    if (functionName && functionName.length) {
      const functionStart = `${functionName}=function(a)`;
      const ndx = body.indexOf(functionStart);
      if (ndx >= 0) {
        const end = body.indexOf('.join("")};', ndx);
        const subBody = body.slice(ndx, end);

        const functionBody = `${subBody}.join("")};${functionName}(ncode);`;
        functions.push(functionBody);
      }
    }
  };
  extractDecipher();
  extractNCode();
  return functions;
}

/**
 * Apply decipher and n-transform to individual format
 *
 * @param {Object} format
 * @param {vm.Script} decipherScript
 * @param {vm.Script} nTransformScript
 */
export function setDownloadURL(
  format: any,
  decipherScript: ((sig: string) => string) | undefined,
  nTransformScript: ((ncode: string) => string) | undefined
) {
  const decipher = (url: string) => {
    const args = querystring.parse(url) as any;
    if (!args.s || !decipherScript) return args.url;
    const components = new URL(decodeURIComponent(args.url));
    components.searchParams.set(
      args.sp ? args.sp : "signature",
      decipherScript(decodeURIComponent(args.s))
    );
    return components.toString();
  };
  const ncode = (url: string) => {
    const components = new URL(decodeURIComponent(url));
    const n = components.searchParams.get("n");
    if (!n || !nTransformScript) return url;
    components.searchParams.set("n", nTransformScript(n));
    return components.toString();
  };
  const cipher = !format.url;
  const url = format.url || format.signatureCipher || format.cipher;
  format.url = cipher ? ncode(decipher(url)) : ncode(url);
  delete format.signatureCipher;
  delete format.cipher;
}

/**
 * Applies decipher and n parameter transforms to all format URL's.
 *
 * @param {Array.<Object>} formats
 * @param {string} html5player
 * @param {Object} options
 */
export async function decipherFormats(
  formats: any[],
  html5player: string,
  options: any
) {
  const decipheredFormats: any = {};
  const functions = await getFunctions(html5player, options);
  const decipherScript = functions.length
    ? createFunc("sig")(functions[0])
    : undefined;
  const nTransformScript =
    functions.length > 1 ? createFunc("ncode")(functions[1]) : undefined;
  formats.forEach((format) => {
    setDownloadURL(format, decipherScript as any, nTransformScript as any);
    decipheredFormats[format.url] = format;
  });
  return decipheredFormats;
}

function createFunc(param: string) {
  return new Function("source", param, `return (${param}) => eval(source)`);
}
