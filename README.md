# jMonkeyEngine Website

This is the Hugo source for the jMonkeyEngine website.

## Requirements

- Hugo extended. The repo includes a Linux `./hugo` binary; otherwise install `hugo` on your PATH.
- `lessc`
- `python3`
- Python modules: `numpy`, `yaml`
- `ffmpeg`

## Build

```sh
./make.sh
```

The build refreshes homepage community data, regenerates the showcase mashup image,
compiles `static/css/style.less` to `static/css/style.css`, then runs Hugo.

Useful switches:

```sh
SKIP_COMMUNITY_DATA=1 ./make.sh
SKIP_SHOWCASE_MASHUP=1 ./make.sh
DONT_COMPILE_LESS=1 ./make.sh
```

## Local Server

```sh
./make.sh server
```

The server binds to `0.0.0.0` and uses Hugo's default port, `1313`.

## Library API

The Library page reads its backend address from the Hugo parameter
`params.libraryApiBase`. Override it for local development without editing the
tracked production default:

```sh
HUGO_PARAMS_LIBRARYAPIBASE=http://127.0.0.1:8080 ./make.sh server
```

Production backends must use HTTPS. Plain HTTP is accepted by the frontend only
for loopback development addresses.

The Library navigation button is controlled by `params.libraryEnabled` and is
disabled by default. Set it to `true` when the public Library link should be
shown; the `/library/` page remains available regardless of this navigation flag.

The Get Started embed uses `params.initializerUrl`. To preview the local initializer:

```sh
HUGO_PARAMS_INITIALIZERURL=http://127.0.0.1:8081 HUGO_PARAMS_LIBRARYAPIBASE=http://127.0.0.1:8080 ./make.sh server
```

The iframe requests the compact embed layout and resizes to its content, accepting
height messages only from the configured initializer frame and origin.

Library categories use the order returned by `/api/extensions/tags`: global
module count descending, combined GitHub stars descending, then name. The UI
only filters generic topics; it does not re-sort categories or derive them from
the current module page.
