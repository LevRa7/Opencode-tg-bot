# IPv6 Per-User VM Addressing

**Date:** 2026-06-17  
**Status:** spec  
**Context:** Each bot user gets a VM. Currently VMs use only IPv4 (NAT via libvirt `10.100.0.0/24`). The project owner has a VPS with an assigned `/64` IPv6 range and wants each VM to get a unique, publicly routable IPv6 address.

## Goals

1. Every user VM receives a unique IPv6 from `2607:9d00:2000:1f6::/64`.
2. IPv6 is deterministic per userId (Knuth hash) — survives VM recreate.
3. IPv6 traffic is routed VPS → home server → VM via AmneziaWG tunnel.
4. Code changes follow TDD.

## Non-goals

- IPv6 NAT. This is routed, not NATed.
- Dual-stack for existing services (bot, docker tenants). Only VM users get IPv6.
- SLAAC / DHCPv6 inside libvirt network. Routes are added manually per VM.

## Architecture

```
                 Internet
                    │
                    ▼
    ┌──────────────────────────────┐
    │  VPS (192.129.148.93)       │
    │  2607:9d00:2000:1f6::/64    │
    │                              │
    │  ndppd: proxies NDP for     │
    │  whole /64 (except own IP)   │
    │                              │
    │  ip -6 route /64 → tunnel   │
    │  AmneziaWG: fd00::1/64      │
    └──────────────┬───────────────┘
                   │  AmneziaWG tunnel
                   │  (UDP, port TBD)
    ┌──────────────┴───────────────┐
    │  Home Server                 │
    │                              │
    │  AmneziaWG: fd00::2/64      │
    │  ipv6 forwarding = 1        │
    │                              │
    │  ip -6 route <vm>/128       │
    │    dev vnetX                 │
    │                              │
    │  ┌───────┐  ┌───────┐       │
    │  │ VM A  │  │ VM B  │       │
    │  │IPv6_A │  │IPv6_B │       │
    │  └───────┘  └───────┘       │
    └──────────────────────────────┘
```

## Network Topology

| Component | Address | Notes |
|-----------|---------|-------|
| VPS public IPv6 | `2607:9d00:2000:1f6::dbc8:1550` | Existing, kept |
| VPS AmneziaWG | `fd00::1/64` | Tunnel endpoint |
| Home AmneziaWG | `fd00::2/64` | Tunnel endpoint |
| User VM IPv6 | `2607:9d00:2000:1f6::<hash>` | Deterministic from userId |

## Deterministic IPv6 Generation

```typescript
function generateIpv6ForUser(userId: number): string {
  const h = knuthHash(userId >>> 0);
  // Use full 64 bits of host portion, skip :1 (gateway)
  const host = BigInt(h >>> 0) % ((1n << 64n) - 2n) + 2n;
  const hex = host.toString(16).padStart(16, "0");
  return `2607:9d00:2000:1f6::${hex}`;
}
```

Address `::1` is reserved (gateway on VPS). User addresses start from `::2`.

## Code Changes

### `src/vm/types.ts`
- Add `ipv6?: string` to `VmInfo`

### `src/vm/manager.ts`
- Add `generateIpv6ForUser(userId)`
- `createAndStart()`: after VM gets IPv4, record IPv6 in VmInfo
- `buildDomainXml()`: no changes needed (IPv6 route is host-side)

### `src/bot/middleware/auth.ts`
- `buildAccessRequestText()`: show IPv6 alongside VM spec
- `handleAccessApprovalCallback()`: show IPv6 in confirmation

### Infrastructure scripts
- `/root/amneziawg-tunnel.sh` — setup script for both sides
- `/etc/ndppd.conf` — on VPS
- Systemd units for tunnel + ndppd

## Infrastructure Setup (manual, once)

### 1. AmneziaWG tunnel (both servers)

VPS (`/etc/amneziawg/awg0.conf`):
```ini
[Interface]
PrivateKey = <vps-private>
Address = fd00::1/64
ListenPort = 51820

[Peer]
PublicKey = <home-public>
Endpoint = <home-ip>:51820
AllowedIPs = fd00::2/128, 2607:9d00:2000:1f6::/64
PersistentKeepalive = 25
```

Home (`/etc/amneziawg/awg0.conf`):
```ini
[Interface]
PrivateKey = <home-private>
Address = fd00::2/64

[Peer]
PublicKey = <vps-public>
Endpoint = 192.129.148.93:51820
AllowedIPs = fd00::1/128
PersistentKeepalive = 25
```

### 2. ndppd on VPS

```ini
proxy eth0 {
  rule 2607:9d00:2000:1f6::/64 {
    static
  }
}
```

Exclude VPS own address via iptables or ndppd exclude.

### 3. IPv6 forwarding

Both servers: `net.ipv6.conf.all.forwarding = 1`

### 4. Per-VM route on home server

On VM start: `ip -6 route add <vm_ipv6>/128 dev <vnet_interface>`

On VM stop: `ip -6 route del <vm_ipv6>/128 dev <vnet_interface>`

## Testing

### Unit tests
- `generateIpv6ForUser()` returns valid /128 in correct subnet
- Same userId → same IPv6 (deterministic)
- Different users → different IPv6
- No user gets `::1`

### Integration (manual)
1. Create VM → IPv6 appears in `VmInfo`
2. `ping6 <vm_ipv6>` from VPS reaches VM
3. `curl -6 http://[<vm_ipv6>]:4096/api/health` returns 401
4. VM destroy → IPv6 route removed, ping6 fails
