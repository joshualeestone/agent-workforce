# Remote Access for a Self-Hosted Agent Console

**Decision document.** How to give a non-technical owner secure access, from anywhere, to a web app running on their always-on Mac at home, with essentially zero configuration on their part.

Researched 2026-08-06. Sources cited inline. Claims are tagged **[verified]** (read from a primary source: vendor docs, source code, terms of service), **[secondary]** (reported by a credible third party, not confirmed at the primary source), or **[inference]** (my reasoning, not a sourced fact).

---

## 0. The finding that shapes everything else

Every comparable consumer product that achieves zero-config remote access does it by routing through infrastructure the vendor operates. Home Assistant, Plex, Synology, and Ubiquiti all converge on the same shape: the device holds an **outbound** connection to a vendor relay, and the vendor hands the owner a stable hostname. I found no counterexample in this product category.

There is a second finding that makes the first one survivable, and it comes from the closest analogue we have. Nabu Casa's relay is **end-to-end encrypted and open source**, and the relay operator provably cannot read the traffic it carries (Section 1.1). So "we run infrastructure" and "their data never leaves their machine in readable form" are not mutually exclusive. That distinction is the entire recommendation.

A third finding constrains the design harder than expected: **if the UI is a browser, you cannot avoid a stable public hostname.** Passkeys/WebAuthn bind to a domain [verified], HTTPS needs a cert for a name someone owns, and browsers cannot speak peer-to-peer protocols like iroh. Peer-to-peer with hole punching is genuinely excellent, and it does not help a v1 whose client is a browser tab. See Section 2.3.

---

## 1. Prior art

### 1.1 Home Assistant / Nabu Casa Cloud (the closest analogue)

This is the one to copy. Open-source self-hosted app, free forever, with an optional paid cloud subscription whose headline feature is remote access.

**Mechanism [verified].** Nabu Casa's tunnel is open source: [`NabuCasa/snitun`](https://github.com/NabuCasa/snitun). It combines an SNI proxy with a TCP multiplexer. The flow:

1. The instance authenticates to a "session master" and receives a Fernet token containing its config and encryption keys.
2. It presents that token to the SniTun server, passes a challenge-response, and enters multiplexer mode, holding one outbound encrypted channel.
3. A browser connects to `<id>.ui.nabu.casa` over TLS. The SniTun server reads the **SNI field of the TLS handshake** to decide which instance the connection belongs to, and forwards the still-encrypted bytes down the multiplexed channel.
4. The instance terminates TLS locally and speaks to Home Assistant.

**Can the operator read the traffic? No [verified].** The SniTun README states the server only decrypts the Fernet token for validation and routing; the payload stays TLS-encrypted end to end between browser and instance. Nabu Casa's own docs describe the proxy as operating "at the TCP level" and routing by SNI, which is consistent: routing on SNI is precisely the technique that lets you multiplex TLS without terminating it ([Nabu Casa remote access deep dive](https://support.nabucasa.com/hc/en-us/articles/25619268678557-Remote-access-Deep-dive), summarised via search; the page itself 403s to automated fetches, so I am leaning on the source code as the stronger primary).

**User effort [verified].** Log in to Home Assistant Cloud in the HA UI, then flip one toggle under Remote access. Cert generation takes up to 60 seconds on first enable, then the UI shows the URL. Nothing on the router. ([Enabling remote access](https://support.nabucasa.com/hc/en-us/articles/26474279202973-Enabling-remote-access-to-Home-Assistant), via search summary.)

**Auth model [inference, high confidence].** The relay does not authenticate users. It routes bytes. All authentication is Home Assistant's own login, running on the user's box. A relay compromise therefore does not yield account access. This is the property we want.

**Cost [verified].** $6.50/mo or $65/yr US; €7.50/mo or €75/yr EU (VAT incl.); £6.50/£65 UK; CA$8.70/CA$87. 31-day trial, no permanent free tier. No bandwidth cap or fair-use limit is published. ([nabucasa.com/pricing](https://www.nabucasa.com/pricing/))

**Why it is priced that way [verified].** Nabu Casa funds Home Assistant development. It is subscriber-funded and has publicly committed to not raising from investors ([Thinking Big](https://www.home-assistant.io/blog/2018/09/17/thinking-big/)). Remote access is deliberately the thing worth paying for, because it is the thing that costs money to provide. Employees working on Foundation projects now sit under the Open Home Foundation.

**Failure modes.** The URL only works while the instance holds its outbound connection; if the Mac is off or offline, the hostname is dead [verified, from the enabling-remote-access docs]. The vendor is a hard dependency for reachability, though not for the software working locally.

### 1.2 Plex

**Mechanism [verified].** Two paths. Preferred: direct connection via port forwarding, LAN port fixed at TCP 32400, WAN port user-chosen; Plex attempts automatic mapping and falls back to asking the user. Fallback: **Plex Relay**, where the server holds a secure outbound connection to a Plex relay and the client connects to the same relay ([Plex support](https://support.plex.tv/articles/216766168-accessing-a-server-through-relay/), read via search summary; the page 403s automated fetches).

**Cost and the cautionary tale [secondary].** Relay is bandwidth-capped, reported at 1 Mbps for free users and 2 Mbps for subscribers. More importantly, Plex moved remote playback of personal video behind a subscription entirely as of 29 April 2025 (Plex Pass $6.99/mo or $69.99/yr; Remote Watch Pass $1.99/mo per viewer), and began enforcing on TV apps from late 2025 into 2026 ([Plex 2025 updates](https://www.plex.tv/blog/important-2025-plex-updates/), [Privacy Guides](https://www.privacyguides.org/news/2025/11/26/plex-begins-enforcing-new-restrictions-on-free-remote-streaming-this-week/)). I could not confirm the exact current Mbps numbers at a primary source.

**The lesson.** Plex's free relay era ended because the relay carried **media bytes**. Relay economics are decided by what flows through the relay, not by how many users you have. Our app is a control plane: JSON, log lines, small UI payloads. That difference is the reason the recommendation in Section 3 is affordable and Plex's was not.

### 1.3 Synology QuickConnect

**Mechanism [verified, from Synology KB].** A connection cascade: try LAN, then WAN, then **hole punching**, and only if all fail, fall back to Synology's relay service. The client asks a QuickConnect coordination server, which signals the NAS to open a tunnel to a relay server. ([Synology QuickConnect White Paper](https://kb.synology.com/en-nz/WP/Synology_QuickConnect_White_Paper/4))

**Security [secondary].** Synology states SSL/TLS end to end between client and NAS, with Synology unable to decrypt relayed traffic. I could not verify this at the primary source: the KB page renders as navigation chrome only to an automated fetch, and the white paper PDF would not parse. Treat the specific claim as vendor-asserted, unverified by me.

**Cost.** Free, included with the hardware. Relay is explicitly slower. Synology absorbs the cost as a hardware differentiator, which is a model unavailable to us.

**Worth stealing:** the cascade. Try the cheap paths first, relay last. This directly reduces relay cost.

### 1.4 Ubiquiti / UniFi

**Mechanism [secondary].** Console links to a Ubiquiti cloud account; the owner reaches it at `unifi.ui.com` in a browser. Ubiquiti describes it as encrypted cloud access; the relay/tunnel internals are not documented publicly in what I could reach ([Ubiquiti help centre](https://help.ui.com/hc/en-us/articles/115012240067-UniFi-How-to-Enable-Cloud-Access-for-Remote-Management)).

**Cost.** Free with the hardware. Same subsidy model as Synology.

**Security note worth carrying:** unlike Nabu Casa, the UniFi model puts the *identity* in the vendor's cloud account, so the vendor's account system is in the trust path for device control. That is the design we should not copy.

### 1.5 Tailscale (and Funnel)

**Mechanism [verified].** WireGuard mesh. Every connection begins via a DERP relay and upgrades to direct P2P where NAT traversal succeeds ([How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works), [Connection types](https://tailscale.com/docs/reference/connection-types)). **Funnel** exposes a node's service to the public internet on a `*.ts.net` name.

**Plans [verified].** Personal is free forever: up to 6 users, unlimited user devices, 50 tagged resources, 3 ACL groups ([tailscale.com/pricing](https://tailscale.com/pricing)). Funnel is **"available for all plans"** and is still **beta** ([Funnel docs](https://tailscale.com/docs/features/tailscale-funnel)). Note: several SEO aggregator sites claim Funnel requires a paid tier; the primary docs contradict them, and I am going with the primary docs.

**Funnel limits [verified as existing, unverified as values].** Ports 443, 8443, 10000 only. TLS only. "Non-configurable bandwidth limits" that Tailscale **does not publish**. Requires MagicDNS, HTTPS certs, a `funnel` node attribute in the tailnet policy file, and CLI invocation.

**Why it fails our brief.** For non-Funnel use, every client device needs Tailscale installed and an account joined to the tailnet. That is comprehensively past our audience's ceiling. Funnel avoids the client install, but then the service is on the public internet with **no auth from Tailscale at all**, so we own 100% of the security anyway, on top of an undocumented bandwidth cap and a beta label. Also: the setup is CLI plus a policy-file edit, which is not a thing our user will ever do.

### 1.6 Cloudflare Tunnel

**Mechanism [verified].** `cloudflared` makes **outbound-only** connections to Cloudflare's edge; traffic then flows bidirectionally over the tunnel. No inbound ports, no public IP needed ([Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)).

**Cost [secondary].** Widely reported as free for any traffic volume, with limits of 1000 tunnels per account and 100 active connections per tunnel. I could not find a primary Cloudflare page stating "Tunnel is free with no bandwidth limit," so treat the "unlimited bandwidth" part as community claim. Cloudflare Zero Trust / Access is **free for up to 50 users** [secondary], $7/user/mo beyond that.

**Two blockers, and the second is serious.**

1. A named (persistent) tunnel requires a Cloudflare account and a domain in Cloudflare DNS. Not zero-config if the user must do it. **Quick Tunnels** (`trycloudflare.com`) need neither account nor domain, but are **explicitly not supported for production**, get a **random non-persistent subdomain**, cap at **200 in-flight requests**, and **do not support Server-Sent Events** [verified, [TryCloudflare docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)]. No SSE is close to disqualifying on its own for a live agent-status UI.
2. If *we* hold the account and provision per-user subdomains via API, we are exposed on the terms. Cloudflare's Zero Trust service-specific terms state, verbatim: **"You shall not resell Cloudflare Zero Trust to any third parties (e.g., in an ASP, managed security services, outsourcing, time-sharing or service bureau relationship) unless expressly permitted by Cloudflare in writing."** Violation is a material breach subject to immediate termination [verified, [Service-Specific Terms](https://www.cloudflare.com/service-specific-terms-zero-trust-services/)]. There is a sanctioned path (the [Tenant API](https://developers.cloudflare.com/tenant/get-started/) and the partner programme), but it is a written-agreement path, not something you quietly build on.

**Assessment.** Technically the best free managed tunnel available. Building our product's core availability on it, multi-tenant, without a signed agreement, is a business risk with a single-point-of-failure kill switch attached.

### 1.7 ngrok

**Cost [secondary].** Free: 1 GB/mo, 1 endpoint, random URL, 2-hour sessions, plus a browser interstitial page on all HTML traffic. Personal $8/mo for a persistent domain and 5 GB. Pro $20/mo, 15 GB. Custom domains moved to $0.01/hr active-only billing from 29 June 2026 ([ngrok pricing blog](https://ngrok.com/blog/pricing-june-2026), [free plan limits](https://ngrok.com/docs/pricing-limits/free-plan-limits)).

**Assessment.** Per-user paid tier plus a per-account model. Wrong shape for a consumer product distributed to many owners. Rule out.

### 1.8 Comparison table

| Product | Mechanism | User effort | Security model | Cost / who pays | Key failure mode |
|---|---|---|---|---|---|
| **Nabu Casa** (HA) | Outbound multiplexed tunnel; **SNI-routed** TCP proxy, TLS never terminated at relay [verified] | **One toggle** after cloud login [verified] | E2E TLS; relay cannot read payload [verified]; all authn is the local app's own | $6.50/mo, $65/yr; user pays; funds the OSS project | Relay outage or Mac offline kills the URL |
| **Plex** | Port-forward direct, else outbound relay | Port forwarding is manual and often fails; relay is automatic | TLS; relay is a byte pipe | Relay capped ~1 Mbps free / ~2 Mbps paid [secondary]; remote video now needs a subscription | Free relay economics collapsed under media bytes |
| **Synology QuickConnect** | Cascade: LAN → WAN → **hole punch** → relay [verified] | Register a QuickConnect ID; no router config | TLS claimed E2E; Synology says it cannot decrypt [secondary, unverified] | Free, subsidised by hardware | Relay path is slow; vendor dependency |
| **UniFi** | Console ↔ Ubiquiti cloud, browser at `unifi.ui.com` | Create a UI account, enable remote access | Vendor cloud account sits **in the control path** [secondary] | Free, subsidised by hardware | Vendor account compromise reaches the device |
| **Tailscale** | WireGuard mesh, DERP relay + hole punch [verified] | **Install + account on every client** | Strong: WireGuard, device identity, ACLs | Free for 6 users, unlimited devices [verified] | Client install is past our audience's ceiling |
| **Tailscale Funnel** | Public ingress to a `*.ts.net` name [verified] | CLI + policy-file edit; no client install for viewers | **None from Tailscale.** Service is public; auth is 100% yours | Free on all plans, **beta** [verified] | Undisclosed bandwidth cap; beta; public exposure |
| **Cloudflare Tunnel** | `cloudflared` outbound-only [verified] | Account + domain (named), or nothing (Quick Tunnel) | Optional Cloudflare Access; **TLS terminates at Cloudflare** | Free [secondary]; Access free ≤50 users [secondary] | **Reselling prohibited without written permission** [verified]; Quick Tunnels have no SSE, 200 req cap, not for production [verified] |
| **ngrok** | Outbound agent to ngrok edge | Account + token | Optional edge auth; TLS terminates at ngrok | Free 1 GB/random URL; $8/mo for persistent domain | Per-account pricing does not fit consumer distribution |
| **iroh** | QUIC P2P by public key, relay fallback [verified] | Library, not a product | **E2E via QUIC + TLS 1.3; relay cannot read** [verified] | Public relays free but rate-limited, dev/test only [verified]; self-host or paid dedicated | **Browsers cannot speak it** |
| **zrok / OpenZiti** | Zero-trust overlay, self-hostable | Technical | E2E; relays cannot decrypt [secondary] | OSS, self-host | Operationally heavy; wrong audience |
| **Pangolin** | Self-hosted tunneled reverse proxy over WireGuard | Technical (you run the server) | Built-in identity + access control [secondary] | OSS, you host | It is a thing we would operate, i.e. same cost shape as building our own |

---

### 1.9 ADDENDUM — the `plex.direct` trick, and exactly what it solves `[added after review]`

Missed on the first pass and worth its own entry, because it changes the design for one case.

**The mechanism.** A browser will not show a padlock for `https://192.168.1.7`, and no CA will issue a certificate for a private IP. Plex sidesteps this by **encoding the IP in the hostname**: `192-168-1-7.<hash>.plex.direct` resolves, in public DNS, to `192.168.1.7`. They hold a wildcard certificate for `*.<hash>.plex.direct`. **Real hostname, real certificate, private destination, zero setup by the user.**

**⚠️ What it solves, precisely — and what it does not.** It solves the **certificate** problem for a connection that can already be made. It does **not** solve **reachability**: Plex's own direct path still depends on port forwarding or automatic port mapping, with the relay as fallback (§1.2).

**So it is not "the relay becomes optional".** It is:

| Case | With this trick |
|---|---|
| **Same network** (laptop in the next room, phone on home wifi) | **Fully solved, free, no relay.** Real HTTPS, so passkeys work |
| **Remote** (airport, cellular) | **Unchanged** — still needs the relay |

**Why this matters more than it first appears.** §0 established that a browser client makes a stable public hostname unavoidable, because **passkeys bind to a domain and HTTPS needs a real certificate**. This trick supplies exactly that for the local case. So the same-network path gets the *full* security model — real TLS, real passkeys — rather than a degraded one, and costs us nothing but a DNS zone we already need.

Given the owner's always-on Mac is usually in their own house, **this is likely the majority of day-to-day use**, with the relay carrying the genuinely-remote minority. That materially improves the cost shape in §3.3.

## 2. Technical options, honestly

### 2.1 Port forwarding and automatic port mapping (UPnP / NAT-PMP / PCP)

**Verdict: dead as a primary strategy.** Keep at most as an opportunistic optimisation, and probably not even that.

- UPnP is widely recommended to be **disabled**, and is disabled by default on a meaningful share of consumer routers. Security guidance from vendors and national agencies is consistently "turn it off" ([Canadian Centre for Cyber Security](https://www.cyber.gc.ca/en/guidance/universal-plug-play-itsap00008), [UpGuard](https://www.upguard.com/blog/what-is-upnp)) [secondary, but the consensus is unambiguous].
- NAT-PMP was superseded by **PCP** (RFC 6887, 2013); support across consumer routers is inconsistent [verified for the supersession, [RFC 6886](https://datatracker.ietf.org/doc/html/rfc6886)].
- **CGNAT is the killer.** Where the ISP puts the customer behind carrier-grade NAT, there is no port to forward at all, at any price. IPv4 exhaustion since 2011 makes CGNAT the default growth path for ISPs, and it is standard on mobile networks worldwide [secondary, well-established].

Even where it works, we would be asking an app to punch a hole in a non-technical person's home firewall, pointed at a service that controls agents with file access. Reputationally that is indefensible even when technically sound.

**What I could not determine:** the actual 2026 success rate of automatic port mapping on US consumer routers. I found no credible current measurement study.

### 2.2 NAT traversal / hole punching (STUN, and when TURN is unavoidable)

**Mechanism [verified].** STUN tells a peer what public `ip:port` the world sees. Where both NATs are "easy" (endpoint-independent mapping), a simultaneous-open hole punch works. Where a NAT is "hard" (endpoint-dependent mapping, formerly "symmetric"), you fall back to birthday-paradox probing: Tailscale documents ~50% success in under 2 seconds with 174 probes, and 99.9% by 2048 probes at 100 packets/sec. **Two hard NATs is effectively hopeless: ~0.01% after 20 seconds** ([Tailscale, How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)).

**What fraction needs the paid relay path?**

- Tailscale's blog author estimates you can get direct connections "over 90% of the time" with these techniques [verified as an estimate, not as measured data; the post gives no empirical figures].
- Community reporting attributes "well north of 90%" to Tailscale's internal metrics [secondary, I could not confirm at a Tailscale primary source].
- iroh reports **~90% hole-punch success** [secondary, reported in coverage of the 1.0 release].
- Consumer WebRTC deployments are commonly cited at **15–20% needing TURN** [secondary, attributed to Kranky Geek survey data; I did not reach the underlying survey].

**Honest reading [inference]:** roughly 10–20% of connections will need a relay, and that fraction is *worse* than average for our case, because one side is a phone on a mobile carrier network, where CGNAT is the norm. Plan for relay on a meaningful minority of sessions, and treat any figure better than that as upside.

### 2.3 WebRTC data channels as a browser-native P2P transport

This is the option that looks like it solves everything and does not.

**What is true [verified].** WebRTC data channels give a browser a real P2P transport with DTLS encryption, and browsers ship it natively.

**What kills it for v1 [verified].**

- WebRTC has **no peer discovery**. You must run a signalling channel to exchange SDP and ICE candidates ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols), [libp2p](https://docs.libp2p.io/concepts/transports/webrtc/)). So you are running a server regardless. The "no infrastructure" version of this plan does not exist.
- You need STUN, and you need TURN for the fraction that fails. TURN is a relay you pay for by the byte. So you are running the expensive kind of relay for the hard cases, on top of signalling.
- The page itself has to be served from somewhere over HTTPS before any of this starts. That means a hostname and a cert, which is the thing we were trying to avoid.
- To make an existing HTTP app work over a data channel you must proxy HTTP through it, realistically via a service worker. That is a large amount of bespoke, fragile machinery around every fetch, every SSE stream, and every WebSocket in the app.

**Verdict:** a plausible v3 optimisation to cut relay bytes. A bad v1. It adds infrastructure (signalling + STUN + TURN) rather than removing it, and it buys nothing that a plain relay does not already provide, until relay bandwidth is actually the binding cost.

### 2.4 Peer-to-peer libraries (iroh)

**iroh 1.0 shipped 15 June 2026** after four years [secondary]. It is genuinely impressive and genuinely not applicable to v1.

**What it gives [verified, [iroh docs](https://docs.iroh.computer/what-is-iroh), [relays](https://docs.iroh.computer/concepts/relays)]:** dial a device by **public key**, not IP. QUIC + TLS 1.3 end to end. Relays are used for discovery and as fallback, and **cannot read the traffic**, because encryption is end to end. Relays are stateless, which the project notes makes them notably cheap to run. n0 operates free public relays, but they are **rate-limited, carry no uptime guarantee, and are documented as suitable for development and testing only.** You can self-host the relay binary, or buy dedicated relays from Iroh Services (pricing not published).

**Why not v1:** a browser cannot dial an iroh endpoint. iroh is for app-to-app. It becomes the right answer the day we ship a native Mac/iOS client, and at that point ~90% of sessions go direct and our relay cost collapses. Design the protocol so that door stays open.

### 2.5 Push-based / outbound-only designs

Worth stating precisely what this can and cannot do, because it is often proposed as the "no infrastructure" answer.

**What works [verified].** Web Push works in Safari 16+ on macOS using the standard **VAPID** protocol, with **no Apple Developer Program membership required**; VAPID keys are free to generate and never expire ([WebKit, Meet Web Push](https://webkit.org/blog/12945/meet-web-push/), [Apple WWDC22](https://developer.apple.com/videos/play/wwdc2022/10098/)). So the Mac can notify the owner's phone that something happened, entirely outbound.

**What does not work [inference, high confidence].** Push is a doorbell, not a door. The moment the owner wants to *see* the agent list or *press* a button, you need a request path **into** the machine. Push notifications carry a small payload and a click target, and that click target is a URL, which needs a reachable host. You could build an asymmetric design where the Mac polls a queue we host and posts results back, but note what that is: a relay, with worse latency, worse interactivity, and the queue operator (us) now sitting in the plaintext path unless you separately encrypt end to end. It is strictly worse than an SNI relay on every axis except novelty.

**Correct use:** pair push with the relay. Push tells the owner an agent needs attention; the relay carries the session when they tap.

### 2.6 QR-code / pairing-code enrolment

This is the right onboarding primitive and it is well proven in device management [secondary, from MDM/EMM practice: [NinjaOne](https://www.ninjaone.com/mdm/qr-code-enrollment/), [ManageEngine](https://www.manageengine.com/mobile-device-management/help/enrollment/mdm_android_qr_code_enrollment.html)].

**The pattern for us [inference]:** on first launch, the Mac app displays a QR code on its own screen (the one moment the owner *is* physically at the machine, during install). The QR encodes the assigned hostname plus a **short-lived, single-use** pairing secret. The owner scans it with their phone, the phone lands on their own instance over HTTPS, and immediately registers a **passkey**. From then on the phone is enrolled and the pairing secret is dead.

**Security caveats to design against:** the pairing secret must be single-use and expire in minutes, enrolment must be rate-limited, and every subsequent device enrolment must be approved from an already-enrolled device (or from the Mac's own screen). A QR that stays valid is a credential lying on a desk.

### 2.7 Authentication: the constraint that forces a real hostname

**WebAuthn / passkeys bind to a domain [verified].** The relying party is identified by a domain name, and the origin must match exactly, including scheme, host, and port ([FusionAuth](https://fusionauth.io/docs/lifecycle/authenticate-users/passwordless/webauthn-passkeys), [webauthn.me](https://www.webauthn.me/passkeys)). This is not incidental, it is the anti-phishing mechanism, and it cannot be worked around.

**Consequence [inference].** A design based on raw LAN IPs or self-signed certs gives up passkeys, gives up a clean HTTPS padlock, and trains a non-technical owner to click through certificate warnings on the console that controls their agents. That is a security regression dressed as a privacy win. A stable HTTPS hostname per user is not a compromise we are making for convenience, it is a security requirement.

For an app with **write endpoints and file access**, passkeys are the correct auth: phishing-resistant, no shared secret to leak, no password for the owner to reuse. That points hard at the Nabu Casa shape.

### 2.8 Relay cost shape

**The two cost drivers are different and both matter.**

1. **Idle connections.** Every installed Mac holds one open TCP connection to the relay, permanently, whether or not anyone is looking. Cost is memory, file descriptors, and connection-tracking, not bandwidth. This scales with *installs*, not usage.
2. **Bytes relayed.** Scales with *active use*.

**Anchors I verified:** Hetzner includes 1–20 TB/mo outbound per server with overage around **€1/TB** [secondary but consistently reported]; Fly.io egress is **$0.02/GB** in NA/EU, rising to $0.12/GB in Africa and India [secondary, from Fly's pricing page via search]; hyperscaler egress is $0.09–$0.15/GB [secondary]. The spread here is 20x to 150x, so provider choice dominates the bandwidth line entirely.

**Order-of-magnitude for our workload [inference, clearly labelled as such].** An agent console is text: JSON state, log tails, small UI assets after first cache. If a heavy user pushes 100 MB/day, that is ~3 GB/month. A thousand such users is ~3 TB/month, which fits inside a single Hetzner box's included traffic, for a bandwidth cost near zero. **This is the single most important number in this document and it is my estimate, not a measurement.** It should be validated with a real traffic profile before anyone commits to a free tier.

**Where this breaks:** the moment the console streams anything heavy (screen video of the agents, large file previews, media), the Plex outcome applies and the free relay is finished. Build a byte budget in from day one and keep bulk data off the relay.

**What I could not determine:** how many idle multiplexed connections a single modest server actually sustains in practice. This needs a load test, not a literature search. It is the real capacity question and I would not let anyone quote a user-count ceiling without it.

---

## 3. Recommendation

**Build the Nabu Casa pattern: an outbound-only, SNI-routed relay that we operate, with TLS terminating on the owner's Mac, passkey auth enforced entirely on the Mac, and QR-code pairing at install. Open-source the relay and make it swappable from day one.**

### 3.1 The design

1. **Install.** The app installs on the Mac. It generates a keypair locally and registers with our coordination service, receiving a stable hostname: `<random-id>.relay.<ourdomain>`.
2. **Certificate.** The Mac generates the CSR **locally** and we complete an ACME DNS-01 challenge in our zone on its behalf, returning the signed cert. **The private key never leaves the owner's machine.** This is exactly how Home Assistant Cloud provisions the cert for `*.ui.nabu.casa` [inference from the SniTun architecture, which cannot work any other way].
3. **Tunnel.** The Mac holds one outbound TLS connection to the relay. Nothing inbound. No router config. Works behind CGNAT.
4. **Routing.** The relay reads **only the SNI field** of each incoming TLS handshake to pick a tunnel, and forwards encrypted bytes. It never terminates TLS. It cannot read the payload.
5. **Pairing.** First launch shows a QR on the Mac's screen: hostname + single-use, short-lived pairing token. Owner scans with their phone, lands on their own instance over real HTTPS, registers a **passkey**. Additional devices are enrolled from an already-enrolled device or a fresh QR at the Mac.
6. **Authorisation.** 100% on the Mac. The relay has no user database, no session concept, no ability to authenticate anyone. **A total relay compromise yields traffic metadata, not agent control.**
7. **Notifications.** Web Push via VAPID (no Apple Developer account needed) so the owner learns an agent needs attention without holding a session open.

### 3.2 Why this and not the alternatives

- **Not Cloudflare Tunnel**, despite being technically excellent and free: the multi-tenant model runs into an explicit contractual prohibition on reselling Zero Trust to third parties [verified], and the account-free Quick Tunnel variant is non-persistent, has no SSE, and is documented as not for production [verified]. Our product's core availability would sit on someone else's terms-of-service interpretation, with a termination clause attached.
- **Not Tailscale**: client install and account per device is far past our audience. Funnel removes that but provides zero authentication, is beta, and has an undisclosed bandwidth cap.
- **Not port forwarding / UPnP**: broken by CGNAT, disabled by default, and indefensible to recommend for a service with file access.
- **Not WebRTC/iroh P2P for v1**: browsers cannot dial iroh, and WebRTC *adds* infrastructure (signalling + STUN + TURN) rather than removing it. Both become correct later, when there is a native client.
- **Yes to this**: it is the only shape that is simultaneously one-toggle for the owner, cryptographically honest about our access, and proven at scale by an open-source project with the same values and the same audience.

### 3.3 What it costs us to operate

**Honest answer: the shape is cheap, the absolute number is unverified.**

- **Bandwidth**: near-zero at small scale *if* the console stays text. On a €1/TB provider, thousands of users plausibly fit inside one server's included traffic [inference, needs validation].
- **Idle connections**: the real scaling constraint, and unquantified. Needs a load test.
- **Fixed costs**: a domain, a DNS zone with API access, ACME automation, and at minimum two relay servers (one is a single point of failure for every user's remote access). Realistically low tens of dollars per month to start.
- **Operational cost, which is the underrated one**: we are now on the hook for uptime. When the relay is down, every user's remote access is down, and they will experience that as our product being broken. This is a real, ongoing obligation, not a line item.
- **Escape hatch, pre-built**: if it ever gets expensive, the Nabu Casa model is right there and proven. Free self-hosted app, paid remote access at ~$5–7/mo, which funded a 50-plus-person organisation. Design the billing seam now even if we never use it.

### 3.4 The cost to the promise, named plainly

The brief asked that any erosion of "your data never leaves your machine" be named as a real cost rather than hidden. Here it is.

**What we can see even with a perfect implementation:** that a given install is online, when it is online, the source IP of the owner's browser, the SNI hostname, connection timing, and byte counts. **We cannot see** any request, response, agent name, file path, or credential.

**The residual risk that is not eliminated by encryption:** we control the DNS zone, so we have the *capability* to point a hostname at infrastructure we control and obtain a valid certificate for it. End-to-end encryption does not remove this; only these do:

- **Open-source the relay**, so the claim is auditable rather than asserted.
- **Certificate pinning or key continuity** in the Mac client, so a substituted cert is detected.
- **Certificate Transparency monitoring** for our own zone, published.
- **A documented, supported self-host path**: one config line to point at your own relay. Same trust posture as iroh's self-hostable relay [verified] and OpenZiti's model.
- **Say all of this in the README**, at install time, not in a privacy policy.

With those in place the honest claim is: *"Your data stays on your machine. Remote access goes through a relay we run, which is open source, cannot read your traffic, and which you can replace with your own."* That is a defensible sentence. **"Nothing ever touches our infrastructure"** is not, and we should stop planning to say it.

### 3.5 Suggested sequencing

1. **v1**: relay + SNI routing + local TLS termination + QR pairing + passkeys. Ship the self-host path in the same release, since it is what makes the privacy claim credible.
2. **v1.1**: LAN fast path. When the browser is on the same network, connect directly and skip the relay. Cuts relay load for what is probably the most common session, and Synology's cascade proves the pattern [verified].
3. **v2**: Web Push notifications.
4. **v3**: native client with iroh, moving ~90% of sessions to direct P2P and leaving the relay as fallback only.

---

## 4. What I could not determine

Stated explicitly rather than estimated.

1. **Tailscale Funnel's actual bandwidth limits.** Documented as existing and "non-configurable"; the values are not published. A community report claims 4K video streaming did not hit it [secondary, single unverified report].
2. **Plex Relay's exact current caps.** `support.plex.tv` returns 403 to automated fetches. The 1 Mbps / 2 Mbps figures are secondary-source only.
3. **Synology QuickConnect's security details.** The KB page rendered as chrome only and the white paper PDF would not parse. The E2E claim is vendor-asserted, unverified by me.
4. **Cloudflare Tunnel's bandwidth policy at a primary source.** "Free, unlimited bandwidth" is a widely repeated community claim I could not confirm on a Cloudflare-owned page.
5. **Whether Cloudflare would grant written permission** for a multi-tenant consumer product. That is a conversation with their partner team, not a research question.
6. **The relay fraction for *our* topology.** Published 10–20% figures are consumer WebRTC and Tailscale-estimated. Our mix (home Mac to mobile carrier, CGNAT-heavy on the phone side) is likely worse. Only measurement settles it.
7. **Idle-connection density per relay server.** The actual capacity limit. Requires a load test.
8. **Our real bytes-per-user-per-month.** My 100 MB/day figure is a guess to make the arithmetic concrete, not a measurement.
9. **Iroh Services dedicated relay pricing.** Not published.
10. **Nabu Casa's infrastructure cost or subscriber count.** Not disclosed. A third-party site lists ~$1.28M revenue [secondary, aggregator estimate, low confidence, do not cite this externally].
11. **2026 automatic port-mapping success rates on US consumer routers.** No credible current measurement study found.

---

## Sources

**Primary (fetched and read directly):**
- [NabuCasa/snitun (source)](https://github.com/NabuCasa/snitun)
- [Nabu Casa pricing](https://www.nabucasa.com/pricing/)
- [Home Assistant Cloud](https://www.home-assistant.io/cloud/) · [Thinking Big (funding model)](https://www.home-assistant.io/blog/2018/09/17/thinking-big/)
- [Tailscale pricing](https://tailscale.com/pricing) · [Funnel docs](https://tailscale.com/docs/features/tailscale-funnel) · [How NAT traversal works](https://tailscale.com/blog/how-nat-traversal-works)
- [Cloudflare Tunnel docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) · [TryCloudflare](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) · [Zero Trust Service-Specific Terms](https://www.cloudflare.com/service-specific-terms-zero-trust-services/) · [Tenant API](https://developers.cloudflare.com/tenant/get-started/) · [Updated ToS / section 2.8](https://blog.cloudflare.com/updated-tos/)
- [iroh: what is iroh](https://docs.iroh.computer/what-is-iroh) · [iroh relays](https://docs.iroh.computer/concepts/relays)
- [RFC 6886 (NAT-PMP)](https://datatracker.ietf.org/doc/html/rfc6886)

**Primary, reached via search summary only (page 403s or fails to parse for automated fetch):**
- [Nabu Casa remote access deep dive](https://support.nabucasa.com/hc/en-us/articles/25619268678557-Remote-access-Deep-dive) · [Enabling remote access](https://support.nabucasa.com/hc/en-us/articles/26474279202973-Enabling-remote-access-to-Home-Assistant)
- [Plex: accessing a server through Relay](https://support.plex.tv/articles/216766168-accessing-a-server-through-relay/) · [Plex 2025 updates](https://www.plex.tv/blog/important-2025-plex-updates/)
- [Synology QuickConnect White Paper](https://kb.synology.com/en-nz/WP/Synology_QuickConnect_White_Paper/4)
- [Ubiquiti: enable cloud access](https://help.ui.com/hc/en-us/articles/115012240067-UniFi-How-to-Enable-Cloud-Access-for-Remote-Management)
- [WebKit: Meet Web Push](https://webkit.org/blog/12945/meet-web-push/) · [Apple WWDC22: Meet Web Push for Safari](https://developer.apple.com/videos/play/wwdc2022/10098/)

**Secondary / community:**
- [Privacy Guides: Plex remote streaming restrictions](https://www.privacyguides.org/news/2025/11/26/plex-begins-enforcing-new-restrictions-on-free-remote-streaming-this-week/)
- [MDN: WebRTC protocols](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols) · [libp2p: WebRTC](https://docs.libp2p.io/concepts/transports/webrtc/)
- [FusionAuth: WebAuthn & passkeys](https://fusionauth.io/docs/lifecycle/authenticate-users/passwordless/webauthn-passkeys) · [webauthn.me](https://www.webauthn.me/passkeys)
- [Canadian Centre for Cyber Security: UPnP](https://www.cyber.gc.ca/en/guidance/universal-plug-play-itsap00008) · [UpGuard: UPnP risk](https://www.upguard.com/blog/what-is-upnp)
- [ngrok pricing changes, June 2026](https://ngrok.com/blog/pricing-june-2026) · [ngrok free plan limits](https://ngrok.com/docs/pricing-limits/free-plan-limits)
- [awesome-tunneling (landscape survey)](https://github.com/anderspitman/awesome-tunneling) · [Pangolin](https://www.ycombinator.com/launches/O0B-pangolin-open-source-secure-gateway-to-private-networks)
- [Fly.io pricing](https://fly.io/docs/about/pricing/)
