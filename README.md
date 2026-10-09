# Journey Planner

A web page to plan journeys on Swiss public transport, like sbb.ch, on top of
[hrdf-routing-engine](https://github.com/urban-travel/hrdf-routing-engine). For each search it
shows the connections with their platforms, vehicle changes and walks, and how long the
routing took on the server.

It is plain HTML, CSS and JavaScript: nothing to install or build.

## Setup

It needs the `raptor-2026` branches of the engine and of the parser, next to this folder: the
engine uses the parser through the path `../hrdf-parser`.

```
your-folder/
├── hrdf-parser/          (branch raptor-2026)
├── hrdf-routing-engine/  (branch raptor-2026)
└── journey-app/
```

```sh
cd your-folder
git clone -b raptor-2026 https://github.com/urban-travel/hrdf-parser
git clone -b raptor-2026 https://github.com/urban-travel/hrdf-routing-engine
```

Requirements: the Rust toolchain and OpenSSL (`apt install libssl-dev` on Ubuntu), plus Python
3 to serve the page.

## Run

1. Start the routing server (port 8100):

   ```sh
   cd hrdf-routing-engine
   cargo run --release -- serve
   ```

   The first start downloads timetable 2026 (about 550 MB) and parses it (about 30 s); later
   starts load the cached result in a few seconds. `-c <dir>` keeps the cache elsewhere than the
   current directory.

2. Serve this folder (port 8080) and open http://localhost:8080:

   ```sh
   cd journey-app
   python3 -m http.server 8080
   ```

   Opening `index.html` directly in a browser works too.

The server covers timetable 2026, from 14 December 2025 to 12 December 2026. For a server on
another machine or port, add `?api=http://host:port` to the page address.

## Use

- Type a stop name in From and To (accents are optional: "zurich" finds Zürich HB), pick a
  suggestion with the mouse or the arrow keys and Enter.
- Choose whether the time is the departure or the arrival, then Search.
- Click a connection for its stops, platforms, changes and walks. Earlier and Later
  connections add more before or after.
- The page address keeps the search, so it can be reloaded or shared.

Times are those of the timetable: there is no real-time data. As on sbb.ch, the arrival time is
that of the last vehicle; a walk to the destination after it is shown but not counted.

The line under the results gives the routing time of each connection, the one-time
preparation of the date's network (about 0.4 s, on the first search of a date), and the time
of the whole request.
