# Updating codebase-memory-mcp on the Windows machine

Local note. Not upstream documentation. It covers the private Forgejo build
chain at forgejo.richter-home.org and the one Windows machine that runs it.

## What the update actually is

Claude Code launches the server from one fixed path:

```
C:\Users\jrichter\AppData\Local\Programs\cbm\codebase-memory-mcp.exe
```

To update, replace that one file. The MCP entry in `%USERPROFILE%\.claude.json`
never changes, so nothing needs registering again. Close Claude Code, swap the
file, reopen Claude Code.

## The stored entry, and why it holds two paths

```
codebase-memory-mcp:
  Scope: User config
  Type: stdio
  Command: C:\Users\jrichter\AppData\Local\Programs\cbm\codebase-memory-mcp.exe
  Environment:
    CBM_RUNTIME_DIR=C:\cbm-runtime
    CBM_CACHE_DIR=C:\cbm-cache
```

Both variables are required. The installer writes an entry with no `env` block
at all, which is why the first registration connected and then failed. Measured
on 2026-08-28: with both variables removed, a plain `initialize` request over
stdin exits 1 and prints

```
codebase-memory-mcp: exact executable identity could not be verified (cache-canonicalize)
```

With both set, the same request exits 0 and returns a full `initialize` reply.
One change, two runs, opposite results.

The one-shot CLI path needs them too, and fails differently without them:

```
secure CLI coordination could not be created (endpoint): C:\Users\jrichter:
DACL entry 4 grants mutation rights 0x000d0152 to untrusted identity
(other S-1-5-21-4031420928-2026310725-2693769858-1003)
```

`C:\cbm-runtime` and `C:\cbm-cache` exist to route around that check. Both were
locked down with `icacls /inheritance:r`. Set both variables by hand in any
shell that calls the CLI directly — Claude Code does not need that, because the
entry carries them.

## Where a new build comes from

Push to `CaptainMittens/codebase-memory-mcp` on forgejo.richter-home.org.
Forgejo Actions cross-compiles with mingw-w64 and replaces the `windows-latest`
release. The tag is replaced by every build, so the download URL stays the same
while the file behind it changes.

## The update command

Paste a live Forgejo token in at the front and run it in PowerShell.

```powershell
$t='PUT-YOUR-TOKEN-HERE'; $u='https://forgejo.richter-home.org/CaptainMittens/codebase-memory-mcp/releases/download/windows-latest'; $h=@{Authorization="token $t"}; $dst="$env:LOCALAPPDATA\Programs\cbm\codebase-memory-mcp.exe"; if (Get-Process -Name codebase-memory-mcp -ErrorAction SilentlyContinue) { "STOP: close Claude Code first, then run this again" } else { $tmp=Join-Path $env:TEMP 'cbm-new.exe'; Invoke-WebRequest "$u/codebase-memory-mcp.exe" -Headers $h -OutFile $tmp; $fb=[IO.File]::ReadAllBytes($tmp); if ($fb[0] -ne 77 -or $fb[1] -ne 90) { "STOP: that is not an exe - $($fb.Length) bytes, probably a login page" } else { $want=((Invoke-WebRequest "$u/codebase-memory-mcp.exe.sha256" -Headers $h).Content -split '\s+')[0]; $got=(Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower(); if ($want -ne $got) { "STOP: hash mismatch"; "want $want"; "got  $got" } else { Copy-Item $dst "$dst.bak" -Force; Copy-Item $tmp $dst -Force; "updated ok, sha256 $got"; & $dst --version } } }
```

It stops at the first thing that looks wrong:

| Step | What it guards against |
|:--|:--|
| Process check | Windows locks a running `.exe`, so the copy fails |
| `MZ` byte check | Cloudflare Access answers a bad token with a 302 and saves an HTML login page under the `.exe` name |
| SHA-256 against the `.sha256` asset | A truncated or wrong download |
| `.bak` copy | Getting the previous build back |

The `MZ` check is there because the login-page trap already happened once, on
2026-08-27, when `check-cbm.ps1` was downloaded and turned out to be HTML.

## Checking it worked

Reopen Claude Code and run `/mcp`. The row should read

```
codebase-memory-mcp: C:\Users\jrichter\AppData\Local\Programs\cbm\codebase-memory-mcp.exe - Connected
```

To see the stored entry rather than the connection state:

```powershell
claude mcp get codebase-memory-mcp
```

That reads the same file Claude Code reads at startup, so it says what will
launch — not what you believe you registered.

## Re-registering, if the entry is ever lost

```powershell
$exe="$env:LOCALAPPDATA\Programs\cbm\codebase-memory-mcp.exe"; claude mcp remove codebase-memory-mcp -s user 2>$null; claude mcp add codebase-memory-mcp -s user -e CBM_RUNTIME_DIR=C:\cbm-runtime -e CBM_CACHE_DIR=C:\cbm-cache -- $exe
```

Use `claude mcp add` rather than editing `.claude.json` by hand. That file also
holds large per-project history arrays, and a PowerShell `ConvertTo-Json` round
trip truncates them at its default depth.

## Loose end

`check-cbm.ps1` still carries a SHA-256 written into the script, so it goes
stale on every build. It should read the `.sha256` asset beside the exe the way
the update command above does.

## Git and the API reach Forgejo by two different routes

Cloudflare Access sits in front of `forgejo.richter-home.org`. It treats git
traffic and API traffic differently, and the difference is not obvious.

| What you are doing | How it gets there |
|:--|:--|
| `git clone`, `git fetch`, `git push` | Straight through Cloudflare. Nothing special needed. |
| Any `/api/v1/` call | Blocked by Access. Add `--resolve forgejo.richter-home.org:443:192.168.1.168` to send it to the LAN address instead. |

An API call without `--resolve` does not fail loudly. Access answers with an
HTML login page and a 200, so a script that pipes the body into `jq` reports a
parse error rather than an access problem. Read the first bytes of the body if
a call returns something that is not JSON.

### The credential helper

`~/.local/bin/git-credential-forgejo` reads the API token out of Proton Pass
every time git asks for it. No token is written to `.git/config`, to a remote
URL, or to shell history. The repository turns it on with two settings:

```
git config credential.https://forgejo.richter-home.org.helper forgejo
git config credential.https://forgejo.richter-home.org.username CaptainMittens
```

The token itself lives on the `forgejo.richter-home.org` item in the Proton Pass
`Home Server` vault, in a field named `api`. Replace the token there and every
repository picks up the new one with no further edits.

### There is no git over SSH

Checked on 2026-08-28 on the server itself. The Forgejo container publishes no
ports at all — `docker port forgejo` prints nothing, and Caddy reverse-proxies
its HTTP. The host has no `git` user either.

So `ssh git@192.168.1.168` answers `Permission denied (publickey)` no matter
what key you hold. That reply is the host's own sshd refusing an unknown
username, not Forgejo rejecting a key. Registering an SSH key on the Forgejo
account does nothing while the container has no SSH listener.

Use HTTPS. It works, and it is the only route that does.
