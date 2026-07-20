# Deploy na Oracle Cloud (Always Free) — Node + systemd + Caddy HTTPS

> ### 🔴 VYRADENÉ (2026-07-20)
> Oracle VM je **mŕtvy a nedostupný** — produkcia bola migrovaná na **Google Cloud**.
> **Aktuálny návod aj SSH/deploy príkazy: [`docs/DEPLOY_GCP.md`](DEPLOY_GCP.md).**
> Tento dokument ostáva len ako **história** a kvôli Oracle-špecifickému
> iptables gotcha (poradie `ACCEPT` pred `REJECT`), ktoré na GCP neplatí.

Cieľ: hru vystaviť na `https://arena.marosmaly.sk`.
Stack: **Ampere A1 Always Free VM** (Ubuntu) → **Node** ako **systemd** služba → **Caddy** reverse proxy (automatický Let's Encrypt HTTPS + WebSockety).

Súbory v repe (`deploy/`): `arena.service`, `Caddyfile`.

> ### ⚪ Pôvodné nasadenie (už NEbeží)
> - **VM:** Oracle Ampere A1.Flex (Always Free, AD-2), Ubuntu — public IP `138.2.172.142`
> - **SSH:** `ssh -i C:\Users\maly\.ssh\oracle_arena_b.key ubuntu@138.2.172.142`
> - **App:** systemd služba `arena` (`/home/ubuntu/arena`, `PORT=3000`), **Caddy** HTTPS proxy
>
> Zvyšok tohto dokumentu je **kompletný postup od nuly** pre Oracle — použi ho len,
> ak by si sa niekedy vracal na Oracle. Inak viď `docs/DEPLOY_GCP.md`.

---

## Prehľad krokov

1. [Vytvoriť VM v Oracle konzole](#1-vytvoriť-vm)
2. [Otvoriť porty 80/443 v Security List](#2-otvoriť-porty-vo-vcn)
3. [SSH na VM + otvoriť porty aj v OS firewalle](#3-ssh--os-firewall)
4. [Nainštalovať Node + naklonovať appku](#4-node--appka)
5. [Spustiť ako systemd službu](#5-systemd-služba)
6. [Nasmerovať doménu (A záznam)](#6-doména)
7. [Caddy = HTTPS](#7-caddy--https)
8. [Update / prevádzka](#8-update--prevádzka)

---

## 1. Vytvoriť VM

Oracle konzola → **Menu ☰ → Compute → Instances → Create instance**.

- **Name:** `arena`
- **Image:** *Canonical Ubuntu* (24.04 alebo 22.04)
- **Shape:** klikni **Change shape → Ampere (ARM)** → `VM.Standard.A1.Flex`.
  Nastav napr. **1 OCPU / 6 GB RAM** (Always Free dáva spolu až 4 OCPU / 24 GB — pokojne 1/6, hra je nenáročná).
  > Ak píše „Out of capacity", skús iný **Availability Domain** (AD-1/2/3), alebo neskôr znova — ARM kapacita v Always Free býva plná. Núdzový plán: x86 shape `VM.Standard.E2.1.Micro` (tiež Always Free, slabšie, ale hru utiahne).
- **Add SSH keys:** vyber **Generate a key pair for me** a **stiahni privátny kľúč** (budeš ho potrebovať na SSH). Alebo nahraj svoj existujúci `.pub`.
- **Networking:** nechaj *Create new VCN* (vytvorí VCN + verejnú subnet). **Assign public IPv4 = Yes.**
- **Create.** Po pár minútach je stav *Running*. Poznač si **Public IP address**.

---

## 2. Otvoriť porty vo VCN

Bez tohto sa na server zvonku nedostaneš (najčastejšia chyba).

Konzola → detail inštancie → sekcia **Primary VNIC** → klik na **Subnet** → klik na **Security List** (default) → **Add Ingress Rules**.

Pridaj tieto pravidlá (Source CIDR `0.0.0.0/0`, IP Protocol **TCP**):

| Účel  | Destination Port |
|-------|------------------|
| HTTP  | 80               |
| HTTPS | 443              |

(Port 22/SSH tam už z inštalácie je.)

---

## 3. SSH + OS firewall

Z tvojho PC (PowerShell), s cestou k stiahnutému privátnemu kľúču:

```powershell
ssh -i C:\cesta\k\privatnemu-kluc.key ubuntu@<PUBLIC_IP>
```

> **Windows — „UNPROTECTED PRIVATE KEY FILE":** OpenSSH odmietne kľúč s voľnými právami.
> Skopíruj ho do `%USERPROFILE%\.ssh\` a zamkni práva:
> ```powershell
> icacls "$env:USERPROFILE\.ssh\mojkluc.key" /inheritance:r
> icacls "$env:USERPROFILE\.ssh\mojkluc.key" /grant:r "$($env:USERNAME):(R)"
> ```

Ubuntu obrazy na Oracle majú **navyše iptables**, ktoré blokujú všetko okrem SSH — treba otvoriť porty aj v OS (druhá najčastejšia chyba).

> ⚠️ **POZOR na poradie pravidiel** (na toto sme sa reálne zasekli): v INPUT reťazi je
> na konci `REJECT ... reject-with icmp-host-prohibited`, ktorý zhodí všetko, čo sa k nemu
> dostane. Nové `ACCEPT` pravidlá musia byť **PRED** týmto REJECT. Fixné `-I INPUT 6`
> nie je spoľahlivé — poloha REJECT sa medzi obrazmi líši (u nás bol na riadku 5, takže
> insert na pozíciu 6 padol AŽ ZA REJECT a porty ostali zavreté). Preto pravidlá
> vkladáme dynamicky priamo pred REJECT:

```bash
# vloz ACCEPT pre 80 aj 443 tesne PRED REJECT pravidlo
REJ=$(sudo iptables -L INPUT --line-numbers -n | awk '/REJECT/{print $1; exit}')
sudo iptables -I INPUT "$REJ" -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT "$REJ" -m state --state NEW -p tcp --dport 443 -j ACCEPT

# perzistencia cez reboot
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent
sudo netfilter-persistent save

# kontrola — ACCEPT pre dpt:80/443 MUSI byt nad riadkom REJECT
sudo iptables -L INPUT -n --line-numbers
```

---

## 4. Node + appka

Na VM (Node 20 LTS z NodeSource) + git:

```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
```

Naklonuj appku do `/home/ubuntu/arena` (repo je verejné, netreba prihlásenie):

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

## 5. systemd služba

Skopíruj priložený unit a spusti službu:

```bash
sudo cp ~/arena/deploy/arena.service /etc/systemd/system/arena.service
sudo systemctl daemon-reload
sudo systemctl enable --now arena
sudo systemctl status arena          # má byť "active (running)"
```

Logy: `journalctl -u arena -f`

Appka teraz beží na `127.0.0.1:3000`. Ešte nie je verejne dostupná — to zariadi Caddy.

---

## 6. Doména

U registrátora domény vytvor **A záznam**:

```
arena.marosmaly.sk   →   A   →   <PUBLIC_IP_VM>
```

Počkaj, kým sa rozšíri (zvyčajne minúty). Over: `ping arena.marosmaly.sk` má vrátiť tvoju IP.

> **Bez domény?** HTTPS s Let's Encrypt vyžaduje doménu. Ak žiadnu nemáš:
> lacná `.sk`/`.com` u registrátora, alebo dočasne zadarmo cez sslip.io
> (`arena.<IP-s-pomlčkami>.sslip.io`) — funguje ako doména aj pre Caddy cert.

---

## 7. Caddy = HTTPS

Inštalácia Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

Nasaď Caddyfile (doména `arena.marosmaly.sk` je už v ňom nastavená):

```bash
sudo cp ~/arena/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl restart caddy
sudo systemctl status caddy
```

Caddy si pri štarte **sám vytiahne Let's Encrypt certifikát** (preto museli byť porty 80/443 otvorené). Do minúty:

**➡️ `https://arena.marosmaly.sk` — hra je online s HTTPS. 🎉**

Otvor ju v dvoch prehliadačoch/zariadeniach (hra je pre 2 hráčov) — prvý pripojený je host a vidí lobby.

---

## 8. Update / prevádzka

Nasadenie novej verzie po `git push`:

```bash
cd ~/arena
git pull
npm install --omit=dev      # len ak sa menili dependencies
sudo systemctl restart arena
```

Užitočné:

| Príkaz | Čo robí |
|--------|---------|
| `sudo systemctl restart arena` | reštart hry |
| `journalctl -u arena -f` | živé logy hry |
| `sudo systemctl restart caddy` | reštart proxy (po zmene Caddyfile) |
| `curl -s ...admin/reset-all?key=…` | reset hry (ak si nastavil `ADMIN_KEY`) |

**Admin reset:** ak chceš chrániť reset heslom, do `arena.service` odkomentuj/pridaj
`Environment=ADMIN_KEY=nejakeheslo`, potom `daemon-reload` + `restart`.
