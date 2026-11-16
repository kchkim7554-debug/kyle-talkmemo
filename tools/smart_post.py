#!/usr/bin/env python3
"""카일·스마트 톡메모 — 스마트(비서) 쪽 도우미

Realtime Database REST로 메모를 읽고, 답글(smartReply)과 상태를 씁니다.

  python3 tools/smart_post.py --path board list
  python3 tools/smart_post.py --path board reply <memo_id> "답글 내용" [--status 처리중|완료]
  python3 tools/smart_post.py --path board note "내용" [--cat medical] [--todo]
  python3 tools/smart_post.py --path board status <memo_id> 완료
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://grandfirst-board-default-rtdb.asia-southeast1.firebasedatabase.app"
PATHS = {
    "dedicated": "talkmemo_v1_9852",
    "board": "board/talkmemo_v1_9852",
}


def api(path, method="GET", data=None):
    url = f"{BASE}/{urllib.parse.quote(path)}.json"
    body = json.dumps(data, ensure_ascii=False).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, method=method,
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        if e.code == 401 or "Permission denied" in detail:
            sys.exit(f"권한 거부: '{path}' 경로가 아직 열려 있지 않습니다. --path board 로 시도해 보세요.")
        sys.exit(f"HTTP {e.code}: {detail}")
    if raw.strip() in ("", "null"):
        return None
    return json.loads(raw)


def load(path):
    return api(path) or {}


def memo_ids(root):
    return sorted((root.get("memos") or {}).keys())


def cmd_list(path, show_done):
    root = load(path)
    memos = root.get("memos") or {}
    deleted = root.get("deleted") or {}
    rows = []
    for mid, m in memos.items():
        if not isinstance(m, dict) or mid in deleted:
            continue
        status = m.get("status") or "대기"
        if not show_done and status == "완료":
            continue
        rows.append((m.get("createdAt") or 0, mid, m))
    rows.sort()
    if not rows:
        print("메모가 없습니다.")
        return
    for ts, mid, m in rows:
        when = time.strftime("%m-%d %H:%M", time.localtime((ts or 0) / 1000))
        flags = []
        if m.get("todo"):
            flags.append("할일")
        if m.get("star"):
            flags.append("중요")
        head = f"[{mid}] {when} ({m.get('cat','general')}) {m.get('status','대기')}"
        if flags:
            head += " " + ",".join(flags)
        print(head)
        print("   " + (m.get("text") or "").replace("\n", "\n   "))
        if m.get("smartReply"):
            print("   ↳ 스마트: " + str(m["smartReply"]).replace("\n", "\n     "))


def cmd_reply(path, mid, text, status):
    root = load(path)
    memo = (root.get("memos") or {}).get(mid)
    if not isinstance(memo, dict):
        sys.exit(f"메모 {mid} 를 찾을 수 없습니다.")
    now = int(time.time() * 1000)
    patch = {"smartReply": text, "smartReplyAt": now, "updatedAt": now}
    if status:
        patch["status"] = status
        if status != "대기":
            patch["todo"] = True
    api(f"{path}/memos/{mid}", "PATCH", patch)
    print(f"답글 등록 완료: {mid}")


def cmd_note(path, text, cat, todo):
    now = int(time.time() * 1000)
    mid = "s" + format(now, "x") + str(int(time.time() * 1000) % 1000)
    memo = {
        "id": mid, "text": text, "cat": cat, "author": "smart",
        "createdAt": now, "updatedAt": now, "status": "대기",
        "todo": bool(todo), "star": False, "smartReply": "", "smartReplyAt": 0,
    }
    api(f"{path}/memos/{mid}", "PUT", memo)
    print(f"메모 등록 완료: {mid}")


def cmd_status(path, mid, status):
    api(f"{path}/memos/{mid}", "PATCH", {"status": status, "updatedAt": int(time.time() * 1000)})
    print(f"상태 변경: {mid} → {status}")


def main():
    ap = argparse.ArgumentParser(description="카일·스마트 톡메모 도우미")
    ap.add_argument("--path", default="board", choices=sorted(PATHS), help="동기화 경로 (기본 board)")
    ap.add_argument("--all", action="store_true", help="list에서 완료된 메모도 표시")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="메모 목록")
    r = sub.add_parser("reply", help="메모에 스마트 답글 달기")
    r.add_argument("id")
    r.add_argument("text")
    r.add_argument("--status", choices=["대기", "처리중", "완료"])
    n = sub.add_parser("note", help="스마트 이름으로 메모 남기기")
    n.add_argument("text")
    n.add_argument("--cat", default="general")
    n.add_argument("--todo", action="store_true")
    s = sub.add_parser("status", help="메모 상태 변경")
    s.add_argument("id")
    s.add_argument("status", choices=["대기", "처리중", "완료"])
    a = ap.parse_args()
    path = PATHS[a.path]
    if a.cmd == "list":
        cmd_list(path, a.all)
    elif a.cmd == "reply":
        cmd_reply(path, a.id, a.text, a.status)
    elif a.cmd == "note":
        cmd_note(path, a.text, a.cat, a.todo)
    elif a.cmd == "status":
        cmd_status(path, a.id, a.status)


if __name__ == "__main__":
    main()
