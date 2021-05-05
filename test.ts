import ytdl from "./mod.ts";

const stream = await ytdl("vRXZj0DzXIA");

const chunks: Uint8Array[] = [];

for await (const chunk of stream) {
  chunks.push(chunk);
}

const blob = new Blob(chunks);
await Deno.writeFile("video.mp4", new Uint8Array(await blob.arrayBuffer()));
