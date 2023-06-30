# ytdl_core

Deno port of [ytdl-core](https://www.npmjs.com/package/ytdl-core) using Web Streams API.

## Usage

```ts
import ytdl from "https://deno.land/x/ytdl_core/mod.ts";

const stream = await ytdl("vRXZj0DzXIA");

const chunks: Uint8Array[] = [];

for await (const chunk of stream) {
  chunks.push(chunk);
}

const blob = new Blob(chunks);
await Deno.writeFile("video.mp4", new Uint8Array(await blob.arrayBuffer()));
```

## License

Check [License](./LICENSE) for more info.

Copyright 2021 DjDeveloper, Copyright (C) 2012-present by fent
