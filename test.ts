import ytdl from "./mod.ts";

const stream = await ytdl("vRXZj0DzXIA");
console.log("Size:", stream.total);

const chunks: Uint8Array[] = [];

for await (const chunk of stream) {
  chunks.push(chunk);
}

const blob = new Blob(chunks);
console.log("Saving as video.mp4...");
await Deno.writeFile("video.mp4", new Uint8Array(await blob.arrayBuffer()));
