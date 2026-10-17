# Tailscale for COGNIX[WS]

Reach COGNIX[WS] over your [Tailscale](https://tailscale.com) network at this
computer's MagicDNS name, with a certificate the phone already trusts. The
phone needs the Tailscale app and the same Tailscale account; every device
still pairs with a code.

An official tunnel extension (ADR-0349 in the COGNIX[WS] repository). It needs
COGNIX[WS] with extension manifest apiVersion 7 and the `tunnel:certificate`
door, Node.js 22 or newer, and Tailscale installed and signed in on the
computer that runs COGNIX[WS].

## What it does

- Every minute it reads `tailscale status --json` and reports one state with
  one next action: not installed, sign in, stopped, MagicDNS missing,
  connected.
- When the node runs, it keeps a certificate for the node's MagicDNS name
  with `tailscale cert`, renewing it in its last 30 days, and hands it to
  COGNIX[WS], which serves it to anyone asking for that name.
- It never joins a network, changes DNS settings or asks for elevated
  permissions. If Tailscale refuses the certificate, it says so: enable
  HTTPS certificates in the Tailscale admin console, or allow your user with
  `sudo tailscale set --operator=$USER` once.

The certificate is machine-bound and not part of backups; a restored
computer issues it again.

## Not yet

Funnel (reach without the app) and a custom login server (Headscale) are
planned for a later version.

## Develop

```sh
node --test test/*.test.mjs
```

No dependencies. License: Apache-2.0.
