# Deploy na Google Cloud (Compute Engine VM) — Node + systemd + Caddy HTTPS

Cieľ: hru vystaviť na `https://arena.marosmaly.sk`.
Stack: **GCP Compute Engine VM** (Debian) → **Node** ako **systemd** služba → **Caddy** reverse proxy (automatický Let's Encrypt HTTPS + WebSockety).

Súbory v repe (`deploy/`): `arena.service`, `Caddyfile`.

> ### 🟢 Aktuálne nasadenie (produkcia)
> Hra **beží** na **https://arena.marosmaly.sk** (od 2026-07-20, po migrácii z mŕtveho Oracle — viď `docs/DEPLOY_ORACLE.md`).
> - **VM:** `instance-20260720-055132`, zóna `us-central1-a`, **Debian 13 (trixie), x86_64** — externá IP `34.134.62.153`
> - **SSH:** `ssh -i C:\Users\maly\.ssh\gcp_arena.key arena@34.134.62.153` (login user je **`arena`**, nie `ubuntu`)
> - **App:** systemd služba `arena` (`/home/arena/arena`, `PORT=3000`), **Caddy** HTTPS proxy
> - **Nová verzia (najčastejší úkon):** viď [sekcia 8 – Update](#8-update--prevádzka)
>
> Zvyšok tohto dokumentu je **kompletný postup od nuly** — použi ho pri novej VM alebo ďalšej migrácii.

---

## Prehľad krokov

1. [Vytvoriť VM v GCP konzole](#1-vytvoriť-vm)
2. [SSH kľúč + prístup](#2-ssh-kľúč--prístup)
3. [Nainštalovať Node + naklonovať appku](#3-node--appka)
4. [Spustiť ako systemd službu](#4-systemd-služba)
5. [Otvoriť porty 80/443 (firewall)](#5-firewall)
6. [Nasmerovať doménu (A záznam)](#6-doména)
7. [Caddy = HTTPS](#7-caddy--https)
8. [Update / prevádzka](#8-update--prevádzka)

---

## 1. Vytvoriť VM

GCP konzola → **Compute Engine → VM instances → Create instance**.

- **Machine type:** stačí malý shape (`e2-micro`/`e2-small` — hra je nenáročná).
- **Boot disk:** *Debian* (13/trixie testované) alebo *Ubuntu*. Pri Ubuntu bude login user `ubuntu`; pri Debian s metadata kľúčom je user odvodený z comentu kľúča (viď krok 2).
- **Networking:** nechaj default VPC, **External IPv4 = ephemeral** (alebo rezervuj statickú, aby sa IP nemenila po reštarte).
- **Create.** Poznač si **External IP** (u nás `34.134.62.153`).

---

## 2. SSH kľúč + prístup

`gcloud` CLI netreba. Použijeme metadata SSH kľúč:

```powershell
# vygeneruj dedikovaný kľúč (comment určuje Linux username → tu "arena")
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\gcp_arena.key" -N '""' -C "arena"
type "$env:USERPROFILE\.ssh\gcp_arena.key.pub"    # skopíruj celý riadok
```

V konzole: **VM → Edit → SSH Keys → Add item** → nalep verejný kľúč → **Save**.
GCP z comentu (`arena`) vytvorí Linux účet `arena`.

> Ak má projekt zapnutý **OS Login**, metadata kľúče sa ignorujú — treba `gcloud compute ssh` (a `gcloud auth login` interaktívne).

Test pripojenia:

```powershell
ssh -i "$env:USERPROFILE\.ssh\gcp_arena.key" arena@<EXTERNAL_IP> "whoami; cat /etc/os-release | grep PRETTY"
```

---

## 3. Node + appka

Na VM (Debian repo ponúka Node 20 LTS — pre túto appku stačí):

```bash
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm git
node -v && npm -v && git --version
```

Naklonuj appku do `/home/arena/arena` (repo je verejné, netreba prihlásenie):

```bash
cd ~
git clone https://github.com/malymaros/arena.git arena
cd arena
npm install --omit=dev
```

Rýchly test, že beží:

```bash
PORT=3000 node server.js      # má vypísať http://localhost:3000 — Ctrl+C na ukončenie
```

---

## 4. systemd služba

Skopíruj priložený unit (`deploy/arena.service` už má `User=arena`, `WorkingDirectory=/home/arena/arena`) a spusti službu:

```bash
sudo cp ~/arena/deploy/arena.service /etc/systemd/system/arena.service
sudo systemctl daemon-reload
sudo systemctl enable --now arena
sudo systemctl status arena          # má byť "active (running)"
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3000/   # HTTP 200
```

Logy: `journalctl -u arena -f`

Appka teraz beží na `127.0.0.1:3000`. Ešte nie je verejne dostupná — to zariadi Caddy.

---

## 5. Firewall

GCP potrebuje povoliť porty 80 a 443 (port 22/SSH je na `default` sieti otvorený automaticky).
Najjednoduchšie: **VM → Edit → Firewalls** → zaškrtni ☑ **Allow HTTP traffic** + ☑ **Allow HTTPS traffic** → **Save**.
Pridá to VM sieťové tagy `http-server`/`https-server`, pre ktoré má `default` VPC pravidlá už hotové.

Over zvonku (z tvojho PC):

```bash
for p in 80 443; do timeout 6 bash -c "echo > /dev/tcp/<EXTERNAL_IP>/$p" 2>/dev/null && echo "port $p OPEN" || echo "port $p closed"; done
```

> Na GCP **nie je** dvojitý firewall ako na Oracle (žiadny OS iptables gotcha) — stačí VPC pravidlo.

---

## 6. Doména

DNS pre `marosmaly.sk` spravuje **Websupport** (ns1/ns2/ns3.websupport.sk). Vytvor/uprav **A záznam**:

```
arena.marosmaly.sk   →   A   →   <EXTERNAL_IP>
```

Over priamo na autoritatívnom serveri (obíde cache resolverov):

```bash
nslookup arena.marosmaly.sk ns1.websupport.sk
```

> ⚠️ **Skontroluj celú IP** (4 oktety) — pri migrácii sa reálne stal preklep `34.134.62.15` namiesto `34.134.62.153` a Caddy nevedel vydať cert.

---

## 7. Caddy = HTTPS

Inštalácia Caddy (oficiálny repo):

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

Nasaď Caddyfile (doména `arena.marosmaly.sk` je už v ňom nastavená):

```bash
sudo cp ~/arena/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl restart caddy
sudo systemctl status caddy
```

Caddy si **sám vytiahne Let's Encrypt certifikát** (preto museli byť porty 80/443 otvorené a DNS smerovať na VM). Do minúty:

**➡️ `https://arena.marosmaly.sk` — hra je online s HTTPS. 🎉**

Overenie zvonku (obíde lokálnu DNS cache):

```bash
curl -s -o /dev/null -w "HTTP %{http_code} cert:%{ssl_verify_result}\n" \
  --resolve arena.marosmaly.sk:443:<EXTERNAL_IP> https://arena.marosmaly.sk/
# Socket.IO handshake (WebSocket passthrough):
curl -s --resolve arena.marosmaly.sk:443:<EXTERNAL_IP> \
  "https://arena.marosmaly.sk/socket.io/?EIO=4&transport=polling"
```

Otvor ju v dvoch prehliadačoch (hra je pre 2 hráčov). Vstup je cez login (meno + heslo `hamara`, viď `docs/LOGIN_ROOMS_PLAN.md`).

---

## 8. Update / prevádzka

Nasadenie novej verzie po `git push`:

```
ssh -i C:\Users\maly\.ssh\gcp_arena.key arena@34.134.62.153 "cd ~/arena && git pull && npm install --omit=dev && sudo systemctl restart arena"
```

Užitočné (na VM):

| Príkaz | Čo robí |
|--------|---------|
| `sudo systemctl restart arena` | reštart hry |
| `journalctl -u arena -f` | živé logy hry |
| `sudo systemctl restart caddy` | reštart proxy (po zmene Caddyfile) |
| `journalctl -u caddy -f` | logy Caddy (napr. vydanie certu) |

**Admin reset:** ak chceš chrániť reset heslom, do `arena.service` pridaj
`Environment=ADMIN_KEY=nejakeheslo`, potom `daemon-reload` + `restart`.
