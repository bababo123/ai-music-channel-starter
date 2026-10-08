#!/usr/bin/env bash
# 伺服器資源監控:CPU / Memory / Network / Disk / Process,每 N 秒一筆,輸出 CSV
# 用法: ./monitor.sh <輸出目錄> [間隔秒=1]
#   環境變數: IFACE=網卡(預設自動偵測) DISK=磁碟(預設自動偵測) PID_PATTERN="node|java|convert|sharp"
set -u
OUT="${1:-results/run}"; INT="${2:-1}"
mkdir -p "$OUT"
IFACE="${IFACE:-$(ip route 2>/dev/null | awk '/default/ {print $5; exit}')}"
DISK="${DISK:-$(lsblk -ndo NAME,TYPE 2>/dev/null | awk '$2=="disk"{print $1; exit}')}"
PID_PATTERN="${PID_PATTERN:-node|java|python|nginx|thumbnail}"
F="$OUT/system.csv"; P="$OUT/process.csv"
echo "ts,cpu_user,cpu_sys,cpu_iowait,cpu_steal,cpu_total,load1,mem_used_mb,mem_avail_mb,mem_avail_pct,swap_used_mb,net_rx_mbps,net_tx_mbps,net_rx_err_drop,tcp_estab,tcp_timewait,disk_r_mbps,disk_w_mbps,disk_util_pct" > "$F"
echo "ts,pid,comm,cpu_pct,rss_mb,threads,fds" > "$P"

read_cpu(){ awk '/^cpu /{print $2+$3,$4,$5,$6,$9,$2+$3+$4+$5+$6+$7+$8+$9}' /proc/stat; }  # user+nice sys idle iowait steal total
read_net(){ awk -v i="$IFACE:" '$1==i{print $2,$10,$4+$5+$12+$13}' /proc/net/dev; }
read_dsk(){ awk -v d="$DISK" '$3==d{print $6,$10,$13}' /proc/diskstats; }          # rd_sectors wr_sectors io_ms

trap 'echo "stopped. results in $OUT"; exit 0' INT TERM
c0=($(read_cpu)); n0=($(read_net)); d0=($(read_dsk))
while sleep "$INT"; do
  ts=$(date +%s.%N)
  c1=($(read_cpu)); n1=($(read_net)); d1=($(read_dsk))
  dt=$((c1[5]-c0[5])); [ "$dt" -le 0 ] && dt=1
  pct(){ awk -v a="$1" -v t="$dt" 'BEGIN{printf "%.1f", a*100/t}'; }
  cu=$(pct $((c1[0]-c0[0]))); cs=$(pct $((c1[1]-c0[1]))); cw=$(pct $((c1[3]-c0[3]))); cst=$(pct $((c1[4]-c0[4])))
  ct=$(awk -v u="$cu" -v s="$cs" -v w="$cw" -v t="$cst" 'BEGIN{printf "%.1f",u+s+t}')
  load=$(cut -d' ' -f1 /proc/loadavg)
  mem=$(awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{printf "%d,%d,%.1f",(t-a)/1024,a/1024,a*100/t}' /proc/meminfo)
  swap=$(awk '/SwapTotal/{t=$2}/SwapFree/{f=$2}END{printf "%d",(t-f)/1024}' /proc/meminfo)
  rx=$(awk -v a="${n1[0]:-0}" -v b="${n0[0]:-0}" -v i="$INT" 'BEGIN{printf "%.2f",(a-b)*8/1e6/i}')
  tx=$(awk -v a="${n1[1]:-0}" -v b="${n0[1]:-0}" -v i="$INT" 'BEGIN{printf "%.2f",(a-b)*8/1e6/i}')
  ned=$(( ${n1[2]:-0} - ${n0[2]:-0} ))
  est=$(ss -tan state established 2>/dev/null | tail -n +2 | wc -l)
  tw=$(ss -tan state time-wait 2>/dev/null | tail -n +2 | wc -l)
  dr=$(awk -v a="${d1[0]:-0}" -v b="${d0[0]:-0}" -v i="$INT" 'BEGIN{printf "%.2f",(a-b)*512/1e6/i}')
  dw=$(awk -v a="${d1[1]:-0}" -v b="${d0[1]:-0}" -v i="$INT" 'BEGIN{printf "%.2f",(a-b)*512/1e6/i}')
  du=$(awk -v a="${d1[2]:-0}" -v b="${d0[2]:-0}" -v i="$INT" 'BEGIN{v=(a-b)/(i*10); if(v>100)v=100; printf "%.1f",v}')
  echo "$ts,$cu,$cs,$cw,$cst,$ct,$load,$mem,$swap,$rx,$tx,$ned,$est,$tw,$dr,$dw,$du" >> "$F"
  ps -eo pid,comm,pcpu,rss,nlwp --no-headers 2>/dev/null | grep -E "$PID_PATTERN" | while read -r pid comm cpu rss th; do
    fds=$(ls /proc/"$pid"/fd 2>/dev/null | wc -l)
    echo "$ts,$pid,$comm,$cpu,$((rss/1024)),$th,$fds" >> "$P"
  done
  # OOM 偵測
  dmesg 2>/dev/null | tail -50 | grep -qi "out of memory" && echo "$ts OOM detected" >> "$OUT/events.log"
  c0=("${c1[@]}"); n0=("${n1[@]}"); d0=("${d1[@]}")
done
