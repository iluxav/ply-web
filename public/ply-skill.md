# ply — agent guide

> Package, run, scale, wire and deploy applications with ply — the daemonless Linux container runtime where an app is a package, dependencies are declared in ply.toml, and an image is a resolved lockfile. Use this whenever the user mentions ply, ply.toml, `ply build`/`ply run`/`ply deploy`, plybox.sh, or a .img container image; when they want to containerize an app without Docker or a Dockerfile; when they ask about running services on a single VPS or droplet without Kubernetes; or when they are wiring several services together, publishing ports, adding TLS, or importing a Docker image into ply. Also use it when a ply command errored and they want it diagnosed; and when operating a ply host or fleet — deploying via deployment files, checking deploy status, reading the events journal, scaling, rolling back, or diagnosing a failed build on a server.



# ply

ply packages an app the way Cargo or npm packages a library: a `ply.toml`
manifest declares dependencies, `ply build` resolves them into a lockfile and
writes one deterministic `.img` file, and `ply run` mounts that closure and
execs. No daemon, no Dockerfile, no registry to run.

Most mistakes come from importing Docker habits. The four that matter:

| Docker instinct | What ply does instead |
|---|---|
| write a Dockerfile | declare dependencies in `ply.toml`; there are no build steps |
| `-p 8080:80` maps a host port | `[ports]` are **labels**; host binding is `--publish` at run time |
| `docker run -d` detaches | `ply run` is foreground; supervision is systemd's job |
| containers talk over a bridge network by name | `--publish internal:PORT` + `--after` |

## Authoring ply.toml

Start from `ply init` when the directory is a real project — it detects
Node/Python and writes sensible defaults. Otherwise write it directly:

```toml
[package]
name = "myapp"                      # no "-<digit>" (filename grammar)
version = "1.2.0"
entrypoint = ["node", "server.js"]  # exec-style, no shell
include = ["dist/", "package.json"] # ONLY these ship; omit = pack everything
base = "debian@13"                  # exactly one package owns /

[dependencies]
node = "22"                         # a range: lowest satisfying version wins

[env]
NODE_ENV = "production"

[ports]
web = 3000                          # a label, NOT a host claim

[health]
port = 3000                         # gates rolling deploys
grace = "15s"

[restart]
policy = "on-failure"

[sources]
default = "https://registry.plybox.sh/ply/{package}"
```

`include` is worth setting deliberately: without it every file in the
directory ships, which usually means `node_modules`, `.git` and build caches
end up in the image.

**Check the catalog before writing a version range.** The registry is a
curated Debian-derived (glibc) catalog, and what it has for a given name
rarely matches what upstream released — asking for `node = "22"` when the registry
carries 20 and 24 produces a manifest that fails at `ply build`, after the
user has already committed it:

```sh
ply search node --versions     # what actually exists, per arch
ply add node                   # writes a range that resolves
```

Prefer `ply add` over hand-editing `[dependencies]` for exactly this reason.
When you do write a range by hand, know that resolution is Minimal Version
Selection: **`"24"` picks the lowest 24.x in the catalog, not the newest.**
That is deliberate — builds don't drift when the registry gains a version —
but it surprises anyone expecting npm or cargo caret behaviour. Pin exactly
(`"24.18.1"`) when a specific version matters.

Full field reference: `references/manifest.md`.

## Running

```sh
ply build .                         # → myapp-1.2.0-linux-x64.img + ply.lock
ply run myapp-1.2.0-linux-x64.img --scale 4 --publish 8080
```

`--publish` is the only thing that claims a host port. The run parent binds
it and L4-balances across instances — it forked them, so the backend set
follows launches, crashes and rolling deploys with no discovery or reload.

**Who can reach it is a decision, not a default.** `--publish 5432` binds
`0.0.0.0`, which on a public host means your database is on the internet:

```sh
ply run api.img --publish 8080                  # 0.0.0.0 — a public web port
ply run db.img  --publish internal:5432         # only ply apps on this host
ply run edge.img --publish 80:80 --publish 443:443   # repeatable
```

Reach for `internal:` whenever the consumer is another app on the same host.
It resolves to loopback rootless and the bridge gateway rootful, so the same
command is correct in both modes.

## Wiring several services together

This is where Docker habits hurt most. The compose equivalent is a
`[stack]` table in a ply.toml (registry services + local app dirs, wired
with `after` and per-member env) started by `ply up`; prebuilt services run
by name (`ply run postgres@17 -e POSTGRES_PASSWORD=dev`). Underneath both,
`--after` declares a dependency edge, waits for the dependency's `[health]`
gate, **and injects its address**:

```sh
ply run pgdb.img --publish internal:5432 &
ply run api.img --scale 4 --publish internal:3000 --after pgdb &
ply run web.img --scale 2 --publish 8080 --after api
#   web sees:  API_ADDR=…  API_HOST=…  API_PORT=…
#   api sees:  PGDB_ADDR=… PGDB_HOST=… PGDB_PORT=…
```

The variable name is the app name upcased, non-alphanumerics → `_`
(`api-server` → `API_SERVER_ADDR`). Read those from the app's config rather
than hardcoding a host — ply computes the right value per mode.

Each address points at the dependency's **parent**, which balances across its
instances and drains them on deploy. So `web` keeps serving while `api`
rolls, and never learns an instance IP that can go stale.

`<app>.ply` hostnames also exist, but prefer the above: they are rootful-only
and each instance snapshots `/etc/hosts` at launch, so a roll leaves callers
holding dead IPs.

## TLS and the public edge

ply terminates no TLS and issues no certificates — that is Caddy's job. Point
Caddy at the app's **published address**, not its instance IPs:

```caddyfile
app.example.com {
	reverse_proxy 10.77.0.1:3000
}
```

Because the parent absorbs all pool churn, that line never changes on scale,
rolls or restarts. `ply proxy [APP]... [--format caddy|nginx|haproxy]` emits
it from live state.

Caddy can be an ordinary system service or a ply app itself. If it is a ply
app, its certificate directory **must** be a volume — Caddy stores certs
under `$XDG_DATA_HOME/caddy`, and on the instance's tmpfs every restart
re-issues until Let's Encrypt's 5-per-week duplicate limit locks the domain
out. See `references/edge-tls.md` for a working manifest and the ACME
gotchas.

## Deploying to a host

An image is one file, so deploying is copying it:

```sh
scp myapp-1.2.0-linux-x64.img root@host:/srv/myapp/
ssh root@host ply deploy /srv/myapp/myapp-1.2.0-linux-x64.img
```

`ply deploy` rolls instances one at a time, each gated by `[health]`, holding
the published listener across the roll — a failed gate aborts and reverts
that slot. For reboots, emit a unit:

```sh
ply systemd myapp.img --scale 4 --publish internal:3000 \
  | sudo tee /etc/systemd/system/ply-myapp.service
sudo systemctl enable --now ply-myapp
```

Rootless apps need a **user** unit instead — `ply systemd --user` — plus
`sudo loginctl enable-linger $USER`, or everything stops at logout and
nothing starts at boot.

## Using Docker images

`ply import docker://mongo:7 -o mongo.img` pulls an OCI image,
flattens it, and translates its config (entrypoint, env, ports, workdir,
user, stop signal) into a ply manifest. Mainstream images run unmodified.

Reach for it when the registry lacks something — check `ply run <name>`
(prebuilt services: postgres, redis, …) first. Prefer the native package
when it exists — `redis` imports at ~14 MiB fat versus ~3 MiB as a package
that shares its base with every other app on the box. Check first with
`ply search redis`.

Imported images are marked `capabilities = "oci"` so they get Docker's
default fourteen capabilities, because their entrypoints do
`chown … && exec gosu …`. **Packages you write should keep the default of
none** — a native package never needs them, since `[package] user` drops
privileges from the parent before rights stripping. Adding capabilities to
your own manifest is nearly always a sign something else is wrong.

## Debugging

```sh
ply ps                     # instances, IPs, ports, uptime, restarts
ply stats [APP]            # live CPU/memory/pids from cgroups
ply exec APP[.N] sh        # shell inside a running instance
ply check IMAGE            # validate an image
ply audit                  # shared volumes, deprecated runtimes
```

Common failures and what they actually mean are in
`references/troubleshooting.md` — read it before guessing, especially for
`EACCES` on mount (AppArmor), `EINVAL` on chown/setuid (rootless uid map),
and `Address in use` (a stray parent still holding the port).

## Operating a host (deployments, CD, diagnosis)

On a server, apps are DEPLOYMENT FILES: write
`/var/lib/ply/deployments/<name>.toml` naming a source (`app =` registry,
`github =` release assets, `repo =` build-on-host, `image =` local file)
and `ply reconcile` — inotify + a 1-minute timer — converges to it.
Read the verdict at `deployments/.status/<name>.status`, the history at
`/var/lib/ply/apps/events.log`, logs (dead builders included) at
`/run/ply/logs/<app>.<n>.log`. Scale/restart are files under
`<apps>/<app>/control/`. Touch the spec = deploy now; pin
`version =`/`ref =` = rollback. The full file map, the diagnose loop and
the cautions (atomic writes, fleet-managed hosts, secrets) are in
`references/operating.md` — read it before operating a host.

---

The sections below are the full references.


---

# ply CLI reference

`ply <command> --help` is always current; this is the map.

## Build and inspect

```sh
ply init [DIR] [-y]                  # write a starter ply.toml
ply build [DIR] [-o FILE]            # resolve deps → ply.lock + a .img
ply search QUERY [--versions]        # what the registry has
ply add NAME[@RANGE]                 # append a dependency to ply.toml
ply check IMAGE                      # validate, optionally against host policy
ply images                           # what is in the store
```

## Run and observe

```sh
ply run IMAGE [--scale N]
              [--publish [ADDR:]PORT[:INSTANCE_PORT]]   # repeatable
              [--after APP]... [--after-timeout 60s]
              [-e K=V]... [--env-file FILE]
              [--link HOST:CONTAINER]                   # dev bind mount
              [--privileged]                            # debugging only
ply ps [--json]
ply stats [APP|APP.N] [--json]
ply exec APP[.N] CMD...
```

`--publish` forms:

| form | binds |
|---|---|
| `8080` | `0.0.0.0:8080` |
| `80:3000` | host `:80` → instances' `:3000` |
| `internal:5432` | loopback rootless / bridge gateway rootful |
| `public:80` | `0.0.0.0`, said explicitly |
| `127.0.0.1:8080:3000` | exactly that address |

Repeating it gives each spec its own listener and pool. The **first** spec is
the app's canonical address — what `--after` hands to dependants and what
`ply proxy` emits — so adding a metrics port second cannot repoint callers.

`--after APP` waits for `APP`'s `[health]` gate, then injects `<APP>_ADDR`,
`<APP>_HOST` and `<APP>_PORT`. An explicit `[env]` or `-e` wins; an
unpublished dependency injects nothing.

## Lifecycle

```sh
ply deploy IMAGE [--timeout S]   # rolling, health-gated, reverts on failure
ply rebase IMAGE --runtime name@x.y.z   # swap a runtime without rebuilding
ply rm APP [--volumes]
ply gc                           # drop store entries nothing references
ply audit ; ply outdated
```

## Host integration

```sh
ply systemd IMAGE [--scale N] [--publish …]... [--after APP]... [--user]
ply proxy [APP]... [--format caddy|nginx|haproxy]
ply setup [--unprivileged-ports [PORT]]
ply sync                         # pre-fetch the host policy's packages
```

`ply systemd --user` emits a unit for `~/.config/systemd/user` — required for
rootless apps, since a system unit would run them as root. Pair it with
`sudo loginctl enable-linger $USER`.

## Ecosystem bridge

```sh
ply import docker://image:tag -o FILE   # OCI → fat ply image
ply bundle IMAGE -o FILE                # flatten a closure into one file
ply craft new|shell|changes|commit      # author a package interactively
```

## Conventions

- **Foreground by default** — backgrounding is systemd's job.
- **Versions are immutable** — there is no `:latest` to move; bump and rebuild.
- **Publishing is copying a file** — any file host works as a registry; the
  sha256 in `ply.lock` is the trust, not a login.
- Docker verbs ply deliberately lacks (`pull`, `push`, `tag`, `compose`,
  `logs`, `network`, …) answer with a one-line pointer to the ply way.


---

# The edge: TLS, Caddy, and certificates

ply terminates no TLS, issues no certificates and binds no `:443`. ACME, SNI
routing, h2/h3 and websocket upgrades are a decade of someone else's work.
The edge is Caddy (or nginx); ply's job is to say what the upstreams are.

## Point the proxy at the published address

```caddyfile
app.example.com {
	reverse_proxy 10.77.0.1:3000     # the ply parent, not an instance
}
```

The parent already balances the pool, skips unhealthy backends and drains on
deploy, so this line survives scale, rolls, crashes and restarts. Point Caddy
at instance IPs instead and its config must be regenerated on every one of
those events.

`10.77.0.1` is the bridge gateway — where a **rootful** `--publish internal:`
parent binds, reachable from inside any instance. Rootless it is `127.0.0.1`.

## Caddy as a ply app

Works, and makes the edge one more versioned artifact. Two things it needs:

```toml
[package]
name = "edge"
version = "0.1.0"
entrypoint = ["/bin/sh", "-c", "[ -f /etc/caddy/Caddyfile ] || cp /opt/edge/Caddyfile /etc/caddy/Caddyfile; exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile --watch"]
base = "alpine@3.20"

[dependencies]
caddy = "2"

[env]
HOME = "/tmp"
XDG_CONFIG_HOME = "/tmp"
XDG_DATA_HOME = "/data"    # NOT /tmp — see below

[ports]
http = 80                  # declaring <1024 is what earns CAP_NET_BIND_SERVICE
https = 443

[volumes]
config = { path = "/etc/caddy" }   # live Caddyfile; --watch hot-reloads it
data   = { path = "/data" }        # issued certificates — MUST persist
```

**The certificate volume is not optional.** Caddy stores certs under
`$XDG_DATA_HOME/caddy`. On the instance's tmpfs every restart loses them and
re-issues, and Let's Encrypt's duplicate-certificate limit (5 per week, no
appeal) then locks the domain out. This failure is invisible in staging and
permanent in production.

Run it holding both web ports so Caddy can do its own HTTP→HTTPS redirect and
ACME has an HTTP-01 fallback:

```sh
ply run edge.img --publish 80:80 --publish 443:443
```

## ACME gotchas

- **The domain must point at this host.** Behind Cloudflare's orange cloud,
  TLS-ALPN-01 cannot work at all and HTTP-01 validates against Cloudflare.
  Grey-cloud the record first, and confirm with `dig +short domain A`.
- **Prove the pipeline on staging.** A global block, which must come *first*
  in the Caddyfile, before any site block:
  ```caddyfile
  {
  	acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
  }
  ```
  Staging certs are untrusted by browsers but unlimited. Remove the block to
  issue for real — once.
- **Only `:443` published** means TLS-ALPN-01 only, with no fallback.
- **Verify a restart did not re-issue**: the expiry timestamp must be
  identical before and after. A changed one means the volume is not
  persisting, and every restart is spending quota.

## Rootless and privileged ports

Rootless shares the host netns, and `CAP_NET_BIND_SERVICE` inside a user
namespace does not authorize binding below 1024 out there. Rootless Docker
and Podman have the same limitation. Either bind above 1024 and let a
system-service edge own `:443`, or lower the floor host-wide:

```sh
sudo ply setup --unprivileged-ports
```

## System service instead

Choose an apt/dnf Caddy when TLS should keep working while ply is stopped
entirely: separate supervision, certs in `/var/lib/caddy`, and nothing to
configure beyond the emitted config.


---

# ply.toml reference

Only `[package]` is required.

## [package]

| key | notes |
|---|---|
| `name` | required; may not contain `-` followed by a digit (filename grammar) |
| `version` | required, semver; part of the image filename |
| `entrypoint` | argv, exec-style — no shell unless you ask for one. Absent = a library/runtime package, not an app |
| `include` | paths that ship. **Absent packs everything**, which usually drags in `node_modules`, `.git`, build caches |
| `base` | `"alpine@3.20"` or `{ name, version, source }`. Exactly one package per graph owns `/`. In a base package's own manifest, `base = true` |
| `user` | `"name:uid:gid"` — ply writes passwd/group, chowns volumes, and drops privileges in the right order |
| `workdir` | absolute cwd before exec. Default: the app's prefix (`/opt/<name>`) |
| `stop_signal` | default `SIGTERM`. nginx wants `SIGQUIT`, httpd `SIGWINCH` |
| `capabilities` | default none. `"oci"` = Docker's fourteen (what `ply import` sets), or an explicit list like `["chown"]` |
| `provides_abi` | for runtime packages, e.g. `"linux-x64-musl"` |
| `isolation` | `"ns"` (default) |

## [dependencies]

The key IS the package name. String = a version range against the `default`
source; table = `{ source = "alias", version = "6.1" }`.

Ranges: `"22"` = any 22.x.y, `"6.1"` = any 6.1.x, `"1.2.3"` = exactly that.
Resolution is Minimal Version Selection — the **lowest** version satisfying
all constraints wins, so builds don't drift. Names containing a dot must be
quoted (`"boost1.84" = "1.84"`).

## [env]

Composed after package contributions, before `-e` / `--env-file`. Last wins.

## [ports]

Labels of what the app binds internally. `ply proxy` falls back to them for
an unpublished app and `[health]` checks them. **Never a host claim** — that
is `--publish`, deliberately a run-time decision.

A declared port below 1024 causes ply to keep `CAP_NET_BIND_SERVICE`, so an
edge can bind `:80`/`:443` without extra configuration.

## [volumes]

```toml
data   = { path = "/var/lib/myapp" }                     # per-instance (default)
shared = { path = "/srv/uploads", scope = "shared" }     # explicit opt-in
cache  = { path = "/var/cache/myapp", ephemeral = true } # GC-able
```

Per-instance is the default so scaling can never silently corrupt
single-writer state. Plain host directories underneath.

## [resources]

cgroup v2 limits: `mem = "512M"`, `cpu = "1.5"`, `pids = 256`. `pids` is set
even when omitted, so a fork bomb is contained with zero configuration.

## [health]

`port` = a TCP connect gate for deploys and restarts; `grace` = the
cold-start budget. Without `[health]`, an instance only has to survive.

## [restart]

`policy` = `"never"` (default) | `"on-failure"` | `"always"`; `backoff`
doubles per consecutive failure up to `max_backoff`, resetting after healthy
uptime.

## [requires]

`abi = "linux-x64-musl"` — what the app layer's native artifacts were built
against. The resolver refuses a mismatched runtime loudly instead of letting
it segfault later.

## [sources]

URL templates. `{package}` expands to the package name, so one base URL can
serve per-package directories. `default` applies to deps without an explicit
source; other keys are aliases usable as `source = "<alias>"`.


---

# Operating a ply host

Everything is a file. You operate a ply host by reading and writing files
at stable paths — usually over ssh as root. There is no API server, no
token, no SDK. Declare desired state; `ply reconcile` (systemd inotify +
a 1-minute timer) converges reality to it; read the outcome back.

## The file map

Rootful paths (servers). Rootless dev boxes: state/logs under
`$XDG_RUNTIME_DIR/ply/`, apps under `~/.local/share/ply/apps/`.

| path | what | you |
|---|---|---|
| `/var/lib/ply/deployments/<name>.toml` | a deployment (desired state) | write |
| `/var/lib/ply/deployments/.status/<name>.status` | last reconcile verdict, one JSON line `{ok,detail,ts}` | read |
| `/var/lib/ply/deployments/.status/fleet.json` | GitOps sync state (fleet hosts) | read |
| `/var/lib/ply/apps/events.log` | journal: deploys, scales, restarts, crash respawns (JSON lines) | read / `tail -f` |
| `/run/ply/logs/<app>.<n>.log` (+ `.1` rotation) | instance stdout ring — survives the instance | read |
| `/var/lib/ply/apps/<app>/control/scale` | write a number 1..100 | write |
| `/var/lib/ply/apps/<app>/control/restart` | rolling restart (content ignored) | write |
| `/var/lib/ply/apps/<app>/control/last-result` | command outcome, JSON | read |
| `/var/lib/ply/deployments/.keys/` | tokens & deploy keys (0600, root) | write once |

`ply ps --json` lists instances machine-readably. `ply exec <app> sh`
opens a shell inside an instance.

## Deploying: write one file

Exactly one source per spec: `app =` (registry), `image =` (local file),
`github =` (release assets; add `tag_prefix = "web-v"` for monorepo
streams), `repo =` (clone + build on this host). Write atomically
(temp file + `mv`) or with a single redirect:

```sh
cat > /var/lib/ply/deployments/api.toml <<'EOF'
repo = "https://github.com/org/api"
build = "npm ci && npm run build"
runtime = "node@24"
entrypoint = ["node", "dist/index.js"]
port = 3000
publish = ["internal:3000"]
domain = ["api.example.com"]
EOF
```

Then poll `.status/api.status` — expect `building @ <commit>…` then
`deployed`/`rolled …`, or a failure with the reason. Do not retry in a
loop yourself: reconcile re-runs every minute and backs failed builds off
for 10 minutes. The file's mtime is intent: `touch` = deploy now (works
even with `auto = false`); editing = converge to the edit.

## The diagnose loop

1. `cat .status/<name>.status` — the verdict, verbatim.
2. `tail -50 /var/lib/ply/apps/events.log` — what led here (deploy-failed,
   crash respawns with restart counts).
3. For build failures: `cat /run/ply/logs/<name>-builder.1.log` — the
   builder is a real app and its ring **outlives it**; the compiler error
   is in there.
4. For runtime crashes: the app's own ring + `ply ps` (a `*` on status
   means the supervisor predates the installed binary — restart the unit).
5. Fix the SPEC (or the code), never the generated systemd unit — units
   headed `managed by ply reconcile` are overwritten on every converge.

Rollback = pin the spec: `version = "1.4.2"` (registry/github lanes) or
`ref = "<commit>"` (repo lane). Remove the pin to follow latest again.

## Cautions

- Secrets never go in the spec if avoidable: use `env_file = "/root/x.env"`
  or `token_file = ".keys/<name>.token"` (relative = under the
  deployments dir; you create the key file, 0600).
- One deployment per app name — two specs resolving to the same inner app
  name will be refused.
- Never write into `.status/` (reconcile owns it) and never create scratch
  files in the deployments dir root — the directory is inotify-watched and
  every file event triggers a reconcile run.
- On a GitOps fleet host (`.status/fleet.json` exists): git owns the specs
  it introduced — edit the infra repo (or open a PR), not the synced file;
  your direct edit is overwritten on the next beat. Locally-created specs
  coexist and stay yours.
- `grant_links = true` is required by apps whose manifest `[requests]`
  links (the dashboard, notify) — without it they run blind, not broken.


---

# Troubleshooting

Read the errno, not the message — ply surfaces the kernel's answer, and the
errno usually names the cause exactly.

## `mount rprivate at /: EACCES: Permission denied`

Rootless on a kernel that restricts unprivileged user namespaces (Ubuntu
24.04+). ply needs an AppArmor profile — the same requirement Docker and
Chrome have.

```sh
sudo ply setup
```

If you already ran it, the profile names a **specific binary path**: `which
ply` must match the path in `/etc/apparmor.d/ply`. Running a freshly built
binary from `target/` will fail this way even though the installed one works.

## `chown: …: Invalid argument` / `setuid: Invalid argument` (EINVAL)

Rootless, and the uid does not exist inside the user namespace. By default a
userns maps exactly one id — root inside is you outside — so anything
switching to a service uid fails. Breaks `[package] user` and every imported
image that runs `gosu`.

```sh
sudo apt install uidmap     # newuidmap / newgidmap
sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 $USER
ply setup                   # reports whether both are now in place
```

Note the errno: **EINVAL means unmapped uid; EPERM means a missing
capability.** They look alike and have different fixes.

## `chown: …: Operation not permitted` (EPERM)

A capability was dropped. ply's default is zero capabilities. An imported
image should carry `capabilities = "oci"` — check the embedded manifest. For
your own package, this almost always means the app is doing work that
`[package] user` should do from the parent instead.

`ply run --privileged` confirms the diagnosis by skipping rights stripping.
It is for triage, never for running.

## `cannot bind 0.0.0.0:80: Address in use`

Something already holds the port. A backgrounded `ply run` parent survives
until killed, and a systemd unit may not have stopped cleanly:

```sh
ss -ltnp | grep -E ':80\s'          # names the owner
systemctl stop ply-<app>
pkill -TERM -f 'ply run'            # SIGTERM, so layers unmount cleanly
```

## `bind() to 0.0.0.0:80 failed (13: Permission denied)` from inside an app

Rootless cannot bind below 1024 — see `edge-tls.md`. Not a ply bug; rootless
Docker behaves identically.

## `expected PORT or HOST_PORT:INSTANCE_PORT`

The `ply` on that host predates the `[ADDR:]` grammar. Check with
`ply run --help | grep ADDR` and install a current build.

## An app cannot find its dependency

Check the dependency is actually published — `--after` injects nothing for an
unpublished app, by design, rather than inventing an address that fails
further away:

```sh
ply ps                              # is it running?
ss -ltnp | grep <port>              # did the parent bind?
```

Then confirm the app reads `<DEP>_ADDR` / `<DEP>_HOST` / `<DEP>_PORT` rather
than a hardcoded host.

## Rolling deploy hangs

A `[health]` gate is not passing. `ply ps` shows the stuck slot. The gate is a
TCP connect to `[health] port` within `grace` — a slow cold start needs a
bigger `grace`, not a removed gate.

## `ply proxy` refuses for a rootless app

Rootless instances share the host network and all report `127.0.0.1`, so
there is no per-instance address to emit. Publish the pool and the parent
becomes the single stable backend:

```sh
ply run app.img --publish internal:3000 --scale N
```

## The image is enormous

`include` is probably unset, so everything in the directory shipped —
`node_modules`, `.git`, build caches. Set it to just what runs. Check with
`ply check IMAGE`, and remember an imported Docker image is fat by nature
(a flattened snapshot, not a composition).
